import { Inject, Injectable, Optional } from "@angular/core";
import { BehaviorSubject, distinctUntilChanged, filter, firstValueFrom, map, of, switchMap } from "rxjs";
import type { SymmetricCryptoKey } from "@vowkey/legacy-crypto";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { UserId } from "@vowkey/common/types/guid";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { LocalVaultMigration, MigrationCustody, MigrationHttpError, MigrationTransport } from "@vowkey/common/vault/local/migration";
import { KeyService } from "@vowkey/key-management";
import { SafeInjectionToken } from "@vowkey/ui-common";

export const LOCAL_VAULT_CUSTODY = new SafeInjectionToken<MigrationCustody>("LocalVaultCustody");
type AccountSession = { userId: UserId; email: string; key: SymmetricCryptoKey };

@Injectable()
export class LocalVaultAttachService {
  readonly error$ = new BehaviorSubject<string | null>(null);
  private active: Promise<unknown> = Promise.resolve();
  private started = false;
  private epoch = 0;
  private session: AccountSession | null = null;
  private readonly scheduled = new Set<number>();

  constructor(
    private readonly vault: LocalVaultService,
    private readonly accounts: AccountService,
    private readonly keys: KeyService,
    private readonly api: ApiService,
    private readonly environments: EnvironmentService,
    @Optional() @Inject(LOCAL_VAULT_CUSTODY) private readonly custody: MigrationCustody | null,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.accounts.activeAccount$.pipe(switchMap((account) => account == null ? of(null) :
      this.keys.userKey$(account.id).pipe(map((key): AccountSession | null => key == null ? null : {
        userId: account.id, email: account.email, key,
      })),
    ), distinctUntilChanged((a, b) => a?.userId === b?.userId && a?.key === b?.key)).subscribe((value) => {
      const previous = this.session;
      this.session = value;
      const epoch = ++this.epoch;
      void (async () => {
        const metadata = await this.vault.protectionMetadata();
        if (this.epoch !== epoch) { return; }
        const accountOwned = metadata?.attachedUserId != null || metadata?.cutover != null;
        const sameAccount = value != null && (metadata?.attachedUserId === value.userId ||
          metadata?.cutover?.accountUserId === value.userId);
        if (accountOwned && (!sameAccount || previous != null && previous.key !== value!.key)) {
          await this.vault.lock();
        }
        if (value != null && this.epoch === epoch) { this.schedule(value, epoch); }
      })().catch((error: unknown) => this.report(error));
    });
    this.vault.state$.pipe(filter((state) => state === "session-unlocked" || state === "persisted-unlocked"))
      .subscribe(() => { if (this.session != null) { this.schedule(this.session, this.epoch); } });
    void this.vault.initialize().catch((error: unknown) => this.report(error));
  }

  private schedule(session: AccountSession, epoch: number): void {
    if (this.scheduled.has(epoch)) { return; }
    this.scheduled.add(epoch);
    this.active = this.active.then(async () => {
      if (epoch !== this.epoch) { return; }
      const accountKey = session.key.toEncoded();
      try {
        await this.vault.recoverAccountKeyRotation(session.userId, accountKey);
        const metadata = await this.vault.protectionMetadata();
        if (metadata == null || epoch !== this.epoch) { return; }
        if (metadata.attachedUserId != null && metadata.attachedUserId !== session.userId) {
          await this.vault.lock();
          return;
        }
        if (this.vault.state$.value === "persisted-locked") {
          if (metadata.attachedUserId !== session.userId && metadata.cutover?.accountUserId !== session.userId) {
            return;
          }
          await this.vault.unlockWithAccount(session.userId, accountKey);
        }
        if (epoch !== this.epoch) { return; }
        if ((await this.vault.protectionMetadata())?.cutover?.rotation != null) { return; }
        if (metadata.attachedUserId != null && metadata.finalizingMigrationId == null && metadata.pendingMigrationId == null) {
          return;
        }
        await this.attach(session.userId, accountKey, metadata.registeredEmail === session.email?.trim().toLowerCase());
      } finally { accountKey.fill(0); }
    }).catch((error: unknown) => { if (epoch === this.epoch) { this.report(error); } })
      .finally(() => { this.scheduled.delete(epoch); });
  }

  async retry(): Promise<void> {
    const operation = this.active.then(async () => {
      const account = await firstValueFrom(this.accounts.activeAccount$);
      if (account == null) {
        throw new Error("Sign in to attach these items.");
      }
      const key = await firstValueFrom(this.keys.userKey$(account.id));
      if (key == null) {
        throw new Error("Unlock the account to attach these items.");
      }
      const bytes = key.toEncoded();
      try {
        const metadata = await this.vault.protectionMetadata();
        if (this.vault.state$.value === "persisted-locked" && metadata?.attachedUserId === account.id) {
          await this.vault.unlockWithAccount(account.id, bytes);
        }
        await this.attach(account.id, bytes, metadata?.registeredEmail === account.email?.trim().toLowerCase());
      } finally {
        bytes.fill(0);
      }
    });
    this.active = operation.catch((error: unknown) => this.report(error));
    await operation;
  }

