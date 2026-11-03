import { AbstractStorageService } from "../../platform/abstractions/storage.service";

export interface LocalVaultMetadata {
  v: 1;
  installationId: string;
  databaseId: string;
  kdf: { kdfType: 0; iterations: 600000 } | null;
  wrappedUserKey: string | null;
  publicKey: string | null;
  encryptedPrivateKey: string | null;
  activeMigrationId: string | null;
  attachedUserId?: string;
  pendingMigrationId?: string;
  finalizingMigrationId?: string;
  state?: "attached" | "attached-local-pending";
  registeredEmail?: string;
  firstFillAt?: string;
  protectionOfferDismissed?: boolean;
  cutover?: {
    accountUserId: string;
    pending: boolean;
    destinationKey: string;
    previousKey: string;
    encryptedPrivateKey: string | null;
    /** The bulk marker with this id commits atomically with the destination-key rows. */
    rotation?: { id: string; phase: "staged" | "committed"; custody?: boolean };
  };
}

export interface LocalVaultAccountKeyCustody {
  quiesce(rotationId: string, accountUserId: string): Promise<string | null>;
  stage(rotationId: string, accountUserId: string, encrypted: string | null, expected: string | null): Promise<void>;
  finalize(rotationId: string, accountUserId: string): Promise<void>;
  resume(): void;
}

export interface LocalKeyProtector {
  readonly durable: boolean;
  read(): Promise<Uint8Array | null>;
  write(key: Uint8Array): Promise<void>;
  clear(): Promise<void>;
}

/** Web: one page variable. Never sessionStorage, localStorage, or IndexedDB. */
export class PageKeyProtector implements LocalKeyProtector {
  readonly durable = false;
  private key: Uint8Array | null = null;
  async read(): Promise<Uint8Array | null> { return this.key?.slice() ?? null; }
  async write(key: Uint8Array): Promise<void> { this.key?.fill(0); this.key = key.slice(); }
  async clear(): Promise<void> { this.key?.fill(0); this.key = null; }
}

/** Extension: the existing MV3 storage.session / MV2 background-memory service only. */
export class SessionKeyProtector implements LocalKeyProtector {
  readonly durable = false;
  constructor(private readonly session: AbstractStorageService) {}
  async read(): Promise<Uint8Array | null> {
    const value = await this.session.get<number[]>("localVault_sessionUserKey");
    if (value == null) {
      return null;
    }
    if (!Array.isArray(value) || value.length !== 64 || value.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      throw new Error("Invalid local vault session key.");
    }
    return Uint8Array.from(value);
  }
  async write(key: Uint8Array): Promise<void> {
    await this.session.save("localVault_sessionUserKey", Array.from(key));
  }
  async clear(): Promise<void> { await this.session.remove("localVault_sessionUserKey"); }
}

/** Native callbacks read/write localUserKey in the OS credential store, outside the bulk database. */
export class NativeKeyProtector implements LocalKeyProtector {
  readonly durable = true;
  constructor(
    private readonly load: () => Promise<Uint8Array | null>,
    private readonly persist: (key: Uint8Array) => Promise<void>,
    private readonly remove: () => Promise<void>,
  ) {}
  read(): Promise<Uint8Array | null> { return this.load(); }
  write(key: Uint8Array): Promise<void> { return this.persist(key); }
  clear(): Promise<void> { return this.remove(); }
}

interface WrappedLocalUserKeyRecord {
  v: 1;
  wrappingKey: CryptoKey;
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

const IDB_PROTECTOR_DB = "vowkey_local_key_protector_v1";
const IDB_PROTECTOR_STORE = "protector";
const IDB_PROTECTOR_RECORD_ID = "localVault_wrappedUserKey";

/**
 * Browser extension protector: wraps the 64-byte local user key with a non-extractable 256-bit
 * AES-GCM WebCrypto `CryptoKey` persisted in IndexedDB so quitting and reopening the browser
 * never locks out an accountless user. Falls back to `SessionKeyProtector` when IndexedDB or
 * structured-cloning `CryptoKey` objects is unavailable (such as Node/Jest test environments).
 */
export class IndexedDbCryptoKeyProtector implements LocalKeyProtector {
  private readonly fallback: SessionKeyProtector | null;
  private idbSupported: boolean | null = null;

