import { Cipher as SdkCipher, EncString, PureCrypto } from "@vowkey/sdk-internal";

import { UserId } from "../../types/guid";
import { Cipher } from "../models/domain/cipher";
import { CipherData } from "../models/data/cipher.data";
import { CipherRequest } from "../models/request/cipher.request";
import { CipherResponse } from "../models/response/cipher.response";

import { canonicalJson, checksum, requestHash } from "./canonical-json";
import { LocalAttachmentRecord, LocalVaultService } from "./local-vault.service";
import { LocalWrite } from "./store";

type JsonObject = Record<string, unknown>;
type ItemStatus = "pending" | "posting" | "cipher-uploaded" | "confirmed" | "waiting-for-type" | "local-trash";
const remainsLocal = (item: ItemMigration) => item.status === "waiting-for-type" || item.status === "local-trash";
interface AttachmentMigration {
  discard?: boolean;
  status: "pending" | "posting" | "uploaded" | "confirmed";
  targetAttachmentId: string | null;
  requestHash: string;
  bytesChecksum: string;
  body: JsonObject;
}
interface ItemMigration {
  discard?: boolean;
  resourceId?: string;
  status: ItemStatus;
  targetCipherId: string | null;
  requestHash: string;
  body: JsonObject;
  cipher: SdkCipher;
  finalBody?: JsonObject;
  finalCipher?: SdkCipher;
  publishedSourceRevision?: string;
  attachments: Record<string, AttachmentMigration>;
}
export interface MigrationJournal {
  v: 1;
  migrationId: string;
  mode: "new-account" | "existing-account";
  targetUserId: string;
  keyAdopted: boolean;
  phase: "snapshot" | "upload" | "rewrite" | "local-commit" | "verified";
  items: Record<string, ItemMigration>;
  formBindings: Record<string, { status: "pending" | "confirmed" | "local-pending"; payload: string; requestHash: string }>;
}

export class MigrationHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The caller supplies account HTTP authorization; a guest Decision grant is never accepted here. */
export interface MigrationTransport {
  assertActive?(): Promise<void>;
  createCipher(body: JsonObject): Promise<JsonObject>;
  getCipher(id: string): Promise<JsonObject>;
  updateCipher(id: string, body: JsonObject): Promise<JsonObject>;
  deleteCipher(id: string): Promise<void>;
  createAttachment(cipherId: string, body: JsonObject): Promise<{ attachmentId: string; url: string }>;
  uploadAttachment(url: string, encrypted: Blob): Promise<void>;
  downloadAttachment(cipherId: string, attachmentId: string): Promise<Uint8Array>;
  deleteAttachment(cipherId: string, attachmentId: string): Promise<void>;
  putFormBinding(id: string, encryptedPayload: string, profileCipherId: string): Promise<void>;
}

export interface MigrationCustody {
  /** Take dispatch gate, advance epoch, seal uncertain writes not_confirmed, never replay them. */
  quiesce(migrationId: string): Promise<void>;
  /** Re-protect the local pairing verifier and other local credentials without uploading them. */
  rebind(input: {
    accountUserId: string;
    cipherIds: ReadonlyMap<string, string>;
    attachmentIds: ReadonlyMap<string, string>;
    seal(plain: string): Promise<string>;
    open(encrypted: string): Promise<string>;
    openAccount(encrypted: string): Promise<string>;
  }): Promise<void>;
  /** Remap device state, including environment member item ids, proxy enabledItemIds and placeholders. */
  remapDeviceState?(cipherIds: ReadonlyMap<string, string>): Promise<void>;
  finalize?(migrationId: string, accountUserId: string): Promise<void>;
}

function cipherBody(cipher: SdkCipher, userId: string): JsonObject {
  const domain = Cipher.fromSdkCipher(cipher)!;
  const body = new CipherRequest({ cipher: domain, encryptedFor: userId as UserId, encryptedByKeyId: null });
  // Strip optional undefined properties and serialize Dates before RFC8785 hashing.
  const wire = JSON.parse(JSON.stringify(body)) as JsonObject;
  delete wire.attachments;
  delete wire.attachments2;
  wire.encryptedByKeyId = null;
  wire.migrationPending = true;
  return wire;
}

