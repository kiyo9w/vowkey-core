import { inject, Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
// eslint-disable-next-line no-restricted-imports
import { EncString, EncryptService } from "@vowkey/legacy-crypto";
import { KeyService } from "@vowkey/key-management";
import { OrganizationId, UserId } from "@vowkey/common/types/guid";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { DecisionRequest, ProductInference } from "@vowkey/common/vault/local/product-inference";
import { checksum, requestHash } from "@vowkey/common/vault/local/canonical-json";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CipherData } from "@vowkey/common/vault/models/data/cipher.data";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherRequest } from "@vowkey/common/vault/models/request/cipher.request";
import { CipherResponse } from "@vowkey/common/vault/models/response/cipher.response";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { chooseDetails } from "@vowkey/common/vault/profile/decision-choices";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import { ProfileDetailEdit, ProfileService } from "@vowkey/common/vault/profile/profile.service";
import { ProfileDocumentActions } from "@vowkey/vault";
import {
  applyProjection,
  attachSourceBytes,
  CapturedValue,
  CapturedSourceInput,
  Locator,
  migrateLegacyProfile,
  projectEnvelope,
  recordCapture,
  VariantOrigin,
  newEnvelope,
  readEnvelope,
  envelopeState,
  prepareProfileSave,
  copySourceToProfile,
  markSourceDeleted,
  profileRefOf,
  profileUsableForFill,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";

import { PdfFormField } from "../../capture/types/capture";
import {
  capture_document_text,
  CapturedDocument,
  ChosenField,
  decision_begin,
  decision_finish,
  decision_requests,
  decision_take_first_answers,
  decode_document_barcode,
  detail_label,
  fill_docx_with_profile,
  fill_fields_from_profile,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
  Locator as SdkLocator,
  profile_details,
  profile_stored_details,
  PureCrypto,
} from "@vowkey/sdk-internal";

/** A detail read from a document, as it sits in a profile now. */
export interface AddedDetail {
  key: string;
  label: string;
  value: string;
  /** True for a machine-readable zone whose check digits all pass. */
  verified: boolean;
}

/** What adding a document did. */
export interface DocumentAdded {
  profile: CipherView;
  created: boolean;
  /** The details the profile did not have, or had differently. */
  added: AddedDetail[];
  /** Whether the original file was attached to the profile. */
  attached: boolean;
  sourceId?: string;
  operationId?: string;
}

interface DocumentOperation {
  v: 1;
  intentId: string;
  kind: "capture" | "move" | "delete";
  cipherId: string;
  sourceId: string;
  allocation?: { attachmentId: string; uploadUrl: string };
  bytes?: string;
  uploaded?: boolean;
  originCipherId?: string;
  originSourceId?: string;
  replaceSourceId?: string;
  created?: boolean;
  source?: CapturedSourceInput;
  values?: CapturedValue[];
  capturedAt?: string;
  create?: { localId: string; body: Record<string, unknown>; hash: string };
  upload?: { localId: string; body: Record<string, unknown>; hash: string; contents: string };
}

export interface PendingDocumentOperation {
  id: string;
  kind: DocumentOperation["kind"];
  profileId: string;
  sourceId: string;
  fileName: string;
}

export class CaptureProfileChoiceRequiredError extends Error {
  constructor(readonly profiles: CipherView[]) {
    super("Choose the profile this document belongs to.");
  }
}

export interface CaptureDestination {
  profileId?: string;
  operationId?: string;
  replaceSourceId?: string;
}

/** Numbers printed on a document that belong to one person. */
const PERSONAL_NUMBERS = [
  "id.passport.number",
  "id.residence_card.number",
  "id.driver_license.number",
  "id.ssn",
  "id.mynumber",
];

/** Where a document writes the holder's whole name, in one script or another. */
const FULL_NAMES = [
  "name.full",
  "name.full.latin",
  "name.full.kana",
  "bank.account.holder.kanji",
  "bank.account.holder.kana",
];

const normalized = (value: string | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim().toUpperCase();

const same = (a: string | undefined, b: string | undefined) =>
  normalized(a) !== "" && normalized(a) === normalized(b);

/** Whether two sets of details are one person's: a shared number or name, or the same family name
 * with a given name in common. */
export function isSamePerson(known: Map<string, string>, read: Map<string, string>): boolean {
  if (PERSONAL_NUMBERS.some((key) => same(known.get(key), read.get(key)))) {
    return true;
  }
  const names = new Set(FULL_NAMES.map((key) => normalized(known.get(key))).filter(Boolean));
  if (FULL_NAMES.some((key) => names.has(normalized(read.get(key))) && read.get(key))) {
    return true;
  }
  const pairs = [
    ["name.family.latin", "name.given.latin"],
    ["name.family", "name.given"],
  ];
  return pairs.some(([family, given]) =>
    pairs.some(([readFamily, readGiven]) => {
      const readNames = normalized(read.get(readGiven)).split(" ");
      return (
        same(known.get(family), read.get(readFamily)) &&
        normalized(known.get(given))
          .split(" ")
          .some((name) => name !== "" && readNames.includes(name))
      );
    }),
  );
}

const TEXT_FILE = /\.(txt|md|csv|json)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic)$/i;
export const FILLABLE_FORM = /\.(docx|xlsx|hwpx)$/i;
/** Field names that say nothing about the field, such as "Text12" or "Check Box3". */
const OPAQUE_NAME =
  /^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$/i;

/** Why a photo could not be read in full: its print is too small, or the photo is too unclear. */
export type Unclear = "small" | "unclear";

/** What a document says, and whether its photo was too hard to read in full. */
export interface DocumentRead {
  captured: CapturedDocument;
  unclear: Unclear | null;
}

/** The print of a photographed page is too small to read when its lines are under this many pixels tall. */
const SMALL_PRINT_PIXELS = 10;

/**
 * Whether a reading says its photo was too hard to read: text recognition was unsure of most of
 * the print on a page, as it is on a page photographed from too far away or out of focus.
 */
export function unclearReading(reading: string): Unclear | null {
  let pages: { unsure?: number; lineHeight?: number }[];
  try {
    pages = JSON.parse(reading).pages ?? [];
  } catch {
    return null;
  }
  const page = pages.find((p) => (p.unsure ?? 0) >= 0.5);
  if (page == null) {
    return null;
  }
  return page.lineHeight != null && page.lineHeight < SMALL_PRINT_PIXELS ? "small" : "unclear";
}

const ORIGINS: Record<string, VariantOrigin> = {
  mrz: "mrz",
  aamva: "barcode",
  cccd: "barcode",
  text: "text",
  decision: "ocr",
};

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
};

