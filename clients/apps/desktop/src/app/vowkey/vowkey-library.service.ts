import { computed, inject, Injectable, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { BehaviorSubject, combineLatest, from, map, Observable, of, switchMap } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherPermissionsApi } from "@vowkey/common/vault/models/api/cipher-permissions.api";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import {
  humanDetailLabel,
  profileRefOf,
  ProfileSource,
  readEnvelope,
  resolveDetailVariant,
} from "@vowkey/common/vault/profile/vk-meta";
import { Cipher as SdkCipher, PureCrypto } from "@vowkey/sdk-internal";

import type { GlyphName } from "./vowkey-glyph.component";
import { VowkeyHub } from "./vowkey-hub.service";

export type LibraryShow =
  | "all"
  | "pinned"
  | "profiles"
  | "documents"
  | "logins"
  | "cards"
  | "keys"
  | "notes"
  | "environments"
  | "expiring"
  | "trash";

export type LibrarySort = "kind" | "name" | "changed";

export interface LibraryRow {
  /** Unique in a list: a document row shares its profile's cipher id. */
  key: string;
  cipherId: string;
  sourceId: string | null;
  kind: "profile" | "document" | "login" | "card" | "key" | "note" | "environment" | "other";
  glyph: GlyphName;
  title: string;
  subtitle: string;
  pinned: boolean;
  changed: number;
  expired: boolean;
  /** Text the search matches beyond the title: detail labels and values, hosts, usernames. */
  haystack: string;
}

const EXPIRING_WINDOW_MS = 1000 * 60 * 60 * 24 * 90;

function host(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return value;
  }
}

function date(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(parsed)
    : (value ?? "");
}

/** The one place the Vowkey shell reads the account's items: the sidebar and the vault page share it. */
@Injectable({ providedIn: "root" })
export class VowkeyLibrary {
  private readonly accounts = inject(AccountService);
  private readonly ciphers = inject(CipherService);
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly hub = inject(VowkeyHub, { optional: true });
  private readonly i18n = inject(I18nService, { optional: true });
  private readonly localRefresh$ = new BehaviorSubject<number>(0);
  private readonly localeTick = signal(0);

  readonly account = toSignal(this.accounts.activeAccount$, { initialValue: null });
  readonly isGuest = computed(() => this.account() == null);
  private readonly localState$: Observable<string> = this.localVault
    ? this.localVault.state$
    : of("empty");
  private readonly views = toSignal(
    combineLatest([this.accounts.activeAccount$, this.localState$, this.localRefresh$]).pipe(
      switchMap(([account]) => {
        if (account) {
          return this.ciphers.cipherViews$(account.id);
        }
        if (!this.localVault) {
          return of([] as CipherView[]);
        }
        return from(this.readLocalViews());
      }),
      map((views) => views ?? []),
    ),
    { initialValue: [] as CipherView[] },
  );

  readonly online = signal(typeof navigator === "undefined" ? true : navigator.onLine);

  constructor() {
    this.hub?.changed$.subscribe(() => this.refreshLocal());
    this.i18n?.locale$?.subscribe?.(() => this.localeTick.update((n) => n + 1));
  }

  private tr(key: string, fallback: string, p1?: string | number): string {
    const translated = this.i18n?.t(key, p1 != null ? String(p1) : undefined);
    return translated && translated !== key ? translated : fallback;
  }

  refreshLocal(): void {
    this.localRefresh$.next(this.localRefresh$.value + 1);
  }

  private async readLocalViews(): Promise<CipherView[]> {
    if (!this.localVault) {
      return [];
    }
    try {
      await this.localVault.initialize();
      if (this.localVault.state$.value === "empty") {
        return [];
      }
      if (
        this.localVault.state$.value === "session-unlocked" ||
        this.localVault.state$.value === "persisted-unlocked"
      ) {
        if (
          typeof this.localVault.store?.list === "function" &&
          typeof this.localVault.key === "function"
        ) {
          const records = await this.localVault.store.list<
            SdkCipher & { migrationPending?: boolean }
          >("ciphers");
          if (records.length === 0) {
            return [];
          }
          const key = await this.localVault.key();
          try {
            return records
              .filter(({ value }) => !value.migrationPending)
              .map(({ value }) => {
                const view = CipherView.fromSdkCipherView(
                  PureCrypto.decrypt_legacy_cipher(value, key),
                )!;
                view.edit = true;
                view.viewPassword = true;
                view.permissions ??= new CipherPermissionsApi();
                view.permissions.delete = view.permissions.restore = true;
                return view;
              });
          } finally {
            key.fill(0);
          }
        }
        return await this.localVault.list();
      }
    } catch {
      return [];
    }
    return [];
  }