function responseCipher(response: JsonObject): SdkCipher {
  if (typeof response.id !== "string" || typeof response.revisionDate !== "string") {
    throw new Error("The server returned an invalid migration cipher.");
  }
  return new Cipher(new CipherData(new CipherResponse(response))).toSdkCipher();
}

const CIPHER_JOIN: Record<string, true | undefined> = {
  cipherId: true, sourceCipherId: true, profileId: true, profileCipherId: true,
  originCipherId: true, targetCipherId: true, itemId: true, environmentId: true,
};
const CIPHER_LIST: Record<string, true | undefined> = {
  cipherIds: true, sourceCipherIds: true, itemIds: true, enabledItemIds: true,
};
const ATTACHMENT_JOIN: Record<string, true | undefined> = {
  attachmentId: true, originAttachmentId: true, targetAttachmentId: true,
};

/** Logical detail, variant and source ids are never physical joins. */
export function remapPhysicalIds(
  value: unknown, cipherIds: ReadonlyMap<string, string>, attachmentIds: ReadonlyMap<string, string>,
  oldScope?: string, newScope?: string, property = "",
): unknown {
  if (typeof value === "string") {
    if (CIPHER_JOIN[property] || CIPHER_LIST[property] || property === "sectionProfiles") {
      return cipherIds.get(value) ?? value;
    }
    if (ATTACHMENT_JOIN[property]) {
      return attachmentIds.get(value) ?? value;
    }
    if ((property === "vaultScopeId" || property === "scopeId") && value === oldScope) {
      return newScope ?? value;
    }
    return value.replace(/@vk:([^/\s]+)\//g,
      (match, id: string) => cipherIds.has(id) ? `@vk:${cipherIds.get(id)}/` : match);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => remapPhysicalIds(entry, cipherIds, attachmentIds, oldScope, newScope, property));
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key, remapPhysicalIds(entry, cipherIds, attachmentIds, oldScope, newScope,
        property === "sectionProfiles" ? property : key),
    ]));
  }
  return value;
}

/** Rewrites physical row ids only. Detail, variant, source and variant.sourceId remain logical ids. */
export function remapCipher(
  cipher: SdkCipher, key: Uint8Array,
  cipherIds: ReadonlyMap<string, string>, attachmentIds: ReadonlyMap<string, string>,
): SdkCipher {
  const result = structuredClone(cipher);
  const cipherKey = PureCrypto.unwrap_symmetric_key(result.key!, key);
  try {
    const reference = (text: string) => text.replace(/@vk:([^/\s]+)\//g,
      (match, id: string) => cipherIds.has(id) ? `@vk:${cipherIds.get(id)}/` : match);
    result.id = (cipherIds.get(String(result.id)) ?? result.id) as SdkCipher["id"];
    result.attachments = result.attachments?.map((attachment) => ({
      ...attachment, id: attachmentIds.get(attachment.id!) ?? attachment.id,
    }));
    result.fields = result.fields?.map((field) => {
      const name = field.name == null ? null : PureCrypto.symmetric_decrypt_string(field.name, cipherKey);
      if (name !== "vk.meta" || field.value == null) {
        return field;
      }
      const raw = PureCrypto.symmetric_decrypt_string(field.value, cipherKey);
      const meta = JSON.parse(raw) as JsonObject;
      if (meta.v !== 1) {
        return field;
      }
      if (typeof meta.profileId === "string") {
        meta.profileId = cipherIds.get(meta.profileId) ?? meta.profileId;
      }
      if (meta.profileRef != null && typeof meta.profileRef === "object") {
        const ref = meta.profileRef as JsonObject;
        if (typeof ref.cipherId === "string") {
          ref.cipherId = cipherIds.get(ref.cipherId) ?? ref.cipherId;
        }
      }
      if (Array.isArray(meta.sources)) {
        for (const source of meta.sources) {
          if (source != null && typeof source === "object" && typeof source.attachmentId === "string") {
            source.attachmentId = attachmentIds.get(source.attachmentId) ?? source.attachmentId;
          }
        }
      }
      const rewritten = JSON.stringify(meta);
      return rewritten === raw ? field : { ...field, value: PureCrypto.symmetric_encrypt_string(rewritten, cipherKey) as EncString };
    });
    if (result.environment?.members != null) {
      const raw = PureCrypto.symmetric_decrypt_string(result.environment.members, cipherKey);
      const members = JSON.parse(raw) as { name: string; itemId: string }[];
      let changed = false;
      for (const member of members) {
        const mapped = cipherIds.get(member.itemId);
        if (mapped != null && mapped !== member.itemId) {
          member.itemId = mapped;
          changed = true;
        }
      }
      if (changed) {
        result.environment.members = PureCrypto.symmetric_encrypt_string(JSON.stringify(members), cipherKey) as EncString;
      }
    }
    if (result.notes != null) {
      const raw = PureCrypto.symmetric_decrypt_string(result.notes, cipherKey);
      const rewritten = reference(raw);
      if (rewritten !== raw) {
        result.notes = PureCrypto.symmetric_encrypt_string(rewritten, cipherKey) as EncString;
      }
    }
    return result;
  } finally {
    cipherKey.fill(0);
  }
}

