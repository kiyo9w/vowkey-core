import { BehaviorSubject } from "rxjs";
import { Cipher as SdkCipher, PureCrypto } from "@vowkey/sdk-internal";

import { AbstractStorageService } from "../../platform/abstractions/storage.service";
import { SdkLoadService } from "../../platform/abstractions/sdk/sdk-load.service";
import { Utils } from "../../platform/misc/utils";
import { AgentVaultAuthority } from "../agent/authority";
import { referenceFacts } from "../agent/executor";
import { readOwnerSecrets } from "../agent/owner-secrets";
import { AgentTargetAdapter } from "../agent/targets";
import { CipherView } from "../models/view/cipher.view";
import { CipherPermissionsApi } from "../models/api/cipher-permissions.api";
import { envelopeState, migrateLegacyProfileReference } from "../profile/vk-meta";
import { readFieldPath } from "../reference";
import { CipherType } from "../enums";

import { LOCAL_VAULT_METADATA, LocalKeyProtector, LocalVaultAccountKeyCustody, LocalVaultMetadata } from "./protection";
import { LocalVaultStore, LocalWrite } from "./store";
import { ACCOUNT_ROTATION_PREFIX, commitRotationCustody, prepareRotationCustody, readRotationCustody, rotationCustodyId, verifyRotationKeys } from "./account-key-custody";
import type { MigrationJournal } from "./migration";

export type LocalVaultState = "empty" | "session-unlocked" | "persisted-unlocked" |
  "persisted-locked" | "migrating" | "attached" | "attached-local-pending";
export interface LocalAttachmentInput { id: string; fileName: string; bytes: Uint8Array; }
export interface LocalAttachmentRecord { cipherId: string; bytes: Blob; }
const PASSWORD_KDF = { pBKDF2: { iterations: 600000 } };

/** The guest vault is the client's vault authority, not a second broker or CLI database. */
export class LocalVaultService {
  readonly state$ = new BehaviorSubject<LocalVaultState>("empty");
  private userKey: Uint8Array | null = null;
  private metadata: LocalVaultMetadata | null = null;
  private mutation: Promise<unknown> = Promise.resolve();
  private dispatchEpoch = 0;
  private readonly dispatches = new Set<Promise<unknown>>();
  private initialized = false;

