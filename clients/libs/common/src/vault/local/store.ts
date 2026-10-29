import { deferred } from "@vowkey/common/platform/misc/deferred";
export const LOCAL_STORES = [
  "ciphers", "attachments", "agentRecords", "formBindings", "executions", "migrations", "operations",
] as const;
export type LocalStoreName = (typeof LOCAL_STORES)[number];
export interface LocalWrite { store: LocalStoreName; id: string; value?: unknown; }

/** One commit owns all references and bytes in a save. The database never contains a user key. */
export interface LocalVaultStore {
  get<T>(store: LocalStoreName, id: string): Promise<T | undefined>;
  list<T>(store: LocalStoreName): Promise<{ id: string; value: T }[]>;
  commit(writes: LocalWrite[]): Promise<void>;
}

export class IndexedDbLocalVaultStore implements LocalVaultStore {
  constructor(private readonly databaseId = "local-vault-v1", private readonly factory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    const { promise, resolve, reject } = deferred<IDBDatabase>();
    const request = this.factory.open(this.databaseId, 1);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Local vault database is open in another version."));
    request.onupgradeneeded = () => {
      for (const name of LOCAL_STORES) {
        request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    return promise;
  }

  async get<T>(store: LocalStoreName, id: string): Promise<T | undefined> {
    const db = await this.open();
    try {
      const { promise, resolve, reject } = deferred<T | undefined>();
      const tx = db.transaction(store, "readonly");
      const request = tx.objectStore(store).get(id);
      tx.onabort = () => reject(tx.error ?? request.error);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.oncomplete = () => resolve(request.result as T | undefined);
      return await promise;
    } finally {
      db.close();
    }
  }

  async list<T>(store: LocalStoreName): Promise<{ id: string; value: T }[]> {
    const db = await this.open();
    try {
      const { promise, resolve, reject } = deferred<{ id: string; value: T }[]>();
      const tx = db.transaction(store, "readonly");
      const records: { id: string; value: T }[] = [];
      const request = tx.objectStore(store).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor != null) {
          records.push({ id: String(cursor.key), value: cursor.value as T });
          cursor.continue();
        }
      };
      tx.onabort = () => reject(tx.error ?? request.error);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.oncomplete = () => resolve(records);
      return await promise;
    } finally {
      db.close();
    }
  }

  async commit(writes: LocalWrite[]): Promise<void> {
    if (writes.length === 0) {
      return;
    }
    const db = await this.open();
    try {
      const { promise, resolve, reject } = deferred<void>();
      const tx = db.transaction([...new Set(writes.map((write) => write.store))], "readwrite");
      tx.onabort = () => reject(tx.error ?? new Error("Local vault write was aborted."));
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
      try {
        for (const write of writes) {
          const store = tx.objectStore(write.store);
          if (write.value === undefined) {
            store.delete(write.id);
          } else {
            store.put(write.value, write.id);
          }
        }
      } catch (error) {
        tx.abort();
        throw error;
      }
      await promise;
    } finally {
      db.close();
    }
  }
}