  readonly live = computed(() => this.views().filter((cipher) => !cipher.isDeleted && !cipher.isArchived));
  readonly deleted = computed(() => this.views().filter((cipher) => cipher.isDeleted));

  readonly profiles = computed(() =>
    this.live()
      .filter((cipher) => cipher.type === CipherType.Identity)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Every row the library can show, before a destination or a search narrows it. */
  readonly rows = computed<LibraryRow[]>(() => {
    this.localeTick();
    const now = Date.now();
    const rows: LibraryRow[] = [];
    for (const cipher of this.live()) {
      rows.push(...this.rowsOf(cipher, now));
    }
    return rows;
  });

  readonly trashRows = computed<LibraryRow[]>(() => {
    this.localeTick();
    const now = Date.now();
    return this.deleted().flatMap((cipher) => this.rowsOf(cipher, now).filter((row) => row.kind !== "document"));
  });

  readonly expiringCount = computed(() => this.rows().filter((row) => row.expired).length);

  cipherOf(id: string | null | undefined): CipherView | null {
    return (id ? this.views().find((cipher) => cipher.id === id) : null) ?? null;
  }

  sourceOf(cipher: CipherView, sourceId: string | null): ProfileSource | null {
    return readEnvelope(cipher)?.sources.find((source) => source.id === sourceId) ?? null;
  }

  rowsFor(show: LibraryShow, personId: string | null, query: string, sort: LibrarySort): LibraryRow[] {
    let rows = show === "trash" ? this.trashRows() : this.rows();
    rows = rows.filter((row) => {
      switch (show) {
        case "pinned":
          return row.pinned;
        case "profiles":
          return row.kind === "profile";
        case "documents":
          return row.kind === "document";
        case "logins":
          return row.kind === "login";
        case "cards":
          return row.kind === "card";
        case "keys":
          return row.kind === "key";
        case "notes":
          return row.kind === "note";
        case "environments":
          return row.kind === "environment";
        case "expiring":
          return row.expired;
        default:
          return true;
      }
    });
    if (personId) {
      rows = rows.filter((row) => row.cipherId === personId || this.personOf(row.cipherId) === personId);
    }
    const needle = query.trim().toLocaleLowerCase();
    if (needle) {
      rows = rows.filter((row) => `${row.title}\n${row.subtitle}\n${row.haystack}`.toLocaleLowerCase().includes(needle));
    }
    const kindOrder = ["profile", "document", "login", "card", "key", "note", "environment", "other"];
    return [...rows].sort((a, b) =>
      sort === "name"
        ? a.title.localeCompare(b.title)
        : sort === "changed"
          ? b.changed - a.changed
          : kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.title.localeCompare(b.title),
    );
  }

  personOf(cipherId: string): string | null {
    const cipher = this.cipherOf(cipherId) ?? this.deleted().find((entry) => entry.id === cipherId) ?? null;
    return cipher ? profileRefOf(cipher) : null;
  }

  private rowsOf(cipher: CipherView, now: number): LibraryRow[] {
    const changed = cipher.revisionDate ? new Date(cipher.revisionDate).getTime() : 0;
    const base = { cipherId: cipher.id, sourceId: null as string | null, pinned: cipher.favorite, changed, expired: false };
    switch (cipher.type) {
      case CipherType.Identity: {
        const envelope = readEnvelope(cipher);
        const details = envelope?.details ?? [];
        const rows: LibraryRow[] = [
          {
            ...base,
            key: cipher.id,
            kind: "profile",
            glyph: "person",
            title: cipher.name,
            subtitle: envelope
              ? details.length === 1
                ? this.tr("vkCountOneDetail", "1 detail")
                : this.tr("vkCountDetails", `${details.length} details`, details.length)
              : (cipher.subTitle ?? ""),
            haystack: details
              .map(
                (detail) =>
                  `${humanDetailLabel(detail.attribute, detail.label)} ${detail.label} ${resolveDetailVariant(envelope!, detail)?.value ?? ""}`,
              )
              .join("\n"),
          },
        ];
        for (const source of envelope?.sources ?? []) {
          if (source.status === "deleted") {
            continue;
          }
          const expires = source.expiresOn ? new Date(source.expiresOn).getTime() : null;
          rows.push({
            ...base,
            key: `${cipher.id}:${source.id}`,
            sourceId: source.id,
            kind: "document",
            glyph: "document",
            title: source.fileName.replace(/\.[^.]+$/, ""),
            subtitle: source.documentDate
              ? this.tr("vkIssuedOn", `Issued ${source.documentDate}`, source.documentDate)
              : this.tr(
                  "vkAddedOn",
                  `Added ${date(source.capturedAt)}`,
                  date(source.capturedAt),
                ),
            expired: expires != null && expires - now < EXPIRING_WINDOW_MS,
            haystack: `${source.kind} ${cipher.name}`,
          });
        }
        return rows;
      }
      case CipherType.Login: {
        const uri = cipher.login?.uris?.[0]?.uri ?? "";
        return [
          {
            ...base,
            key: cipher.id,
            kind: "login",
            glyph: "globe",
            title: cipher.name || host(uri),
            subtitle: cipher.login?.username ?? "",
            haystack: `${host(uri)} ${uri}`,
          },
        ];
      }
      case CipherType.Card: {
        const number = cipher.card?.number ?? "";
        const expires = this.cardExpiry(cipher);
        return [
          {
            ...base,
            key: cipher.id,
            kind: "card",
            glyph: "card",
            title: cipher.name,
            subtitle: [cipher.card?.brand, number ? `•••• ${number.slice(-4)}` : ""].filter(Boolean).join(" · "),
            expired: expires != null && expires - now < EXPIRING_WINDOW_MS,
            haystack: cipher.card?.cardholderName ?? "",
          },
        ];
      }
      case CipherType.ApiKey: {
        const hosts = cipher.apiKey?.allowedHosts ?? [];
        return [
          {
            ...base,
            key: cipher.id,
            kind: "key",
            glyph: "key",
            title: cipher.name,
            subtitle: hosts.length ? hosts.join(", ") : this.tr("vkNoHostSet", "No host set"),
            haystack: hosts.join(" "),
          },
        ];
      }
      case CipherType.SshKey: {
        const fingerprint = cipher.sshKey?.keyFingerprint ?? "";
        return [
          {
            ...base,
            key: cipher.id,
            kind: "key",
            glyph: "key",
            title: cipher.name,
            subtitle: fingerprint,
            haystack: `${fingerprint} ${cipher.sshKey?.publicKey ?? ""}`,
          },
        ];
      }
      case CipherType.SecureNote: {
        const body = cipher.notes ?? "";
        const firstLine = body
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? "";
        return [
          {
            ...base,
            key: cipher.id,
            kind: "note",
            glyph: "note",
            title: cipher.name,
            subtitle: firstLine.slice(0, 72),
            haystack: body,
          },
        ];
      }
      case CipherType.Environment: {
        const members = cipher.environment?.members ?? [];
        return [
          {
            ...base,
            key: cipher.id,
            kind: "environment",
            glyph: "layers",
            title: cipher.name,
            subtitle:
              members.length === 1
                ? this.tr("vkCountOneKey", "1 key")
                : this.tr("vkCountKeys", `${members.length} keys`, members.length),
            haystack: members.map((member) => member.name).join(" "),
          },
        ];
      }
      default:
        return [
          { ...base, key: cipher.id, kind: "other", glyph: "document", title: cipher.name, subtitle: cipher.subTitle ?? "", haystack: "" },
        ];
    }
  }

  private cardExpiry(cipher: CipherView): number | null {
    const month = Number(cipher.card?.expMonth);
    const year = Number(cipher.card?.expYear);
    return month >= 1 && month <= 12 && year > 2000 ? new Date(year, month, 0, 23, 59).getTime() : null;
  }
}
