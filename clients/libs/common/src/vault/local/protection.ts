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

export const LOCAL_VAULT_METADATA = "localVault_protector";