/** A retry reuses the exact persisted ciphertext body, hash and remote row ids. */
export class LocalVaultMigration {
  constructor(
    private readonly vault: LocalVaultService,
    private readonly transport: MigrationTransport,
    private readonly custody: MigrationCustody,
  ) {}

  private async flush(journal: MigrationJournal): Promise<void> {
    await this.vault.store.commit([{
      store: "migrations", id: journal.migrationId, value: await this.vault.seal(JSON.stringify(journal)),
    }]);
  }

  private async complete(journal: MigrationJournal, accountKey: Uint8Array): Promise<"attached" | "attached-local-pending"> {
    const pending = Object.values(journal.items).some(remainsLocal);
    journal.phase = "verified";
    await this.vault.store.commit([{
      store: "migrations", id: `${journal.migrationId}:account`,
      value: PureCrypto.symmetric_encrypt_string(JSON.stringify(journal), accountKey),
    }]);
    await this.custody.finalize?.(journal.migrationId, journal.targetUserId);
    await this.vault.completeMigration(journal.migrationId, pending);
    const writes: LocalWrite[] = [{ store: "migrations", id: journal.migrationId }];
    if (!pending) {
      writes.push({ store: "migrations", id: `${journal.migrationId}:account` });
    }
    await this.vault.store.commit(writes);
    return pending ? "attached-local-pending" : "attached";
  }