  constructor(
    readonly store: LocalVaultStore,
    private readonly smallState: AbstractStorageService,
    private readonly protector: LocalKeyProtector,
    private readonly accountCustody: LocalVaultAccountKeyCustody | null = null,
  ) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.catch((): void => undefined);
    return result;
  }

  async initialize(): Promise<void> {
    await SdkLoadService.Ready;
    // Another context of the same app (the extension's popup beside its background) may create the
    // vault after this one found none, so an empty vault is looked up again until one exists.
    if (this.initialized && this.metadata != null) {
      return;
    }
    this.metadata ??= await this.smallState.get<LocalVaultMetadata>(LOCAL_VAULT_METADATA) ?? null;
    if (this.metadata == null) {
      this.initialized = true;
      if (this.state$.value !== "empty") {
        this.state$.next("empty");
      }
      return;
    }
    if (this.metadata.v !== 1 || this.metadata.databaseId !== "local-vault-v1") {
      throw new Error("Unsupported local vault protector.");
    }
    // A vault linked to an account keeps its key on this device too, so it opens here without the
    // account and the account only adds sync.
    if (this.userKey == null) {
      const key = await this.protector.read();
      if (key != null) {
        await this.restoreProtectedKey(key);
      }
    }
    this.initialized = true;
    this.publishState();
  }

  private previousCutoverKey(key: Uint8Array): Uint8Array {
    const cutover = this.metadata!.cutover!;
    try {
      PureCrypto.unwrap_symmetric_key(cutover.destinationKey, key).fill(0);
      return key;
    } catch {
      const previous = PureCrypto.unwrap_symmetric_key(cutover.previousKey, key);
      key.fill(0);
      return previous;
    }
  }
  private async restoreProtectedKey(key: Uint8Array): Promise<void> {
    const marker = await this.store.get<LocalVaultMetadata>("migrations", "account-key-rotation");
    if (marker?.cutover?.rotation != null) {
      if (marker.installationId !== this.metadata!.installationId ||
        marker.attachedUserId !== this.metadata!.attachedUserId ||
        this.metadata!.cutover?.rotation != null &&
          this.metadata!.cutover.rotation.id !== marker.cutover.rotation.id) {
        key.fill(0);
        throw new Error("The local account key rotation belongs to another vault.");
      }
      this.metadata = marker;
    }
    const rotation = this.metadata!.cutover?.rotation;
    if (rotation != null) {
      const cutover = this.metadata!.cutover!;
      let current: Uint8Array;
      let next: Uint8Array;
      let destination = false;
      try {
        next = PureCrypto.unwrap_symmetric_key(cutover.destinationKey, key);
        current = key.slice();
      } catch {
        current = PureCrypto.unwrap_symmetric_key(cutover.previousKey, key);
        next = key.slice();
        destination = true;
      } finally {
        key.fill(0);
      }
      try {
        if (marker != null) {
          await this.finalizeAccountRotation(next, destination);
        } else if (destination) {
          await this.applyAccountRotation(cutover.accountUserId, current, next);
          await this.finalizeAccountRotation(next, true);
        } else {
          await this.verifyKey(current);
          this.userKey?.fill(0);
          this.userKey = current.slice();
        }
      } finally {
        current.fill(0);
        next.fill(0);
      }
      return;
    }
    const previous = this.metadata!.cutover == null ? key : this.previousCutoverKey(key);
    try {
      const cutover = this.metadata!.cutover;
      const committed = cutover != null && this.metadata!.activeMigrationId != null &&
        await this.store.get("migrations", `${this.metadata!.activeMigrationId}:account`) != null;
      if (committed) {
        const destination = PureCrypto.unwrap_symmetric_key(cutover!.destinationKey, previous);
        try {
          await this.finishAttach(cutover!.accountUserId, destination, cutover!.pending);
        } finally {
          destination.fill(0);
          previous.fill(0);
        }
      } else {
        await this.verifyKey(previous);
        this.userKey?.fill(0);
        this.userKey = previous;
      }
    } catch (error) {
      previous.fill(0);
      throw error;
    }
  }


  private publishState(): void {
    this.state$.next(this.userKey == null ? "persisted-locked" :
      this.metadata?.activeMigrationId != null || this.metadata?.cutover?.rotation?.phase === "committed" ? "migrating" :
      this.metadata?.state ?? "persisted-unlocked");
  }

  async ensureUnlocked(): Promise<void> {
    await this.initialize();
    if (this.userKey != null) {
      return;
    }
    if (this.metadata != null) {
      throw new Error("The local vault is locked.");
    }
    await this.exclusive(async () => {
      if (this.userKey != null || this.metadata != null) {
        return;
      }
      const key = PureCrypto.make_user_key_aes256_cbc_hmac();
      const metadata: LocalVaultMetadata = {
        v: 1, installationId: crypto.randomUUID(), databaseId: "local-vault-v1", kdf: null,
        wrappedUserKey: null, publicKey: null, encryptedPrivateKey: null, activeMigrationId: null,
      };
      await this.protector.write(key);
      await this.smallState.save(LOCAL_VAULT_METADATA, metadata);
      this.metadata = metadata;
      this.userKey = key;
      this.initialized = true;
      this.state$.next("session-unlocked");
    });
    if (this.userKey == null) {
      throw new Error("The local vault is locked.");
    }
  }

  private async verifyKey(key: Uint8Array): Promise<void> {
    const records = await this.store.list<SdkCipher>("ciphers");
    for (const record of records) {
      PureCrypto.decrypt_legacy_cipher(record.value, key);
    }
    if (this.metadata?.encryptedPrivateKey != null) {
      PureCrypto.symmetric_decrypt_bytes(this.metadata.encryptedPrivateKey, key).fill(0);
    }
    if (records.length === 0 && this.metadata?.encryptedPrivateKey == null) {
      PureCrypto.unwrap_symmetric_key(PureCrypto.wrap_symmetric_key(key, key), key).fill(0);
    }
  }

  /** Key bytes stay inside the vault owner. Broker integrations use seal/open, not this method. */
  async key(): Promise<Uint8Array> {
    await this.ensureUnlocked();
    return this.userKey!.slice();
  }

  async installationId(): Promise<string> {
    await this.ensureUnlocked();
    return this.metadata!.installationId;
  }

  async seal(plain: string): Promise<string> {
    await this.ensureUnlocked();
    return PureCrypto.symmetric_encrypt_string(plain, this.userKey!);
  }

  async open(encrypted: string): Promise<string> {
    await this.ensureUnlocked();
    return PureCrypto.symmetric_decrypt_string(encrypted, this.userKey!);
  }

  async lock(): Promise<void> {
    this.dispatchEpoch++;
    await this.exclusive(async () => {
      this.userKey?.fill(0);
      this.userKey = null;
      if (!this.protector.durable || this.metadata?.wrappedUserKey != null) {
        await this.protector.clear();
      }
      this.state$.next(this.metadata == null ? "empty" : "persisted-locked");
    });
  }

  async runDispatch<T>(operation: (epoch: number) => Promise<T>): Promise<T> {
    await this.ensureUnlocked();
    const epoch = this.dispatchEpoch;
    this.assertDispatchEpoch(epoch);
    const result = Promise.resolve().then(() => operation(epoch));
    this.dispatches.add(result);
    try {
      return await result;
    } finally {
      this.dispatches.delete(result);
    }
  }

  assertDispatchEpoch(epoch: number): void {
    if (this.userKey == null || this.metadata?.activeMigrationId != null ||
      this.metadata?.cutover?.rotation?.phase === "committed" || epoch !== this.dispatchEpoch) {
      throw new Error("The vault changed. Open the form again before filling.");
    }
  }

  async quiesce(migrationId: string): Promise<void> {
    await this.ensureUnlocked();
    if (this.metadata!.activeMigrationId !== migrationId) {
      await this.setMigration(migrationId);
    }
    this.dispatchEpoch++;
    await Promise.allSettled([...this.dispatches, this.mutation]);
  }

  async unlock(password?: string): Promise<void> {
    await this.initialize();
    if (this.userKey != null || this.metadata == null) {
      return;
    }
    if (this.metadata.attachedUserId != null && (await this.protector.read()) == null) {
      throw new Error("Unlock the account to open its local items.");
    }
    const key = password != null && this.metadata.wrappedUserKey != null
      ? PureCrypto.decrypt_user_key_with_master_password(
        this.metadata.wrappedUserKey, password, this.metadata.installationId, PASSWORD_KDF,
      ) : await this.protector.read();
    if (key == null) {
      throw new Error("The local vault is locked.");
    }
    try {
      await this.restoreProtectedKey(key);
      await this.protector.write(this.userKey!);
      this.publishState();
    } catch (error) {
      key.fill(0);
      throw error;
    }
  }

  /** Whether this vault belongs to an account that has to be signed in before it opens. */
  async isAttachedToAccount(): Promise<boolean> {
    await this.initialize();
    return this.metadata?.attachedUserId != null && this.userKey == null;
  }

  /**
   * A vault linked to an account the person cannot reach, with nothing stored in it, becomes a plain
   * vault on this device again. A vault that holds items is left alone: they are saved under the
   * account and open when it does.
   */
  async startOverIfEmpty(): Promise<boolean> {
    await this.initialize();
    if (this.metadata?.attachedUserId == null || this.userKey != null) {
      return false;
    }
    if ((await this.store.list("ciphers")).length > 0) {
      return false;
    }
    await this.exclusive(async () => {
      await this.smallState.remove(LOCAL_VAULT_METADATA);
      await this.protector.clear();
      this.metadata = null;
      this.initialized = false;
      this.state$.next("empty");
    });
    return true;
  }

  async protectionMetadata(): Promise<LocalVaultMetadata | null> {
    await this.initialize();
    return this.metadata == null ? null : { ...this.metadata };
  }

  async unlockWithAccount(accountUserId: string, accountKey: Uint8Array): Promise<void> {
    await this.initialize();
    if (this.metadata?.attachedUserId !== accountUserId &&
      this.metadata?.cutover?.accountUserId !== accountUserId) {
      throw new Error("This local vault is not protected by this account.");
    }
    await this.exclusive(async () => {
      await this.restoreProtectedKey(accountKey.slice());
      await this.protector.write(this.userKey!);
      this.publishState();
    });
  }

  /** Offered after first fill; never a prerequisite for the first save or fill. */
  async setPassword(password: string): Promise<void> {
    await this.ensureUnlocked();
    if (password.length === 0) {
      throw new Error("A local password cannot be empty.");
    }
    await this.exclusive(async () => {
      const next: LocalVaultMetadata = {
        ...this.metadata!, kdf: { kdfType: 0, iterations: 600000 },
        wrappedUserKey: PureCrypto.encrypt_user_key_with_master_password(
          this.userKey!, password, this.metadata!.installationId, PASSWORD_KDF,
        ),
      };
      await this.smallState.save(LOCAL_VAULT_METADATA, next);
      this.metadata = next;
    });
  }

  async markFirstFill(): Promise<void> {
    await this.ensureUnlocked();
    await this.exclusive(async () => {
      if (this.metadata!.firstFillAt != null) {
        return;
      }
      const next = { ...this.metadata!, firstFillAt: new Date().toISOString() };
      await this.smallState.save(LOCAL_VAULT_METADATA, next);
      this.metadata = next;
      this.publishState();
    });
  }
  async afterFillOffer(): Promise<{ show: boolean; canSetPassword: boolean; hasPassword: boolean }> {
    await this.ensureUnlocked();
    return {
      show: this.metadata!.firstFillAt != null && !this.metadata!.protectionOfferDismissed &&
        this.metadata!.attachedUserId == null,
      canSetPassword: !this.protector.durable,
      hasPassword: this.metadata!.wrappedUserKey != null,
    };
  }


  async dismissProtectionOffer(): Promise<void> {
    await this.ensureUnlocked();
    const next = { ...this.metadata!, protectionOfferDismissed: true };
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.metadata = next;
  }

  async markRegistered(email: string): Promise<void> {
    await this.ensureUnlocked();
    const next = { ...this.metadata!, registeredEmail: email.trim().toLowerCase() };
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.metadata = next;
  }

  async listOperations(scopeId: string): Promise<{ id: string; value: string }[]> {
    return (await this.store.list<string>("operations")).flatMap(({ id, value }) => {
      const key: unknown = JSON.parse(id);
      return Array.isArray(key) && key.length === 2 && key[0] === scopeId && typeof key[1] === "string"
        ? [{ id: key[1], value }] : [];
    });
  }

  async list(options?: { includeDeleted?: boolean }): Promise<CipherView[]> {
    await this.ensureUnlocked();
    const decrypted = (await this.store.list<SdkCipher & { migrationPending?: boolean }>("ciphers"))
      .filter(({ value }) => !value.migrationPending)
      .map(({ value }) => this.decrypt(value));
    return options?.includeDeleted ? decrypted : decrypted.filter((cipher) => !cipher.deletedDate);
  }

  async listDeleted(): Promise<CipherView[]> {
    const all = await this.list({ includeDeleted: true });
    return all.filter((cipher) => Boolean(cipher.deletedDate));
  }

  async getCipher(id: string): Promise<CipherView | null> {
    await this.ensureUnlocked();
    const stored = await this.store.get<SdkCipher & { migrationPending?: boolean }>("ciphers", id);
    if (stored == null || stored.migrationPending) {
      return null;
    }
    return this.decrypt(stored);
  }

  async softDeleteCipher(id: string): Promise<CipherView> {
    await this.ensureUnlocked();
    return this.exclusive(async () => {
      if (this.metadata!.activeMigrationId != null || this.metadata!.cutover?.rotation?.phase === "committed") {
        throw new Error("The local vault is being attached to an account.");
      }
      const existing = await this.store.get<SdkCipher>("ciphers", id);
      if (existing == null) {
        throw new Error("The local item is unavailable.");
      }
      const working = this.decrypt(existing);
      const now = new Date(Math.max(Date.now(), Date.parse(existing.revisionDate) + 1));
      working.deletedDate = working.deletedDate ?? now;
      working.revisionDate = now;
      let encrypted = PureCrypto.encrypt_legacy_cipher(working.toSdkCipherView(), this.userKey!);
      if (existing.attachments?.length) {
        encrypted = { ...encrypted, attachments: existing.attachments };
      }
      await this.store.commit([{ store: "ciphers", id: working.id, value: encrypted }]);
      this.publishState();
      return this.decrypt(encrypted);
    });
  }

  async restoreCipher(id: string): Promise<CipherView> {
    await this.ensureUnlocked();
    return this.exclusive(async () => {
      if (this.metadata!.activeMigrationId != null || this.metadata!.cutover?.rotation?.phase === "committed") {
        throw new Error("The local vault is being attached to an account.");
      }
      const existing = await this.store.get<SdkCipher>("ciphers", id);
      if (existing == null) {
        throw new Error("The local item is unavailable.");
      }
      const working = this.decrypt(existing);
      const now = new Date(Math.max(Date.now(), Date.parse(existing.revisionDate) + 1));
      working.deletedDate = undefined;
      working.revisionDate = now;
      let encrypted = PureCrypto.encrypt_legacy_cipher(working.toSdkCipherView(), this.userKey!);
      if (existing.attachments?.length) {
        encrypted = { ...encrypted, attachments: existing.attachments };
      }
      await this.store.commit([{ store: "ciphers", id: working.id, value: encrypted }]);
      this.publishState();
      return this.decrypt(encrypted);
    });
  }

  async deleteCipher(id: string): Promise<void> {
    await this.ensureUnlocked();
    await this.exclusive(async () => {
      if (this.metadata!.activeMigrationId != null || this.metadata!.cutover?.rotation?.phase === "committed") {
        throw new Error("The local vault is being attached to an account.");
      }
      const writes: LocalWrite[] = [{ store: "ciphers", id }];
      for (const attachment of await this.store.list<LocalAttachmentRecord>("attachments")) {
        if (attachment.value.cipherId === id) {
          writes.push({ store: "attachments", id: attachment.id });
        }
      }
      for (const binding of await this.store.list<string>("formBindings")) {
        try {
          const value: unknown = JSON.parse(await this.open(binding.value));
          if (
            value != null &&
            typeof value === "object" &&
            "profileCipherId" in value &&
            value.profileCipherId === id
          ) {
            writes.push({ store: "formBindings", id: binding.id });
          }
        } catch {
          // Ignore unreadable form bindings
        }
      }
      await this.store.commit(writes);
      this.publishState();
    });
  }

  async pendingCipher(userId: string, id: string): Promise<SdkCipher | undefined> {
    await this.initialize();
    if (this.metadata?.attachedUserId !== userId || this.userKey == null) {
      return undefined;
    }
    return this.store.get<SdkCipher>("ciphers", id);
  }

  async pendingView(userId: string, id: string): Promise<CipherView | null> {
    const cipher = await this.pendingCipher(userId, id);
    return cipher == null ? null : this.decrypt(cipher);
  }

  async pendingItems(userId: string): Promise<CipherView[]> {
    await this.initialize();
    if (this.metadata?.attachedUserId !== userId || this.userKey == null) {
      return [];
    }
    return (await this.store.list<SdkCipher>("ciphers")).map(({ value }) => this.decrypt(value));
  }

  async removePending(userId: string, id: string): Promise<void> {
    await this.ensureUnlocked();
    await this.exclusive(async () => {
      if (this.metadata?.attachedUserId !== userId || this.metadata.activeMigrationId != null) {
        throw new Error("The vault changed. Retry deleting this item from its account.");
      }
      const writes: LocalWrite[] = [{ store: "ciphers", id }];
      for (const attachment of await this.store.list<LocalAttachmentRecord>("attachments")) {
        if (attachment.value.cipherId === id) { writes.push({ store: "attachments", id: attachment.id }); }
      }
      for (const binding of await this.store.list<string>("formBindings")) {
        const value: unknown = JSON.parse(await this.open(binding.value));
        if (value != null && typeof value === "object" && "profileCipherId" in value && value.profileCipherId === id) {
          writes.push({ store: "formBindings", id: binding.id });
        }
      }
      const migrationId = this.metadata.pendingMigrationId;
      let unresolved = false;
      if (migrationId != null) {
        const encrypted = await this.store.get<string>("migrations", `${migrationId}:account`);
        if (encrypted != null) {
          const journal = JSON.parse(await this.open(encrypted)) as MigrationJournal;
          const item = journal.items[id];
          if (item != null && (item.status === "posting" || item.targetCipherId != null)) {
            item.discard = true;
          } else { delete journal.items[id]; }
          unresolved = Object.values(journal.items).some((entry) => entry.discard);
          writes.push({ store: "migrations", id: `${migrationId}:account`, value: await this.seal(JSON.stringify(journal)) });
        }
      }
      await this.store.commit(writes);
      if ((await this.store.list("ciphers")).length === 0 && !unresolved) {
        const next: LocalVaultMetadata = { ...this.metadata, state: "attached", pendingMigrationId: undefined };
        await this.smallState.save(LOCAL_VAULT_METADATA, next);
        this.metadata = next;
        if (migrationId != null) {
          await this.store.commit([{ store: "migrations", id: `${migrationId}:account` }]);
        }
      }
      this.publishState();
    });
  }

  private decrypt(cipher: SdkCipher): CipherView {
    const view = CipherView.fromSdkCipherView(PureCrypto.decrypt_legacy_cipher(cipher, this.userKey!))!;
    view.edit = true;
    view.viewPassword = true;
    view.permissions ??= new CipherPermissionsApi();
    view.permissions.delete = view.permissions.restore = true;
    return view;
  }

  async save(
    view: CipherView, attachments: LocalAttachmentInput[] = [], removedAttachmentIds: string[] = [],
  ): Promise<CipherView> {
    await this.ensureUnlocked();
    return this.exclusive(async () => {
      if (this.metadata!.activeMigrationId != null || this.metadata!.cutover?.rotation?.phase === "committed") {
        throw new Error("The local vault is being attached to an account.");
      }
      const working = CipherView.fromSdkCipherView(view.toSdkCipherView())!;
      working.edit = true;
      working.viewPassword = true;
      working.id ||= crypto.randomUUID();
      if (working.organizationId != null || working.collectionIds.length > 0) {
        throw new Error("A local vault item cannot belong to an organization or collection.");
      }
      const previous = await this.store.get<SdkCipher>("ciphers", working.id);
      if (previous != null) {
        const old = CipherView.fromSdkCipherView(PureCrypto.decrypt_legacy_cipher(previous, this.userKey!))!;
        if (view.revisionDate.getTime() !== old.revisionDate.getTime()) {
          throw new Error("The local item changed. Reload it before saving.");
        }
        working.key = old.key;
      }
      for (const id of removedAttachmentIds) {
        const stored = await this.store.get<LocalAttachmentRecord>("attachments", id);
        if (stored == null || stored.cipherId !== working.id) {
          throw new Error("The local attachment does not belong to this item.");
        }
      }
      working.attachments = working.attachments.filter((item) => !removedAttachmentIds.includes(item.id));
      working.revisionDate = new Date(Math.max(Date.now(), previous == null ? 0 : Date.parse(previous.revisionDate) + 1));
      let encrypted = PureCrypto.encrypt_legacy_cipher(working.toSdkCipherView(), this.userKey!);
      const writes: LocalWrite[] = removedAttachmentIds.map((id) => ({ store: "attachments", id }));
      for (const input of attachments) {
        if (!input.id || encrypted.attachments?.some((a) => a.id === input.id)) {
          throw new Error("An attachment id must be new and nonempty.");
        }
        const result = PureCrypto.encrypt_legacy_attachment(encrypted, {
          id: input.id, fileName: input.fileName,
        }, input.bytes, this.userKey!);
        encrypted = { ...encrypted, attachments: [...encrypted.attachments ?? [], result.attachment] };
        writes.push({ store: "attachments", id: input.id, value: {
          cipherId: working.id, bytes: new Blob([Uint8Array.from(result.contents).buffer]),
        } satisfies LocalAttachmentRecord });
      }
      if (this.metadata!.encryptedPrivateKey == null) {
        const privateKey = PureCrypto.rsa_generate_keypair();
        const next = {
          ...this.metadata!, publicKey: Utils.fromBufferToB64(PureCrypto.rsa_extract_public_key(privateKey)),
          encryptedPrivateKey: PureCrypto.symmetric_encrypt_bytes(privateKey, this.userKey!),
        };
        privateKey.fill(0);
        await this.smallState.save(LOCAL_VAULT_METADATA, next);
        this.metadata = next;
      }
      writes.push({ store: "ciphers", id: working.id, value: encrypted });
      await this.store.commit(writes);
      this.publishState();
      return this.decrypt(encrypted);
    });
  }

  async saveCipher(view: CipherView): Promise<CipherView> {
    await this.ensureUnlocked();
    return this.exclusive(async () => {
      if (this.metadata!.activeMigrationId != null || this.metadata!.cutover?.rotation?.phase === "committed") {
        throw new Error("The local vault is being attached to an account.");
      }
      const working = CipherView.fromSdkCipherView(view.toSdkCipherView())!;
      working.edit = true;
      working.viewPassword = true;
      working.id ||= crypto.randomUUID();
      if (working.organizationId != null || working.collectionIds.length > 0) {
        throw new Error("A local vault item cannot belong to an organization or collection.");
      }
      const previous = await this.store.get<SdkCipher>("ciphers", working.id);
      if (previous != null) {
        const old = CipherView.fromSdkCipherView(PureCrypto.decrypt_legacy_cipher(previous, this.userKey!))!;
        working.key = old.key;
      }
      const incomingTime = view.revisionDate?.getTime?.();
      working.revisionDate =
        incomingTime != null && Number.isFinite(incomingTime) && incomingTime > 0
          ? new Date(incomingTime)
          : new Date(Math.max(Date.now(), previous == null ? 0 : Date.parse(previous.revisionDate) + 1));
      working.deletedDate = view.deletedDate ?? undefined;
      let encrypted = PureCrypto.encrypt_legacy_cipher(working.toSdkCipherView(), this.userKey!);
      if (previous?.attachments?.length && !encrypted.attachments?.length) {
        encrypted = { ...encrypted, attachments: previous.attachments };
      }
      if (this.metadata!.encryptedPrivateKey == null) {
        const privateKey = PureCrypto.rsa_generate_keypair();
        const next = {
          ...this.metadata!,
          publicKey: Utils.fromBufferToB64(PureCrypto.rsa_extract_public_key(privateKey)),
          encryptedPrivateKey: PureCrypto.symmetric_encrypt_bytes(privateKey, this.userKey!),
        };
        privateKey.fill(0);
        await this.smallState.save(LOCAL_VAULT_METADATA, next);
        this.metadata = next;
      }
      await this.store.commit([{ store: "ciphers", id: working.id, value: encrypted }]);
      this.publishState();
      return this.decrypt(encrypted);
    });
  }

  async attachment(id: string): Promise<Uint8Array> {
    await this.ensureUnlocked();
    const record = await this.store.get<LocalAttachmentRecord>("attachments", id);
    const cipher = record == null ? undefined : await this.store.get<SdkCipher>("ciphers", record.cipherId);
    const attachment = cipher?.attachments?.find((value) => value.id === id);
    if (record == null || cipher == null || attachment == null) {
      throw new Error("The local attachment is unavailable.");
    }
    return PureCrypto.decrypt_legacy_attachment(cipher, attachment,
      new Uint8Array(await record.bytes.arrayBuffer()), this.userKey!);
  }

  operation(scopeId: string, id: string): Promise<string | undefined> {
    return this.store.get("operations", JSON.stringify([scopeId, id]));
  }
  saveOperation(scopeId: string, id: string, encrypted: string): Promise<void> {
    return this.store.commit([{ store: "operations", id: JSON.stringify([scopeId, id]), value: encrypted }]);
  }
  deleteOperation(scopeId: string, id: string): Promise<void> {
    return this.store.commit([{ store: "operations", id: JSON.stringify([scopeId, id]) }]);
  }

  async authority(targets: AgentTargetAdapter): Promise<AgentVaultAuthority> {
    const metadata = await this.migrationMetadata();
    const scopeIds = [metadata.attachedUserId ?? `local:${metadata.installationId}`];
    const find = async (id: string) => (await this.list()).find((cipher) => cipher.id === id);
    const epoch = this.dispatchEpoch;
    return {
      scopeIds, targets, seal: (plain) => this.seal(plain), open: (encrypted) => this.open(encrypted),
      secrets: async (query) => {
        this.assertDispatchEpoch(epoch);
        const result = await readOwnerSecrets(query, scopeIds[0], async (id) => await find(id) ?? null,
          () => this.list());
        this.assertDispatchEpoch(epoch);
        const current = this.metadata!.attachedUserId ?? `local:${this.metadata!.installationId}`;
        if (current !== scopeIds[0]) {
          throw new Error("account_changed");
        }
        return result;
      },
      resolve: async (id, path) => {
        const cipher = await find(id);
        if (cipher == null || cipher.migrationPending) {
          return null;
        }
        if (cipher.type === CipherType.Identity && envelopeState(cipher) === "none") {
          const stablePath = migrateLegacyProfileReference(cipher, path);
          return stablePath == null ? null : referenceFacts(await this.save(cipher), stablePath);
        }
        return referenceFacts(cipher, path);
      },
      value: async (id, path) => {
        const cipher = await find(id);
        if (cipher?.migrationPending) {
          throw new Error("The saved detail is still being attached.");
        }
        const facts = cipher == null ? null : referenceFacts(cipher, path);
        if (facts == null || !facts.accessible || facts.draft || facts.agentRule === "never") {
          throw new Error("The saved detail is unavailable.");
        }
        const value = readFieldPath(cipher!, facts.resolvePath ?? facts.fieldPath);
        if (value == null) {
          throw new Error("The saved detail is unavailable.");
        }
        return value;
      },
    };
  }

  async migrationMetadata(): Promise<LocalVaultMetadata> {
    await this.ensureUnlocked();
    return { ...this.metadata! };
  }

  async setMigration(id: string | null): Promise<void> {
    await this.ensureUnlocked();
    const next = { ...this.metadata!, activeMigrationId: id };
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.metadata = next;
    this.publishState();
  }

  async prepareAttach(accountUserId: string, accountKey: Uint8Array, pending: boolean): Promise<void> {
    await this.ensureUnlocked();
    if (this.metadata!.cutover != null) {
      return;
    }
    const next: LocalVaultMetadata = {
      ...this.metadata!, cutover: {
        accountUserId, pending,
        destinationKey: PureCrypto.wrap_symmetric_key(accountKey, this.userKey!),
        previousKey: PureCrypto.wrap_symmetric_key(this.userKey!, accountKey),
        encryptedPrivateKey: this.metadata!.encryptedPrivateKey == null ? null :
          PureCrypto.symmetric_encrypt_bytes(
            PureCrypto.symmetric_decrypt_bytes(this.metadata!.encryptedPrivateKey, this.userKey!), accountKey,
          ),
      },
    };
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.metadata = next;
  }

  /** Persist both wrapped keys before the account rotation POST; no payload changes yet. */
  async rotateAccountKey(accountUserId: string, currentKey: Uint8Array, nextKey: Uint8Array): Promise<void> {
    const attached = (await this.protectionMetadata())?.attachedUserId === accountUserId;
    if (!attached && this.accountCustody == null) {
      return;
    }
    if (attached) { await this.ensureUnlocked(); }
    await this.exclusive(async () => {
      if (attached && (this.metadata!.cutover != null || this.metadata!.activeMigrationId != null ||
        this.metadata!.finalizingMigrationId != null)) {
        throw new Error("Finish the current local vault handoff before rotating this account key.");
      }
      if (!attached && await readRotationCustody(this.store, accountUserId) != null) {
        throw new Error("Finish the current account key rotation before starting another.");
      }
      if (attached) {
        await this.verifyKey(currentKey);
        await this.accountRotationWrites(accountUserId, currentKey, nextKey);
      }
      const rotationId = crypto.randomUUID();
      const custody = await prepareRotationCustody(this.store, this.accountCustody, accountUserId, currentKey, nextKey, rotationId);
      if (!attached) { return; }
      const privateKey = this.metadata!.encryptedPrivateKey == null ? null :
        PureCrypto.symmetric_decrypt_bytes(this.metadata!.encryptedPrivateKey, currentKey);
      try {
        const next: LocalVaultMetadata = {
          ...this.metadata!, cutover: {
            accountUserId, pending: this.metadata!.state === "attached-local-pending",
            destinationKey: PureCrypto.wrap_symmetric_key(nextKey, currentKey),
            previousKey: PureCrypto.wrap_symmetric_key(currentKey, nextKey),
            encryptedPrivateKey: privateKey == null ? null : PureCrypto.symmetric_encrypt_bytes(privateKey, nextKey),
            rotation: { id: rotationId, phase: "staged", custody },
          },
        };
        await this.smallState.save(LOCAL_VAULT_METADATA, next);
        this.metadata = next;
        this.dispatchEpoch++;
        this.publishState();
      } finally {
        privateKey?.fill(0);
      }
    });
  }

  /** Only a server response known not to commit may discard the staged bridge. */
  async cancelAccountKeyRotation(accountUserId: string): Promise<void> {
    await this.initialize();
    await this.exclusive(async () => {
      const journal = await readRotationCustody(this.store, accountUserId);
      const cutover = this.metadata?.cutover;
      if (journal?.phase === "committed") {
        throw new Error("The local vault already committed this account key rotation.");
      }
      if (cutover?.rotation == null || cutover.accountUserId !== accountUserId) {
        if (journal != null) {
          await this.store.commit([{ store: "migrations", id: rotationCustodyId(accountUserId) }]);
          this.accountCustody?.resume();
        }
        return;
      }
      if (cutover.rotation.phase !== "staged" ||
        await this.store.get("migrations", "account-key-rotation") != null) {
        throw new Error("The local vault already committed this account key rotation.");
      }
      const next: LocalVaultMetadata = { ...this.metadata! };
      delete next.cutover;
      await this.smallState.save(LOCAL_VAULT_METADATA, next);
      this.metadata = next;
      await this.store.commit([{ store: "migrations", id: rotationCustodyId(accountUserId) }]);
      this.publishState();
      this.accountCustody?.resume();
    });
  }

  async completeAccountKeyRotation(accountUserId: string, currentKey: Uint8Array, nextKey: Uint8Array): Promise<void> {
    if ((await this.protectionMetadata())?.attachedUserId !== accountUserId) {
      await this.exclusive(async () => {
        const journal = await readRotationCustody(this.store, accountUserId);
        if (journal == null) { return; }
        verifyRotationKeys(journal, currentKey, nextKey);
        await commitRotationCustody(this.store, this.accountCustody, journal, currentKey, nextKey);
        await this.store.commit([{ store: "migrations", id: rotationCustodyId(accountUserId) }]);
        this.accountCustody?.resume();
      });
      return;
    }
    await this.ensureUnlocked();
    await this.exclusive(async () => {
      const cutover = this.metadata!.cutover;
      if (cutover?.rotation == null || cutover.accountUserId !== accountUserId) {
        throw new Error("The local vault has not staged this account key rotation.");
      }
      const stagedNext = PureCrypto.unwrap_symmetric_key(cutover.destinationKey, currentKey);
      const stagedCurrent = PureCrypto.unwrap_symmetric_key(cutover.previousKey, nextKey);
      try {
        if (stagedNext.length !== nextKey.length || stagedCurrent.length !== currentKey.length ||
          stagedNext.some((byte, index) => byte !== nextKey[index]) ||
          stagedCurrent.some((byte, index) => byte !== currentKey[index])) {
          throw new Error("The staged account key rotation does not match these keys.");
        }
        if (await this.store.get("migrations", "account-key-rotation") == null) {
          await this.applyAccountRotation(accountUserId, currentKey, nextKey);
        }
        await this.finalizeAccountRotation(nextKey, true);
      } finally {
        stagedNext.fill(0);
        stagedCurrent.fill(0);
      }
    });
  }

  async recoverAccountKeyRotation(accountUserId: string, accountKey: Uint8Array): Promise<void> {
    await this.initialize();
    if (this.metadata?.attachedUserId === accountUserId) { return; }
    await this.exclusive(async () => {
      const journal = await readRotationCustody(this.store, accountUserId);
      if (journal == null) { return; }
      let sourceKey = false;
      try {
        PureCrypto.unwrap_symmetric_key(journal.destinationKey, accountKey).fill(0);
        sourceKey = true;
      } catch { sourceKey = false; }
      if (sourceKey) {
        if (journal.phase === "committed") {
          throw new Error("Unlock the account with its replacement key to finish the rotation.");
        }
        return;
      }
      const previous = PureCrypto.unwrap_symmetric_key(journal.previousKey, accountKey);
      try {
        await commitRotationCustody(this.store, this.accountCustody, journal, previous, accountKey);
        await this.store.commit([{ store: "migrations", id: rotationCustodyId(accountUserId) }]);
        this.accountCustody?.resume();
      } finally { previous.fill(0); }
    });
  }

  async resumeAccountKeyRotation(accountUserId: string): Promise<void> {
    await this.initialize();
    const journal = await readRotationCustody(this.store, accountUserId);
    if (journal?.phase === "staged" || this.metadata?.cutover?.accountUserId === accountUserId &&
      this.metadata.cutover.rotation?.phase === "staged") {
      this.accountCustody?.resume();
    }
  }

  private async accountRotationWrites(
    accountUserId: string, currentKey: Uint8Array, nextKey: Uint8Array,
  ): Promise<LocalWrite[]> {
    const writes: LocalWrite[] = (await this.store.list<SdkCipher>("ciphers")).map(({ id, value }) => ({
      store: "ciphers", id, value: PureCrypto.rewrap_legacy_cipher_key(value, currentKey, nextKey),
    }));
    for (const store of ["agentRecords", "formBindings", "executions"] as const) {
      for (const { id, value } of await this.store.list<string>(store)) {
        writes.push({ store, id, value: PureCrypto.symmetric_encrypt_string(
          PureCrypto.symmetric_decrypt_string(value, currentKey), nextKey,
        ) });
      }
    }
    for (const { id, value } of await this.store.list<unknown>("migrations")) {
      if (id === "account-key-rotation" || id.startsWith(ACCOUNT_ROTATION_PREFIX)) {
        continue;
      }
      if (typeof value === "string") {
        const journal = JSON.parse(PureCrypto.symmetric_decrypt_string(value, currentKey)) as MigrationJournal;
        if (journal.v !== 1 || journal.targetUserId !== accountUserId || journal.phase !== "verified" ||
          Object.values(journal.items).some((item) => item.discard ||
            !["waiting-for-type", "local-trash", "confirmed"].includes(item.status))) {
          throw new Error("Finish attaching local items before rotating this account key.");
        }
        for (const item of Object.values(journal.items)) {
          item.cipher = PureCrypto.rewrap_legacy_cipher_key(item.cipher, currentKey, nextKey);
          if (item.finalCipher != null) {
            item.finalCipher = PureCrypto.rewrap_legacy_cipher_key(item.finalCipher, currentKey, nextKey);
          }
        }
        // Frozen HTTP bodies and hashes remain byte-identical; local cipher views use the new key.
        writes.push({ store: "migrations", id, value: PureCrypto.symmetric_encrypt_string(JSON.stringify(journal), nextKey) });
      } else if (id.endsWith(":web-custody") || id.endsWith(":desktop-custody")) {
        const intent = value as { v: number; source: string | null; destination?: string };
        if (intent?.v !== 1 || intent.source != null && typeof intent.source !== "string" ||
          intent.destination != null && typeof intent.destination !== "string") {
          throw new Error("The local custody handoff is unreadable.");
        }
        writes.push({ store: "migrations", id, value: {
          ...intent,
          source: intent.source == null ? null : PureCrypto.symmetric_encrypt_string(
            PureCrypto.symmetric_decrypt_string(intent.source, currentKey), nextKey,
          ),
          ...(intent.destination == null ? {} : { destination: PureCrypto.symmetric_encrypt_string(
            PureCrypto.symmetric_decrypt_string(intent.destination, currentKey), nextKey,
          ) }),
        } });
      } else {
        throw new Error("Finish the local custody handoff before rotating this account key.");
      }
    }
    for (const { id, value } of await this.store.list<string>("operations")) {
      const scoped: unknown = JSON.parse(id);
      if (Array.isArray(scoped) && scoped[0] === accountUserId) {
        writes.push({ store: "operations", id, value: PureCrypto.symmetric_encrypt_string(
          PureCrypto.symmetric_decrypt_string(value, currentKey), nextKey,
        ) });
      }
    }
    return writes;
  }

  private async applyAccountRotation(accountUserId: string, currentKey: Uint8Array, nextKey: Uint8Array): Promise<void> {
    const writes = await this.accountRotationWrites(accountUserId, currentKey, nextKey);
    const committed: LocalVaultMetadata = {
      ...this.metadata!, encryptedPrivateKey: this.metadata!.cutover!.encryptedPrivateKey,
      cutover: { ...this.metadata!.cutover!, rotation: { ...this.metadata!.cutover!.rotation!, phase: "committed" } },
    };
    await this.store.commit([
      ...writes, { store: "migrations", id: "account-key-rotation", value: committed },
    ]);
  }

  private async finalizeAccountRotation(nextKey: Uint8Array, destinationConfirmed: boolean): Promise<void> {
    const marker = await this.store.get<LocalVaultMetadata>("migrations", "account-key-rotation");
    if (marker?.cutover?.rotation?.phase !== "committed" ||
      marker.attachedUserId !== this.metadata!.attachedUserId ||
      marker.cutover.rotation.id !== this.metadata!.cutover?.rotation?.id) {
      throw new Error("The local account key rotation has not committed.");
    }
    this.metadata = marker;
    this.publishState();
    await this.verifyKey(nextKey);
    if (marker.cutover.rotation.custody) {
      const journal = await readRotationCustody(this.store, marker.cutover.accountUserId);
      if (journal == null || journal.rotationId !== marker.cutover.rotation.id) {
        throw new Error("The local agent key handoff is unavailable.");
      }
      const previous = PureCrypto.unwrap_symmetric_key(marker.cutover.previousKey, nextKey);
      try { await commitRotationCustody(this.store, this.accountCustody, journal, previous, nextKey); }
      finally { previous.fill(0); }
    }
    const next: LocalVaultMetadata = { ...marker };
    if (destinationConfirmed) {
      delete next.cutover;
    }
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.userKey?.fill(0);
    this.userKey = nextKey.slice();
    this.metadata = next;
    if (destinationConfirmed) {
      await this.store.commit([
        { store: "migrations", id: "account-key-rotation" },
        { store: "migrations", id: rotationCustodyId(marker.cutover.accountUserId) },
      ]);
    }
    this.publishState();
    if (destinationConfirmed) { this.accountCustody?.resume(); }
  }



  async finishAttach(accountUserId: string, accountKey: Uint8Array, pending: boolean): Promise<void> {
    for (const { value } of await this.store.list<SdkCipher>("ciphers")) {
      PureCrypto.decrypt_legacy_cipher(value, accountKey);
    }
    const next: LocalVaultMetadata = {
      ...this.metadata!, attachedUserId: accountUserId, activeMigrationId: null,
      finalizingMigrationId: this.metadata!.activeMigrationId ?? this.metadata!.finalizingMigrationId,
      pendingMigrationId: pending
        ? this.metadata!.activeMigrationId ?? this.metadata!.pendingMigrationId : undefined,
      state: pending ? "attached-local-pending" : "attached", wrappedUserKey: null, kdf: null,
      encryptedPrivateKey: this.metadata!.cutover?.encryptedPrivateKey ?? this.metadata!.encryptedPrivateKey,
    };
    delete next.cutover;
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.userKey?.fill(0);
    this.userKey = accountKey.slice();
    this.metadata = next;
    await this.protector.write(this.userKey);
    this.publishState();
  }

  async completeMigration(migrationId: string, pending: boolean): Promise<void> {
    await this.ensureUnlocked();
    const next: LocalVaultMetadata = {
      ...this.metadata!, finalizingMigrationId: undefined,
      pendingMigrationId: pending ? migrationId : undefined,
    };
    await this.smallState.save(LOCAL_VAULT_METADATA, next);
    this.metadata = next;
    this.publishState();
  }
}