function mediaTypeOf(fileName: string): string {
  return MEDIA_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

/** Where the reader found a detail, in the shape the profile keeps it. */
function locatorOf(place: SdkLocator | undefined | null): Locator | null {
  if (place == null) {
    return null;
  }
  return place.kind === "cell"
    ? {
        kind: "cell",
        page: place.page,
        row: place.row ?? 0,
        column: place.column ?? 0,
        a1: place.a1 ?? null,
        table: place.table ?? null,
      }
    : { kind: "page", page: place.page, x: place.x, y: place.y, w: place.w, h: place.h };
}

/** The first date a document states for a key ending in `suffix`, such as `.issued` or `.expiry`. */
function statedDate(read: Map<string, string>, suffix: string): string | null {
  for (const [key, value] of read) {
    if (key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

/** Reads documents into profiles, and fills forms from them. */
@Injectable({ providedIn: "root" })
export class DocumentCaptureService {
  private accountService = inject(AccountService);
  private cipherService = inject(CipherService);
  private api = inject(ApiService);
  private paths = new WeakMap<File, string>();
  private localVault = inject(LocalVaultService, { optional: true });
  private inference = inject(ProductInference);
  private encryptService = inject(EncryptService, { optional: true });
  private keyService = inject(KeyService, { optional: true });
  private mutations: Promise<unknown> = Promise.resolve();
  private profileService = new ProfileService(this.accountService, this.cipherService, this.localVault);

  private async userId(): Promise<UserId | null> {
    return (await firstValueFrom(this.accountService.activeAccount$))?.id ?? null;
  }

  private local(): LocalVaultService {
    if (this.localVault == null) {
      throw new Error("The local vault is unavailable.");
    }
    return this.localVault;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation);
    this.mutations = next.catch((): void => undefined);
    return next;
  }

  private async assertAccount(userId: UserId | null): Promise<void> {
    if (await this.userId() !== userId) {
      throw new Error("The active vault changed. Try again from that vault.");
    }
  }

  private async accountResponse(value: unknown, userId: UserId): Promise<CipherView> {
    if (value == null || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" ||
      !("revisionDate" in value) || typeof value.revisionDate !== "string" ||
      !("type" in value) || value.type !== CipherType.Identity) {
      throw new Error("The server returned an invalid profile.");
    }
    await this.assertAccount(userId);
    const data = new CipherData(new CipherResponse(value));
    await this.cipherService.upsert(data, userId);
    const profile = await this.cipherService.decrypt(new Cipher(data), userId);
    await this.assertAccount(userId);
    return profile;
  }

  private async storedProfile(id: string, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    const profile = userId != null
      ? await this.accountResponse(await this.api.send("GET", `/ciphers/${encodeURIComponent(id)}`, null, userId, true), userId)
      : (await this.local().list()).find((cipher) => cipher.id === id);
    await this.assertAccount(userId);
    if (profile == null || profile.type !== CipherType.Identity || profile.isDeleted || profile.migrationPending) {
      throw new Error("The profile is unavailable.");
    }
    return CipherView.fromSdkCipherView(profile.toSdkCipherView())!;
  }

  private async saveProfile(profile: CipherView, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    prepareProfileSave(profile);
    const saved = userId != null
      ? await this.cipherService.updateWithServer(profile, userId)
      : await this.local().save(profile);
    await this.assertAccount(userId);
    return saved;
  }

  private async saveOperation(id: string, operation: DocumentOperation, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    const plain = JSON.stringify(operation);
    const encrypted = userId != null
      ? (await this.encryptService!.encryptString(plain, await firstValueFrom(this.keyService!.userKey$(userId)))).encryptedString
      : await this.local().seal(plain);
    await this.local().saveOperation(userId ?? `local:${await this.local().installationId()}`, id, encrypted);
  }

  private async operation(id: string, userId: UserId | null): Promise<DocumentOperation | null> {
    const encrypted = await this.local().operation(userId ?? `local:${await this.local().installationId()}`, id);
    if (encrypted == null) {
      return null;
    }
    const plain = userId != null
      ? await this.encryptService!.decryptString(new EncString(encrypted), await firstValueFrom(this.keyService!.userKey$(userId)))
      : await this.local().open(encrypted);
    await this.assertAccount(userId);
    return parseDocumentOperation(JSON.parse(plain));
  }

  private async clearOperation(id: string, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    await this.local().deleteOperation(userId ?? `local:${await this.local().installationId()}`, id);
  }

  async pendingOperations(): Promise<PendingDocumentOperation[]> {
    const userId = await this.userId();
    const rows = await this.local().listOperations(userId ?? `local:${await this.local().installationId()}`);
    const pending: PendingDocumentOperation[] = [];
    for (const row of rows) {
      if (!row.id.startsWith("document:")) {
        continue;
      }
      const operation = await this.operation(row.id, userId);
      if (operation != null) {
        pending.push({
          id: row.id, kind: operation.kind, profileId: operation.cipherId, sourceId: operation.sourceId,
          fileName: operation.source?.fileName ?? "Document",
        });
      }
    }
    return pending;
  }

  async retryOperation(id: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operation = await this.operation(id, userId);
      if (operation == null) {
        throw new Error("The document operation is unavailable.");
      }
      const profile = operation.kind === "capture"
        ? await this.completeCapture(id, operation, userId)
        : operation.kind === "move"
          ? await this.completeMove(id, operation, userId)
          : await this.removeDocument(operation.cipherId, operation.sourceId, userId);
      await this.clearOperation(id, userId);
      return profile;
    });
  }

  /** The people whose details the vault holds: its Identity items. */
  async profiles(): Promise<CipherView[]> {
    const userId = await this.userId();
    const ciphers = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    return ciphers.filter((cipher) => cipher.type === CipherType.Identity && !cipher.isDeleted && !cipher.migrationPending);
  }

  /** The details a profile holds, as they were saved. */
  detailsOf(profile: CipherView): Map<string, string> {
    return profile_stored_details(profileFieldsOf(profile)).details;
  }

  /** The text of a document: what this computer reads from a PDF or a photo, or a plain file's. */
  async readText(file: File, bytes: Uint8Array): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return new TextDecoder().decode(bytes);
    }
    let text = await ipc.capture.readDocument(bytes, file.name);
    if (IMAGE_FILE.test(file.name)) {
      try {
        text += "\n" + decode_document_barcode(bytes).text;
      } catch {
        // The photo has no barcode, which is usual.
      }
    }
    return text;
  }

  /**
   * Decision is asked through the key set up on this computer when there is one (an environment
   * setting or the Mac keychain), and through the hosted relay otherwise.
   */
  private async decide(request: DecisionRequest): Promise<unknown> {
    if ((await ipc.capture.decisionSettings()) != null) {
      return ipc.capture.askDecision(request);
    }
    return this.inference.decide(request);
  }

  /** Printed pieces retain their location; standard MRZ/barcode data also works offline. */
  async read(file: File, bytes: Uint8Array): Promise<DocumentRead> {
    const year = new Date().getFullYear();
    try {
      const settings = await ipc.capture.decisionSettings();
      return await this.readWithDecision(file, bytes, year, settings?.perRequest ?? 0);
    } catch (error) {
      const captured = capture_document_text(await this.readText(file, bytes), year);
      if (captured.details.size > 0) {
        return { captured, unclear: null };
      }
      throw error;
    }
  }

  private async readWithDecision(
    file: File,
    bytes: Uint8Array,
    year: number,
    perRequest: number,
  ): Promise<DocumentRead> {
    const reading = TEXT_FILE.test(file.name)
      ? JSON.stringify({
          pages: [
            {
              index: 0,
              pieces: new TextDecoder()
                .decode(bytes)
                .split("\n")
                .map((text) => ({ text }))
                .filter((piece) => piece.text.trim() !== ""),
            },
          ],
        })
      : await ipc.capture.readPieces(bytes, file.name);
    const ask = (requests: string) =>
      Promise.all((JSON.parse(requests) as DecisionRequest[]).map((r) => this.decide(r)));

    let plan = decision_begin(reading, perRequest);
    plan = decision_take_first_answers(
      plan,
      JSON.stringify(await ask(decision_requests(plan, false))),
    );
    const second = await ask(decision_requests(plan, true));

    let barcode = "";
    if (IMAGE_FILE.test(file.name)) {
      try {
        barcode = decode_document_barcode(bytes).text;
      } catch {
        // The photo has no barcode, which is usual.
      }
    }
    return {
      captured: decision_finish(plan, JSON.stringify(second), barcode, year),
      unclear: unclearReading(reading),
    };
  }

  /** Adds what a document says to the profile it belongs to, or to a new one. */
  async add(text: string, file: File, bytes: Uint8Array): Promise<DocumentAdded | null> {
    return this.addCaptured(capture_document_text(text, new Date().getFullYear()), file, bytes);
  }

  /** Adds the details read from a document to the profile it belongs to, or to a new one. */
  async addCaptured(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination = {},
  ): Promise<DocumentAdded | null> {
    return this.exclusive(() => this.capture(captured, file, bytes, destination));
  }

  private async capture(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination,
  ): Promise<DocumentAdded | null> {
    const read = new Map([...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"));
    if (read.size === 0) {
      return null;
    }
    const userId = await this.userId();
    const profiles = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    const matches = profiles.filter((profile) => profile.type === CipherType.Identity &&
      !profile.isDeleted && !profile.migrationPending &&
      (envelopeState(profile) === "none" || profileUsableForFill(profile)) &&
      isSamePerson(this.detailsOf(profile), read));
    if (matches.length > 1 && destination.profileId == null) {
      throw new CaptureProfileChoiceRequiredError(matches);
    }
    const existing = destination.profileId != null
      ? await this.storedProfile(destination.profileId, userId)
      : matches.length === 1 ? await this.storedProfile(matches[0].id, userId) : null;
    if (existing != null && !existing.edit) {
      throw new Error("This profile is read-only.");
    }
    const profile = existing ?? this.newProfile(read, file);
    profile.id ||= crypto.randomUUID();
    const known = existing != null ? this.detailsOf(existing) : new Map<string, string>();
    const added = [...read].filter(([key, value]) => known.get(key) !== value).map(([key, value]) => ({
      key, value, label: detail_label(key), verified: captured.sources.get(key)?.verified ?? false,
    }));
    const operation: DocumentOperation = {
      v: 1, kind: "capture", cipherId: profile.id, sourceId: crypto.randomUUID(),
      intentId: crypto.randomUUID(), bytes: Utils.fromBufferToB64(bytes), capturedAt: new Date().toISOString(),
      created: existing == null, replaceSourceId: destination.replaceSourceId,
      source: {
        fileName: file.name, mediaType: mediaTypeOf(file.name), kind: "document",
        documentDate: statedDate(read, ".issued"), expiresOn: statedDate(read, ".expiry"),
      },
      values: [...read].map(([key, value]) => {
        const source = captured.sources.get(key);
        return { key, value, origin: ORIGINS[source?.kind ?? "text"] ?? "ocr",
          verified: source?.verified ?? false, locator: locatorOf(source?.locator) };
      }),
    };
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (destination.replaceSourceId != null && !meta.sources.some((source) =>
      source.id === destination.replaceSourceId && source.status !== "deleted" && source.attachmentId != null)) {
      throw new Error("The document being replaced is unavailable.");
    }
    if (userId == null) {
      const attachmentId = crypto.randomUUID();
      this.commitCaptureMetadata(profile, operation, attachmentId);
      const saved = await this.local().save(profile, [{ id: attachmentId, fileName: file.name, bytes }]);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId };
    }
    const operationId = `document:${operation.intentId}`;
    if (existing == null) {
      writeEnvelope(profile, newEnvelope(profile.id));
      const context = await this.cipherService.encrypt(profile, userId);
      const body: Record<string, unknown> = JSON.parse(JSON.stringify(new CipherRequest(context)));
      if (typeof body.key !== "string" || !body.key) {
        throw new Error("The profile's encryption key is unavailable.");
      }
      body.migrationPending = false;
      operation.create = { localId: profile.id, body, hash: await requestHash(body) };
    }
    await this.saveOperation(operationId, operation, userId);
    try {
      const saved = await this.completeCapture(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId, operationId };
    } catch {
      profile.id = operation.cipherId;
      return { profile, created: existing == null, added, attached: false, sourceId: operation.sourceId, operationId };
    }
  }

  private commitCaptureMetadata(profile: CipherView, operation: DocumentOperation, attachmentId: string): void {
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (!meta.sources.some((source) => source.id === operation.sourceId)) {
      const previous = [...projectEnvelope(meta).text.keys()];
      let firstId = true;
      recordCapture(meta, operation.source!, operation.values!, {
        labelOf: detail_label, now: () => new Date(operation.capturedAt!),
        newId: () => { if (firstId) { firstId = false; return operation.sourceId; } return crypto.randomUUID(); },
      });
      attachSourceBytes(meta, operation.sourceId, attachmentId);
      if (operation.replaceSourceId != null) {
        const old = meta.sources.find((source) => source.id === operation.replaceSourceId);
        if (old == null || old.status === "deleted" || old.attachmentId == null) {
          throw new Error("The document being replaced is unavailable.");
        }
        old.status = "retained";
      }
      writeEnvelope(profile, meta);
      applyProjection(profile, projectEnvelope(meta), previous);
    }
  }

  private async completeCapture(id: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    if (userId == null) {
      throw new Error("Local document saves are atomic and do not need an upload retry.");
    }
    if (operation.create != null) {
      const create = operation.create;
      const response: unknown = await this.api.send("POST", "/ciphers", {
        ...create.body, migrationId: operation.intentId, localResourceId: create.localId, requestHash: create.hash,
      }, userId, true);
      const created = await this.accountResponse(response, userId);
      operation.cipherId = created.id;
      await this.saveOperation(id, operation, userId);
    }
    let profile = await this.storedProfile(operation.cipherId, userId);
    const committed = readEnvelope(profile)?.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId != null) {
      return profile;
    }
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    const bytes = new Uint8Array(Utils.fromB64ToArray(operation.bytes!));
    await this.uploadDocument(profile, id, operation, bytes, userId);
    profile = await this.storedProfile(operation.cipherId, userId);
    this.commitCaptureMetadata(profile, operation, operation.allocation!.attachmentId);
    const saved = await this.saveProfile(profile, userId);
    if (!readEnvelope(saved)?.sources.some((source) =>
      source.id === operation.sourceId && source.attachmentId === operation.allocation!.attachmentId)) {
      throw new Error("The document was uploaded but its profile update was not acknowledged.");
    }
    return saved;
  }

  private async uploadDocument(profile: CipherView, id: string, operation: DocumentOperation, bytes: Uint8Array, userId: UserId): Promise<void> {
    await this.assertAccount(userId);
    if (operation.uploaded) {
      return;
    }
    if (operation.upload == null) {
      const { cipher } = await this.cipherService.encrypt(profile, userId);
      const key = profile.organizationId == null
        ? await firstValueFrom(this.keyService!.userKey$(userId))
        : (await firstValueFrom(this.keyService!.orgKeys$(userId)))[profile.organizationId as OrganizationId];
      if (key == null) {
        throw new Error("Unlock the vault to upload this document.");
      }
      const encoded = key.toEncoded();
      try {
        const localId = crypto.randomUUID();
        const prepared = PureCrypto.encrypt_legacy_attachment(cipher.toSdkCipher(), {
          id: localId, fileName: operation.source!.fileName,
        }, bytes, encoded);
        const contents = Uint8Array.from(prepared.contents);
        const body = {
          key: prepared.attachment.key, fileName: prepared.attachment.fileName,
          fileSize: contents.byteLength, bytesChecksum: await checksum(contents),
          lastKnownRevisionDate: profile.revisionDate.toISOString(),
        };
        operation.upload = { localId, body, hash: await requestHash(body), contents: Utils.fromBufferToB64(contents) };
      } finally {
        encoded.fill(0);
      }
      await this.saveOperation(id, operation, userId);
    }
    const upload = operation.upload;
    const allocation: unknown = await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/v2`, {
      ...upload.body, migrationId: operation.intentId, localResourceId: upload.localId, requestHash: upload.hash,
    }, userId, true);
    if (allocation == null || typeof allocation !== "object" ||
      !("attachmentId" in allocation) || typeof allocation.attachmentId !== "string" ||
      !("url" in allocation) || typeof allocation.url !== "string") {
      throw new Error("The attachment allocation was not acknowledged.");
    }
    operation.allocation = { attachmentId: allocation.attachmentId, uploadUrl: allocation.url };
    await this.saveOperation(id, operation, userId);
    await this.assertAccount(userId);
    const form = new FormData();
    form.append("data", new Blob([new Uint8Array(Utils.fromB64ToArray(upload.contents)).buffer]), "attachment");
    await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/${encodeURIComponent(operation.allocation.attachmentId)}`,
      form, userId, false);
    const metadata: unknown = await this.api.send("GET",
      `/ciphers/${encodeURIComponent(profile.id)}/attachment/${encodeURIComponent(operation.allocation.attachmentId)}`, null, userId, true);
    if (metadata == null || typeof metadata !== "object" || !("url" in metadata) || typeof metadata.url !== "string") {
      throw new Error("The uploaded document could not be verified.");
    }
    const response = await fetch(metadata.url, { credentials: "omit" });
    if (!response.ok || await checksum(new Uint8Array(await response.arrayBuffer())) !== upload.body.bytesChecksum) {
      throw new Error("The uploaded document could not be verified.");
    }
    operation.uploaded = true;
    await this.saveOperation(id, operation, userId);
  }

  async retryCapture(operationId: string): Promise<CipherView> {
    return this.retryOperation(operationId);
  }

  /** Saves an explicit correction, alternative selection, dismissal or detail deletion. */
  async editDetail(profileId: string, edit: ProfileDetailEdit): Promise<CipherView> {
    return this.exclusive(() => this.profileService.edit(profileId, edit));
  }

  /** A replacement is a new capture source; retained history keeps the old bytes and locator. */
  async replaceDocument(
    profileId: string, sourceId: string, captured: CapturedDocument, file: File, bytes: Uint8Array,
  ): Promise<DocumentAdded | null> {
    return this.addCaptured(captured, file, bytes, { profileId, replaceSourceId: sourceId });
  }

  /** Deletes only bytes. Saved details and history retain the original logical source id. */
  async deleteDocument(profileId: string, sourceId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operationId = `document:delete:${profileId}:${sourceId}`;
      const operation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "delete", cipherId: profileId, sourceId,
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.removeDocument(profileId, sourceId, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async removeDocument(profileId: string, sourceId: string, userId: UserId | null): Promise<CipherView> {
    let profile = await this.storedProfile(profileId, userId);
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    let meta = migrateLegacyProfile(profile);
    const source = meta.sources.find((candidate) => candidate.id === sourceId);
    if (source == null) {
      throw new Error("The document is unavailable.");
    }
    const attachmentId = source.attachmentId;
    if (userId == null) {
      markSourceDeleted(meta, sourceId);
      writeEnvelope(profile, meta);
      const present = attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId);
      return this.local().save(profile, [], present ? [attachmentId] : []);
    }
    if (attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId)) {
      await this.cipherService.deleteAttachmentWithServer(profileId, attachmentId, userId, false);
      profile = await this.storedProfile(profileId, userId);
      meta = migrateLegacyProfile(profile);
    }
    markSourceDeleted(meta, sourceId);
    writeEnvelope(profile, meta);
    return this.saveProfile(profile, userId);
  }

  /** Downloads only the original source's bytes; a deleted source never substitutes a replacement. */
  async documentBytes(profileId: string, sourceId: string): Promise<Uint8Array> {
    return this.profileService.bytes(profileId, sourceId);
  }

  /** The origin is retired only after a verified destination source update is acknowledged. */
  async moveDocument(originId: string, sourceId: string, destinationId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      if (originId === destinationId) {
        throw new Error("Choose a different destination profile.");
      }
      const userId = await this.userId();
      const operationId = `document:move:${originId}:${sourceId}:${destinationId}`;
      const origin = await this.storedProfile(originId, userId);
      const destination = await this.storedProfile(destinationId, userId);
      const source = readEnvelope(origin)?.sources.find((item) => item.id === sourceId);
      if (!origin.edit || !destination.edit || source == null || source.status === "deleted" || source.attachmentId == null) {
        throw new Error("Both profiles must be editable and the document must be available.");
      }
      const operation: DocumentOperation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "move", cipherId: destinationId, sourceId: crypto.randomUUID(),
        originCipherId: originId, originSourceId: sourceId,
        source: { fileName: source.fileName, mediaType: source.mediaType, kind: source.kind },
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.completeMove(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async completeMove(operationId: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    let destination = await this.storedProfile(operation.cipherId, userId);
    const origin = await this.storedProfile(operation.originCipherId!, userId);
    if (!origin.edit || !destination.edit) {
      throw new Error("Both profiles must be editable to move a document.");
    }
    const originMeta = migrateLegacyProfile(origin);
    let meta = migrateLegacyProfile(destination);
    const committed = meta.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId == null) {
      const bytes = await this.documentBytes(origin.id, operation.originSourceId!);
      await this.assertAccount(userId);
      const previous = [...projectEnvelope(meta).text.keys()];
      if (userId == null) {
        const attachmentId = crypto.randomUUID();
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), previous);
        destination = await this.local().save(destination, [{ id: attachmentId, fileName: operation.source!.fileName, bytes }]);
      } else {
        await this.uploadDocument(destination, operationId, operation, bytes, userId);
        destination = await this.storedProfile(destination.id, userId);
        meta = migrateLegacyProfile(destination);
        const currentNames = [...projectEnvelope(meta).text.keys()];
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, operation.allocation!.attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), currentNames);
        destination = await this.saveProfile(destination, userId);
      }
    }
    const savedSource = readEnvelope(destination)?.sources.find((source) => source.id === operation.sourceId);
    if (savedSource?.attachmentId == null || savedSource.status === "deleted") {
      throw new Error("The destination document was not committed.");
    }
    await this.removeDocument(origin.id, operation.originSourceId!, userId);
    return destination;
  }

  /** Associations resolve only their explicit accessible, confirmed profile. */
  async associatedProfile(item: CipherView): Promise<CipherView | null> {
    const id = profileRefOf(item);
    if (id == null) {
      return null;
    }
    const profile = (await this.profiles()).find((candidate) => candidate.id === id);
    return profileUsableForFill(profile) ? profile! : null;
  }

  private newProfile(read: Map<string, string>, file: File): CipherView {
    const given = read.get("name.given.latin");
    const family = read.get("name.family.latin");
    const profile = new CipherView();
    profile.type = CipherType.Identity;
    profile.identity = new IdentityView();
    profile.name =
      (given && family ? `${given} ${family}` : undefined) ??
      read.get("name.full.latin") ??
      read.get("name.full") ??
      file.name.replace(/\.[^.]+$/, "");
    return profile;
  }

  /** Fills a Word, Excel or Hangul form from a profile and saves the copy beside the original. */
  async fillForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const details = { details: profile_details(profileFieldsOf(profile)).details };
    const lower = file.name.toLowerCase();
    const result = lower.endsWith(".docx")
      ? fill_docx_with_profile(bytes, details)
      : lower.endsWith(".xlsx")
        ? fill_xlsx_with_profile(bytes, details)
        : fill_hwpx_with_profile(bytes, details);
    if (result.report.filled_count === 0) {
      return { path: null, filled: 0 };
    }
    const path = await ipc.capture.saveCopy({
      sourcePath: this.sourcePathOf(file),
      name: file.name,
      bytes: Uint8Array.from(result.bytes),
    });
    return { path, filled: result.report.filled_count };
  }

  /** Fills a PDF form from a profile the way Preview does, and saves the copy beside the original. */
  async fillPdfForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const fields = (await ipc.capture.readPdfForm(bytes)).filter(
      (field) => field.type === "text" || field.type === "select-one",
    );
    const inputs = fields.map(pdfFieldInput);
    const { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFieldsOf(profile),
      explicit_fill: true,
      choices: await this.choicesFor(inputs, profile),
    });
    const values: Record<string, string> = {};
    matches.forEach((match, index) => {
      const field = fields[index];
      let value = match.value?.trim();
      if (!value) {
        return;
      }
      if (field.maxLength > 0) {
        value = value.slice(0, field.maxLength);
      }
      if (field.type === "select-one") {
        value = field.options.find((option) => option.toLowerCase() === value!.toLowerCase());
      }
      if (value) {
        values[field.key] = value;
      }
    });
    if (Object.keys(values).length === 0) {
      return { path: null, filled: 0 };
    }
    return ipc.capture.fillPdfForm({
      sourcePath: this.sourcePathOf(file),
      name: file.name,
      bytes,
      values,
    });
  }

  /** Matching sends field descriptions and held attribute names; values stay in the vault. */
  private async choicesFor(
    fields: ReturnType<typeof pdfFieldInput>[],
    profile: CipherView,
  ): Promise<ChosenField[]> {
    const held = [...profile_details(profileFieldsOf(profile)).details.keys()];
    const settings = await ipc.capture.decisionSettings();
    return chooseDetails(fields, held, (r) => this.decide(r as DecisionRequest), settings?.perRequest ?? 0);
  }

  /** Where a file handed over by path, rather than dropped in this window, lives. */
  rememberPath(file: File, path: string): void {
    this.paths.set(file, path);
  }

  private sourcePathOf(file: File): string | undefined {
    const remembered = this.paths.get(file);
    if (remembered) {
      return remembered;
    }
    try {
      return ipc.capture.pathForFile(file) || undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether the bytes are a PDF with form fields, which the app cannot fill yet. */
  isPdfForm(bytes: Uint8Array): boolean {
    return new TextDecoder("latin1").decode(bytes).includes("/AcroForm");
  }
}

export function documentProfileActionsFactory(documents: DocumentCaptureService): ProfileDocumentActions {
  return {
    remove: (profileId, sourceId) => documents.deleteDocument(profileId, sourceId),
    move: (profileId, sourceId, destinationId) => documents.moveDocument(profileId, sourceId, destinationId),
    profiles: () => documents.profiles(),
    pending: () => documents.pendingOperations(),
    retry: (id) => documents.retryOperation(id),
    replace: async (profileId, sourceId, file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { captured, unclear } = await documents.read(file, bytes);
      if (unclear != null) {
        throw new Error("This photo could not be read. Choose a clearer photo or the original file.");
      }
      const result = await documents.replaceDocument(profileId, sourceId, captured, file, bytes);
      if (result == null) {
        throw new Error("No details were found. The original document is unchanged.");
      }
      if (!result.attached) {
        throw new Error("The replacement upload is waiting. Retry it from the quick bar.");
      }
      return result.profile;
    },
  };
}

function validLocator(value: unknown): boolean {
  if (value == null) { return true; }
  if (typeof value !== "object" || Array.isArray(value) || !("kind" in value) || !("page" in value) ||
    !Number.isInteger(value.page) || Number(value.page) < 0) { return false; }
  if (value.kind === "page") {
    if (!("x" in value && "y" in value && "w" in value && "h" in value)) { return false; }
    return [value.x, value.y, value.w, value.h].every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1) &&
      Number(value.x) + Number(value.w) <= 1.000001 && Number(value.y) + Number(value.h) <= 1.000001;
  }
  return value.kind === "cell" && "row" in value && "column" in value &&
    Number.isInteger(value.row) && Number(value.row) >= 0 && Number.isInteger(value.column) && Number(value.column) >= 0 &&
    (!("a1" in value) || value.a1 == null || typeof value.a1 === "string") &&
    (!("table" in value) || value.table == null || Number.isInteger(value.table) && Number(value.table) >= 0);
}