  constructor(
    session?: AbstractStorageService,
    private readonly idbFactory: IDBFactory | undefined =
      typeof indexedDB !== "undefined" ? indexedDB : undefined,
    private readonly subtle: SubtleCrypto | undefined =
      typeof crypto !== "undefined" ? crypto.subtle : undefined,
  ) {
    this.fallback = session ? new SessionKeyProtector(session) : null;
  }

  get durable(): boolean {
    if (this.idbSupported !== null) {
      return this.idbSupported;
    }
    return Boolean(this.idbFactory && this.subtle);
  }

  private openDb(): Promise<IDBDatabase> {
    if (!this.idbFactory) {
      return Promise.reject(new Error("IndexedDB is unavailable."));
    }
    return new Promise((resolve, reject) => {
      const request = this.idbFactory!.open(IDB_PROTECTOR_DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IDB_PROTECTOR_STORE)) {
          db.createObjectStore(IDB_PROTECTOR_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    });
  }

  async read(): Promise<Uint8Array | null> {
    if (this.idbFactory && this.subtle && this.idbSupported !== false) {
      try {
        const db = await this.openDb();
        const record = await new Promise<WrappedLocalUserKeyRecord | undefined>((resolve, reject) => {
          const tx = db.transaction(IDB_PROTECTOR_STORE, "readonly");
          const req = tx.objectStore(IDB_PROTECTOR_STORE).get(IDB_PROTECTOR_RECORD_ID);
          req.onsuccess = () => resolve(req.result as WrappedLocalUserKeyRecord | undefined);
          req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed."));
          tx.oncomplete = () => db.close();
          tx.onerror = () => db.close();
          tx.onabort = () => db.close();
        });
        if (record?.v === 1 && record.wrappingKey && record.iv && record.ciphertext) {
          const decrypted = await this.subtle.decrypt(
            { name: "AES-GCM", iv: Uint8Array.from(record.iv) },
            record.wrappingKey,
            Uint8Array.from(record.ciphertext),
          );
          const bytes = new Uint8Array(decrypted);
          if (bytes.length !== 64) {
            bytes.fill(0);
            throw new Error("Invalid local vault wrapped key length.");
          }
          this.idbSupported = true;
          return bytes;
        }
      } catch {
        // Fall through to SessionKeyProtector if IndexedDB CryptoKey retrieval is unsupported
      }
    }
    return (await this.fallback?.read()) ?? null;
  }

  async write(key: Uint8Array): Promise<void> {
    if (this.idbFactory && this.subtle && this.idbSupported !== false) {
      try {
        const wrappingKey = await this.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        );
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv);
        const encrypted = await this.subtle.encrypt(
          { name: "AES-GCM", iv },
          wrappingKey,
          Uint8Array.from(key),
        );
        const record: WrappedLocalUserKeyRecord = {
          v: 1,
          wrappingKey,
          iv,
          ciphertext: new Uint8Array(encrypted),
        };
        const db = await this.openDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(IDB_PROTECTOR_STORE, "readwrite");
          tx.objectStore(IDB_PROTECTOR_STORE).put(record, IDB_PROTECTOR_RECORD_ID);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            const err = tx.error ?? new Error("IndexedDB write failed.");
            db.close();
            reject(err);
          };
          tx.onabort = () => {
            const err = tx.error ?? new Error("IndexedDB write aborted.");
            db.close();
            reject(err);
          };
        });
        this.idbSupported = true;
        await this.fallback?.write(key);
        return;
      } catch {
        this.idbSupported = false;
      }
    }
    if (this.fallback) {
      await this.fallback.write(key);
      return;
    }
    throw new Error("No local vault key protector storage is available.");
  }

  async clear(): Promise<void> {
    if (this.idbFactory) {
      try {
        const db = await this.openDb();
        await new Promise<void>((resolve) => {
          const tx = db.transaction(IDB_PROTECTOR_STORE, "readwrite");
          tx.objectStore(IDB_PROTECTOR_STORE).delete(IDB_PROTECTOR_RECORD_ID);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            resolve();
          };
        });
      } catch {
        // Ignore IndexedDB errors during clear
      }
    }
    await this.fallback?.clear();
  }
}

export const LOCAL_VAULT_METADATA = "localVault_protector";