  private report(error: unknown): void {
    this.error$.next(error instanceof Error ? error.message :
      "The local vault could not be attached. Your saved items are retained.");
  }

  private async attach(userId: UserId, key: Uint8Array, adopted: boolean): Promise<void> {
    if (this.custody == null) {
      throw new Error("Local vault attachment is unavailable. Your saved items are retained.");
    }
    this.error$.next(null);
    const epoch = this.epoch;
    const environment = await firstValueFrom(this.environments.getEnvironment$(userId));
    const apiUrl = new URL(environment.getApiUrl());
    const assertSession = async () => {
      const current = await firstValueFrom(this.accounts.activeAccount$);
      if (epoch !== this.epoch || current?.id !== userId || await firstValueFrom(this.keys.userKey$(userId)) == null) {
        throw new Error("Unlock this account to continue attaching its local items.");
      }
    };
    const send = async (
      method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown, hasResponse = true,
    ): Promise<any> => {
      try {
        await assertSession();
        try { return await this.api.send(method, path, body, userId, hasResponse); }
        finally { await assertSession(); }
      } catch (error: unknown) {
        const failure = error as { statusCode?: number; status?: number; message?: string };
        throw new MigrationHttpError(failure.statusCode ?? failure.status ?? 0,
          failure.message ?? "Account request failed.");
      }
    };
    const remove = async (path: string) => {
      try { await send("DELETE", path, null, false); }
      catch (error) {
        if (!(error instanceof MigrationHttpError) || !(error.status === 404 || error.status === 410 ||
          error.status === 400 && /^(?:Cipher|Attachment) doesn't exist\.?$/i.test(error.message))) { throw error; }
      }
    };
    const transport: MigrationTransport = {
      assertActive: assertSession,
      createCipher: (body) => send("POST", "/ciphers", body),
      getCipher: (id) => send("GET", `/ciphers/${encodeURIComponent(id)}`, null),
      updateCipher: (id, body) => send("PUT", `/ciphers/${encodeURIComponent(id)}`, body),
      deleteCipher: (id) => remove(`/ciphers/${encodeURIComponent(id)}`),
      createAttachment: (id, body) => send("POST", `/ciphers/${encodeURIComponent(id)}/attachment/v2`, body),
      uploadAttachment: async (url, encrypted) => {
        await assertSession();
        const upload = new URL(url.replace(/^\//, ""), `${apiUrl.href.replace(/\/$/, "")}/`);
        if (upload.origin !== apiUrl.origin) {
          throw new Error("The attachment upload address is not on this vault's server.");
        }
        const data = new FormData();
        data.append("data", encrypted, "attachment");
        try { await this.api.send("POST", "", data, userId, false, upload.href); }
        finally { await assertSession(); }
      },
      downloadAttachment: async (cipherId, attachmentId) => {
        const attachment = await send("GET",
          `/ciphers/${encodeURIComponent(cipherId)}/attachment/${encodeURIComponent(attachmentId)}`, null);
        const response = await fetch(attachment.url, { credentials: "omit" });
        if (!response.ok) {
          throw new MigrationHttpError(response.status, "The uploaded attachment could not be read back.");
        }
        return new Uint8Array(await response.arrayBuffer());
      },
      deleteAttachment: (cipherId, attachmentId) => remove(
        `/ciphers/${encodeURIComponent(cipherId)}/attachment/${encodeURIComponent(attachmentId)}`),
      putFormBinding: async (id, encryptedBinding, profileCipherId) => {
        const current = await send("GET", "/form-bindings", null);
        const rows = Array.isArray(current) ? current : current.data;
        const existing = rows?.find((row: { bindingId: string }) => row.bindingId === id);
        if (existing?.encryptedBinding !== encryptedBinding || existing?.profileCipherId !== profileCipherId) {
          const saved = await send("PUT", `/form-bindings/${encodeURIComponent(id)}`, {
            bindingId: id, encryptedBinding, profileCipherId, revision: existing?.revision ?? 0,
          });
          if (saved.encryptedBinding !== encryptedBinding || saved.profileCipherId !== profileCipherId) {
            throw new Error("The form binding could not be verified.");
          }
        }
      },
    };
    try {
      const outcome = await new LocalVaultMigration(this.vault, transport, this.custody).attach(
        userId, key, adopted ? "new-account" : "existing-account", adopted,
      );
      if (outcome === "attached") {
        await send("POST", "/accounts/guest-attached", { newAccount: adopted }, false)
          .catch((): void => undefined);
      }
    } finally {
      const metadata = await this.vault.protectionMetadata();
      if (epoch !== this.epoch && (metadata?.attachedUserId != null || metadata?.cutover != null)) {
        await this.vault.lock();
      }
    }
  }
}
