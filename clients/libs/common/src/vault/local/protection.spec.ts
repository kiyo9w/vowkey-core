import { webcrypto } from "crypto";

import { AbstractStorageService } from "../../platform/abstractions/storage.service";

import { IndexedDbCryptoKeyProtector } from "./protection";
import { ProductInference } from "./product-inference";

class MemoryStorageService implements AbstractStorageService {
  readonly valuesUpdated$ = undefined as never;
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T> {
    return (this.map.get(key) as T) ?? null;
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async save<T>(key: string, obj: T): Promise<void> {
    this.map.set(key, obj);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

function createMockIdbFactory(): IDBFactory {
  const storeData = new Map<string, unknown>();

  const makeDb = (): IDBDatabase => {
    const objectStoreNames = {
      contains: () => true,
    } as unknown as DOMStringList;

    const db = {
      objectStoreNames,
      close: jest.fn(),
      createObjectStore: jest.fn(),
      transaction: () => {
        const tx: Record<string, any> = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          objectStore: () => ({
            get: (key: string) => {
              const req: Record<string, any> = { result: storeData.get(key), onsuccess: null, onerror: null };
              queueMicrotask(() => {
                req.onsuccess?.();
                tx.oncomplete?.();
              });
              return req;
            },
            put: (val: unknown, key: string) => {
              storeData.set(key, val);
              queueMicrotask(() => tx.oncomplete?.());
              return {};
            },
            delete: (key: string) => {
              storeData.delete(key);
              queueMicrotask(() => tx.oncomplete?.());
              return {};
            },
          }),
        };
        return tx as unknown as IDBTransaction;
      },
    };
    return db as unknown as IDBDatabase;
  };

  return {
    open: () => {
      const req: Record<string, any> = { result: makeDb(), onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => req.onsuccess?.());
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe("IndexedDbCryptoKeyProtector", () => {
  beforeAll(() => {
    if (!globalThis.crypto?.getRandomValues) {
      Object.defineProperty(globalThis, "crypto", {
        value: webcrypto,
        configurable: true,
      });
    }
  });

  it("wraps and unwraps a 64-byte local user key with a non-extractable AES-GCM CryptoKey across restarts", async () => {
    const idbFactory = createMockIdbFactory();
    const subtle = webcrypto.subtle as unknown as SubtleCrypto;
    const key = new Uint8Array(64).map((_, idx) => (idx * 7 + 3) & 0xff);

    const writer = new IndexedDbCryptoKeyProtector(undefined, idbFactory, subtle);
    await writer.write(key);
    expect(writer.durable).toBe(true);

    // Simulate a cold browser restart: fresh session storage, only IndexedDB persists!
    const freshSession = new MemoryStorageService();
    const readerAfterRestart = new IndexedDbCryptoKeyProtector(freshSession, idbFactory, subtle);
    const recovered = await readerAfterRestart.read();

    expect(recovered).toEqual(key);

    await readerAfterRestart.clear();
    expect(await readerAfterRestart.read()).toBeNull();
  });

  it("falls back cleanly to SessionKeyProtector when IndexedDB is unavailable", async () => {
    const session = new MemoryStorageService();
    const key = new Uint8Array(64).fill(0x42);

    const protector = new IndexedDbCryptoKeyProtector(session, undefined, undefined);
    expect(protector.durable).toBe(false);

    await protector.write(key);
    expect(await protector.read()).toEqual(key);

    await protector.clear();
    expect(await protector.read()).toBeNull();
  });
});

describe("ProductInference offline fast-skip and chrome.storage.local sync", () => {
  it("skips network requests immediately when navigator.onLine is false", async () => {
    const fetchMock = jest.fn();
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
    });

    try {
      const inference = new ProductInference(
        async () => ({
          installationId: "inst-1",
          identityUrl: "https://identity.example.test",
          accountToken: "tok",
        }),
        "https://decision.example.test",
        fetchMock as never,
      );
      await expect(inference.decide({ state: {}, questions: {} })).rejects.toThrow(/unavailable/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  it("hydrates and syncs privacyMode across chrome.storage.local", async () => {
    const listeners: Array<(changes: Record<string, { newValue?: unknown }>, area: string) => void> = [];
    const chromeStore: Record<string, unknown> = { "vowkey.privacyMode": "local" };
    const originalChrome = (globalThis as Record<string, unknown>).chrome;
    (globalThis as Record<string, unknown>).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.map((k) => [k, chromeStore[k]]));
          },
          set: async (items: Record<string, unknown>) => {
            Object.assign(chromeStore, items);
          },
        },
        onChanged: {
          addListener: (cb: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
            listeners.push(cb);
          },
        },
      },
    };

    try {
      const fetchMock = jest.fn();
      const inference = new ProductInference(
        async () => ({
          installationId: "inst-1",
          identityUrl: "https://identity.example.test",
          accountToken: "tok",
        }),
        "https://decision.example.test",
        fetchMock as never,
      );
      await expect(inference.decide({ state: {}, questions: {} })).rejects.toThrow(/unavailable/i);
      expect(inference.getPrivacyMode()).toBe("local");

      inference.setPrivacyMode("cloud_vision");
      expect(chromeStore["vowkey.privacyMode"]).toBe("cloud_vision");

      listeners[0]?.({ "vowkey.privacyMode": { newValue: "masked" } }, "local");
      expect(inference.getPrivacyMode()).toBe("masked");
    } finally {
      (globalThis as Record<string, unknown>).chrome = originalChrome;
    }
  });
});