function parseDocumentOperation(value: unknown): DocumentOperation {
  const unreadable = new Error("The document operation is unreadable. Its saved data has been kept.");
  if (value == null || typeof value !== "object" || Array.isArray(value)) { throw unreadable; }
  // The journal is encrypted; still validate its complete consumed shape before dispatching it.
  const operation = value as DocumentOperation;
  if (operation.v !== 1 || !["capture", "move", "delete"].includes(operation.kind) ||
    ![operation.intentId, operation.cipherId, operation.sourceId].every((id) => typeof id === "string" && !!id) ||
    operation.uploaded != null && typeof operation.uploaded !== "boolean" ||
    operation.created != null && typeof operation.created !== "boolean" ||
    operation.replaceSourceId != null && typeof operation.replaceSourceId !== "string") { throw unreadable; }
  if (operation.kind !== "delete") {
    const source = operation.source;
    if (source == null || typeof source !== "object" ||
      ![source.fileName, source.mediaType, source.kind].every((entry) => typeof entry === "string") ||
      ![source.documentDate, source.effectiveOn, source.expiresOn].every((date) =>
        date == null || typeof date === "string") ||
      source.sides != null && (!Array.isArray(source.sides) || !source.sides.every((side) => typeof side === "string"))) { throw unreadable; }
  }
  if (operation.kind === "capture" && (typeof operation.bytes !== "string" ||
    typeof operation.capturedAt !== "string" || !Number.isFinite(Date.parse(operation.capturedAt)) ||
    !Array.isArray(operation.values) || !operation.values.every((entry) => entry != null && typeof entry === "object" &&
      typeof entry.key === "string" && typeof entry.value === "string" && typeof entry.verified === "boolean" &&
      ["mrz", "barcode", "ocr", "chip", "text", "typed", "correction", "derived", "import"].includes(entry.origin) &&
      validLocator(entry.locator)))) { throw unreadable; }
  if (operation.kind === "move" && (![operation.originCipherId, operation.originSourceId].every((id) =>
    typeof id === "string" && !!id))) { throw unreadable; }
  for (const key of ["create", "upload"] as const) {
    const payload = operation[key];
    if (payload != null && (typeof payload !== "object" || typeof payload.localId !== "string" ||
      typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/.test(payload.hash) ||
      payload.body == null || typeof payload.body !== "object" || Array.isArray(payload.body))) { throw unreadable; }
  }
  if (operation.upload != null && (typeof operation.upload.contents !== "string" ||
    typeof operation.upload.body.key !== "string" || typeof operation.upload.body.fileName !== "string" ||
    typeof operation.upload.body.bytesChecksum !== "string" ||
    !Number.isInteger(operation.upload.body.fileSize) || Number(operation.upload.body.fileSize) < 0)) { throw unreadable; }
  if (operation.allocation != null && (typeof operation.allocation !== "object" ||
    typeof operation.allocation.attachmentId !== "string" || typeof operation.allocation.uploadUrl !== "string")) { throw unreadable; }
  if (operation.uploaded && (operation.upload == null || operation.allocation == null)) { throw unreadable; }
  return operation;
}

/** What the engine needs to know about a PDF field: the words that name it, as a person reads them. */
function pdfFieldInput(field: PdfFormField) {
  const words = [field.tooltip, field.label, field.name]
    .map((word) => word.trim())
    .filter((word) => word !== "" && !OPAQUE_NAME.test(word));
  return {
    id: field.name,
    name: field.name,
    label: [...new Set(words)].join(" — ") || field.label || field.name,
    placeholder: "",
    autocomplete: "",
    input_type: field.type === "select-one" ? "select-one" : "text",
    section: "",
    form: "",
    pattern: "",
    max_length: Math.max(0, field.maxLength),
    format: "",
    op_ignore: false,
  };
}