  async attach(
    accountUserId: string, accountKey: Uint8Array, mode: "new-account" | "existing-account",
    keyAdopted = false,
  ): Promise<"attached" | "attached-local-pending"> {
    const metadata = await this.vault.migrationMetadata();
    if (metadata.cutover?.rotation != null) {
      throw new Error("Finish the account key rotation before attaching local items.");
    }
    if (metadata.attachedUserId != null && metadata.attachedUserId !== accountUserId) {
      throw new Error("These local items belong to another account.");
    }
    const sourceKey = await this.vault.key();
    let journal: MigrationJournal | undefined;
    try {
      const migrationId = metadata.activeMigrationId ?? metadata.finalizingMigrationId ?? metadata.pendingMigrationId;
      if (migrationId != null) {
        const recovery = await this.vault.store.get<string>("migrations", `${migrationId}:account`);
        if (metadata.activeMigrationId == null || recovery != null && metadata.attachedUserId == null) {
          if (recovery == null) {
            throw new Error("The migration recovery journal is unavailable. The local vault is retained.");
          }
          journal = JSON.parse(PureCrypto.symmetric_decrypt_string(recovery, accountKey)) as MigrationJournal;
          if (journal.targetUserId !== accountUserId) {
            throw new Error("Resume this migration with the original account.");
          }
          if (metadata.finalizingMigrationId != null || journal.phase === "local-commit") {
            await this.transport.assertActive?.();
            await this.vault.finishAttach(accountUserId, accountKey,
              Object.values(journal.items).some(remainsLocal));
            return await this.complete(journal, accountKey);
          }
          if (journal.phase === "verified") {
            for (const item of Object.values(journal.items)) {
              if (remainsLocal(item)) { item.status = "pending"; }
            }
            journal.phase = "snapshot";
          }
          journal.formBindings = {};
          await this.flush(journal);
          await this.vault.setMigration(journal.migrationId);
        } else {
          const encrypted = await this.vault.store.get<string>("migrations", migrationId);
          if (encrypted == null) {
            throw new Error("The migration journal is unavailable. The local vault is retained.");
          }
          journal = JSON.parse(await this.vault.open(encrypted)) as MigrationJournal;
        }
        if (journal.targetUserId !== accountUserId) {
          throw new Error("Resume this migration with the original account.");
        }
      } else {
        if (metadata.attachedUserId != null) {
          return metadata.state ?? "attached";
        }
        if (mode === "new-account" &&
          (!keyAdopted || sourceKey.length !== accountKey.length ||
            sourceKey.some((byte, index) => byte !== accountKey[index]))) {
          throw new Error("Registration has not adopted the local user key.");
        }
        journal = {
          v: 1, migrationId: crypto.randomUUID(), mode, targetUserId: accountUserId, keyAdopted,
          phase: "snapshot", items: {}, formBindings: {},
        };
        await this.flush(journal);
        await this.vault.setMigration(journal.migrationId);
      }

      await this.custody.quiesce(journal.migrationId);
      await this.transport.assertActive?.();
      {
        for (const { id, value } of await this.vault.store.list<SdkCipher>("ciphers")) {
          const previous = journal.items[id];
          if (previous?.status === "confirmed" && previous.cipher.revisionDate === value.revisionDate) {
            continue;
          }
          const cipher = metadata.attachedUserId != null || journal.keyAdopted
            ? value : PureCrypto.rewrap_legacy_cipher_key(value, sourceKey, accountKey);
          const body = cipherBody(cipher, accountUserId);
          const attachments: Record<string, AttachmentMigration> = {};
          const liveAttachmentIds = new Set(cipher.attachments?.map((attachment) => attachment.id));
          for (const [attachmentId, attachment] of Object.entries(previous?.attachments ?? {})) {
            if (!liveAttachmentIds.has(attachmentId)) {
              attachments[attachmentId] = { ...attachment, discard: true };
            }
          }
          for (const attachment of cipher.attachments ?? []) {
            if (attachment.id == null || attachment.key == null) {
              throw new Error("A local attachment is missing its own key.");
            }
            const allocated = previous?.attachments[attachment.id];
            if (allocated != null && !allocated.discard) {
              attachments[attachment.id] = allocated;
              continue;
            }
            const file = await this.vault.store.get<LocalAttachmentRecord>("attachments", attachment.id);
            if (file == null) {
              throw new Error("A local attachment is unavailable. The local vault is retained.");
            }
            const bytesChecksum = await checksum(new Uint8Array(await file.bytes.arrayBuffer()));
            const attachmentBody = {
              key: attachment.key, fileName: attachment.fileName, fileSize: file.bytes.size, bytesChecksum,
            };
            attachments[attachment.id] = {
              status: "pending", targetAttachmentId: null, body: attachmentBody,
              requestHash: await requestHash(attachmentBody), bytesChecksum,
            };
          }
          const inFlight = previous != null && (previous.status === "posting" || previous.targetCipherId != null);
          journal.items[id] = inFlight
            ? { ...previous, cipher, attachments, status: previous.status === "confirmed" ? "cipher-uploaded" : previous.status }
            : { status: cipher.deletedDate == null ? "pending" : "local-trash", targetCipherId: null,
              resourceId: previous?.resourceId, body, cipher, attachments, requestHash: await requestHash(body) };
        }
        journal.phase = "upload";
        await this.flush(journal);
      }

      for (const [id, item] of Object.entries(journal.items)) {
        const remove = item.discard || item.cipher.deletedDate != null && !remainsLocal(item);
        if (remove && item.status !== "posting" && item.targetCipherId == null) {
          if (item.discard) { delete journal.items[id]; }
          else { item.status = "local-trash"; }
          await this.flush(journal);
          continue;
        }
        if (item.status === "pending" || item.status === "posting") {
          item.status = "posting";
          await this.flush(journal);
          try {
            const created = responseCipher(await this.transport.createCipher({
              ...item.body, migrationId: journal.migrationId, localResourceId: item.resourceId ?? id, requestHash: item.requestHash,
            }));
            item.targetCipherId = String(created.id);
            item.status = "cipher-uploaded";
            await this.flush(journal);
          } catch (error) {
            if (error instanceof MigrationHttpError && error.status === 400 &&
              /invalid (?:cipher )?type/i.test(error.message)) {
              item.status = item.cipher.deletedDate == null ? "waiting-for-type" : "local-trash";
              if (item.discard) { delete journal.items[id]; }
              await this.flush(journal);
              continue;
            }
            throw error;
          }
        }
        if (remove) {
          await this.transport.deleteCipher(item.targetCipherId!);
          if (item.discard) { delete journal.items[id]; }
          else {
            item.status = "local-trash";
            item.resourceId = crypto.randomUUID();
            item.targetCipherId = null;
            delete item.finalBody;
            delete item.finalCipher;
            for (const attachment of Object.values(item.attachments)) {
              attachment.status = "pending";
              attachment.targetAttachmentId = null;
            }
          }
          await this.flush(journal);
          continue;
        }
        if (remainsLocal(item) || item.status === "confirmed") {
          continue;
        }
        for (const [attachmentId, attachment] of Object.entries(item.attachments)) {
          if (attachment.discard) {
            if (attachment.status === "posting" && attachment.targetAttachmentId == null) {
              const remote = await this.transport.createAttachment(item.targetCipherId!, {
                ...attachment.body, migrationId: journal.migrationId, localResourceId: attachmentId,
                requestHash: attachment.requestHash,
              });
              attachment.targetAttachmentId = remote.attachmentId;
              await this.flush(journal);
            }
            if (attachment.targetAttachmentId != null) {
              await this.transport.deleteAttachment(item.targetCipherId!, attachment.targetAttachmentId);
            }
            delete item.attachments[attachmentId];
            await this.flush(journal);
            continue;
          }
          if (attachment.status === "confirmed") {
            continue;
          }
          attachment.status = "posting";
          await this.flush(journal);
          const remote = await this.transport.createAttachment(item.targetCipherId!, {
            ...attachment.body, migrationId: journal.migrationId, localResourceId: attachmentId,
            requestHash: attachment.requestHash,
          });
          attachment.targetAttachmentId = remote.attachmentId;
          await this.flush(journal);
          const file = await this.vault.store.get<LocalAttachmentRecord>("attachments", attachmentId);
          if (file == null) {
            throw new Error("A local attachment is unavailable. The local vault is retained.");
          }
          await this.transport.uploadAttachment(remote.url, file.bytes);
          attachment.status = "uploaded";
          await this.flush(journal);
          const bytes = await this.transport.downloadAttachment(item.targetCipherId!, remote.attachmentId);
          if (await checksum(bytes) !== attachment.bytesChecksum) {
            throw new Error("The uploaded attachment could not be verified.");
          }
          attachment.status = "confirmed";
          await this.flush(journal);
        }
      }
      const cipherIds = new Map(Object.entries(journal.items).map(([id, item]) => [id, item.targetCipherId ?? id]));
      const attachmentIds = new Map(Object.values(journal.items).flatMap((item) =>
        Object.entries(item.attachments).map(([id, attachment]) =>
          [id, attachment.targetAttachmentId ?? id] as [string, string]),
      ));
      journal.phase = "rewrite";
      await this.flush(journal);
      for (const item of Object.values(journal.items)) {
        if (remainsLocal(item)) {
          item.finalCipher ??= remapCipher(item.cipher, accountKey, cipherIds, attachmentIds);
          continue;
        }
        const current = await this.transport.getCipher(item.targetCipherId!);
        const changedSincePublication = item.publishedSourceRevision != null &&
          item.publishedSourceRevision !== item.cipher.revisionDate;
        if (current.migrationPending === false && !changedSincePublication) {
          const completed = responseCipher(current);
          PureCrypto.decrypt_legacy_cipher(completed, accountKey);
          const remapped = remapCipher(completed, accountKey, cipherIds, attachmentIds);
          const body = cipherBody(remapped, accountUserId);
          if (samePayload(current, body)) {
            item.finalCipher = completed;
            item.status = "confirmed";
            await this.flush(journal);
            continue;
          }
          item.finalCipher = remapped;
          item.finalBody = {
            ...body, migrationPending: false,
            lastKnownRevisionDate: current.revisionDate,
            expectedRevision: current.vowkeyRevision,
          };
        } else {
          if (current.migrationPending === false && (item.finalBody == null || !samePayload(current, item.finalBody))) {
            throw new Error("The synced item changed on another device. Your local changes are retained.");
          }
          if (item.finalBody == null || changedSincePublication) {
            item.finalCipher = remapCipher(item.cipher, accountKey, cipherIds, attachmentIds);
            item.finalBody = {
              ...cipherBody(item.finalCipher, accountUserId), migrationPending: false,
              lastKnownRevisionDate: current.revisionDate,
              expectedRevision: current.vowkeyRevision,
            };
          }
        }
        if (item.publishedSourceRevision !== item.cipher.revisionDate) {
          item.publishedSourceRevision = item.cipher.revisionDate;
        }
        await this.flush(journal);
        const expected = item.finalBody;
        if (!samePayload(current, expected) || current.migrationPending !== false) {
          await this.flush(journal);
          await this.transport.updateCipher(item.targetCipherId!, expected);
        }
        const verified = await this.transport.getCipher(item.targetCipherId!);
        if (!samePayload(verified, expected) || verified.migrationPending !== false) {
          throw new Error("The migrated item could not be verified.");
        }
        PureCrypto.decrypt_legacy_cipher(responseCipher(verified), accountKey);
        item.finalCipher = responseCipher(verified);
        item.status = "confirmed";
        await this.flush(journal);
      }

      const oldScope = `local:${metadata.installationId}`;
      for (const { id, value } of await this.vault.store.list<string>("formBindings")) {
        let binding = journal.formBindings[id];
        if (binding == null) {
          const plaintext: unknown = JSON.parse(PureCrypto.symmetric_decrypt_string(value, sourceKey));
          const rewritten = remapPhysicalIds(plaintext, cipherIds, attachmentIds, oldScope, accountUserId);
          const payload = PureCrypto.symmetric_encrypt_string(JSON.stringify(rewritten), accountKey);
          binding = journal.formBindings[id] = {
            status: "pending", payload, requestHash: await requestHash({ payload }),
          };
          await this.flush(journal);
        }
        if (binding.status !== "confirmed") {
          const payload: unknown = JSON.parse(PureCrypto.symmetric_decrypt_string(binding.payload, accountKey));
          if (payload == null || typeof payload !== "object" ||
            !("profileCipherId" in payload) || typeof payload.profileCipherId !== "string") {
            throw new Error("The saved form binding has no profile. Its local data is retained.");
          }
          const profile = journal.items[payload.profileCipherId];
          if (profile != null && remainsLocal(profile)) {
            binding.status = "local-pending";
          } else {
            await this.flush(journal);
            await this.transport.putFormBinding(id, binding.payload, payload.profileCipherId);
            binding.status = "confirmed";
          }
          await this.flush(journal);
        }
      }

      const writes: LocalWrite[] = [];
      for (const store of ["agentRecords", "executions", "operations"] as const) {
        for (const { id, value } of await this.vault.store.list<string>(store)) {
          let targetId = id;
          let recordKey = sourceKey;
          if (store === "operations") {
            const scopedId: unknown = JSON.parse(id);
            if (!Array.isArray(scopedId) || scopedId.length !== 2) { continue; }
            if (scopedId[0] === oldScope || scopedId[0] === metadata.installationId) {
              targetId = JSON.stringify([accountUserId, scopedId[1]]);
            } else if (scopedId[0] === accountUserId) { recordKey = accountKey; }
            else { continue; }
          }
          const plain: unknown = JSON.parse(PureCrypto.symmetric_decrypt_string(value, recordKey));
          const rewritten = remapPhysicalIds(
            remapPhysicalIds(plain, cipherIds, attachmentIds, metadata.installationId, accountUserId),
            cipherIds, attachmentIds, oldScope, accountUserId);
          if (targetId !== id) {
            writes.push({ store, id });
          }
          writes.push({ store, id: targetId,
            value: PureCrypto.symmetric_encrypt_string(JSON.stringify(rewritten), accountKey) });
        }
      }
      await this.custody.rebind({
        accountUserId, cipherIds, attachmentIds,
        seal: async (plain) => PureCrypto.symmetric_encrypt_string(plain, accountKey),
        open: (encrypted) => this.vault.open(encrypted),
        openAccount: async (encrypted) => PureCrypto.symmetric_decrypt_string(encrypted, accountKey),
      });
      await this.custody.remapDeviceState?.(cipherIds);
      journal.phase = "local-commit";
      await this.flush(journal);
      const pending = Object.values(journal.items).some(remainsLocal);
      await this.transport.assertActive?.();
      await this.vault.prepareAttach(accountUserId, accountKey, pending);
      for (const [id, item] of Object.entries(journal.items)) {
        writes.push({ store: "ciphers", id });
        if (remainsLocal(item)) {
          writes.push({ store: "ciphers", id: cipherIds.get(id)!, value: item.finalCipher });
        }
        for (const [attachmentId, attachment] of Object.entries(item.attachments)) {
          const file = await this.vault.store.get<LocalAttachmentRecord>("attachments", attachmentId);
          if (file != null) {
            writes.push({ store: "attachments", id: attachmentId });
            if (remainsLocal(item)) {
              writes.push({ store: "attachments", id: attachment.targetAttachmentId ?? attachmentId,
                value: { ...file, cipherId: item.targetCipherId ?? id } });
            }
          }
        }
      }
      for (const [id, binding] of Object.entries(journal.formBindings)) {
        writes.push({ store: "formBindings", id, value: binding.payload });
      }
      writes.push({ store: "migrations", id: `${journal.migrationId}:account`,
        value: PureCrypto.symmetric_encrypt_string(JSON.stringify(journal), accountKey) });
      await this.vault.store.commit(writes);
      await this.transport.assertActive?.();
      await this.vault.finishAttach(accountUserId, accountKey, pending);
      return await this.complete(journal, accountKey);
    } catch (error) {
      const current = await this.vault.protectionMetadata();
      if (journal != null && metadata.attachedUserId === accountUserId &&
        current?.activeMigrationId === journal.migrationId && current.cutover == null &&
        journal.phase !== "local-commit" && this.vault.state$.value !== "persisted-locked") {
        await this.vault.store.commit([{ store: "migrations", id: `${journal.migrationId}:account`,
          value: PureCrypto.symmetric_encrypt_string(JSON.stringify(journal), accountKey) }]);
        await this.vault.setMigration(null);
      }
      throw error;
    } finally {
      sourceKey.fill(0);
    }
  }
}

function samePayload(actual: JsonObject, expected: JsonObject): boolean {
  const keys = ["type", "name", "notes", "key", "fields", "login", "card", "identity", "secureNote",
    "sshKey", "bankAccount", "driversLicense", "passport", "apiKey", "environment"];
  return keys.every((key) => canonicalJson(actual[key] ?? null) === canonicalJson(expected[key] ?? null));
}
