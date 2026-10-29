import { ipcRenderer } from "electron";

import type { LocalStoreName, LocalWrite } from "@vowkey/common/vault/local/store";

async function fromWire<T>(store: LocalStoreName, value: unknown): Promise<T> {
  if (store !== "attachments" || value == null) {
    return value as T;
  }
  const attachment = value as { cipherId: string; bytes: Uint8Array };
  return { cipherId: attachment.cipherId, bytes: new Blob([Uint8Array.from(attachment.bytes).buffer]) } as T;
}

export default {
  custody: {
    quiesce: (migrationId: string, scope: string): Promise<string | null> =>
      ipcRenderer.invoke("agentCustody.quiesce", migrationId, scope),
    stage: (migrationId: string, scope: string, accountUserId: string, encrypted: string | null,
      expected: string | null): Promise<void> =>
      ipcRenderer.invoke("agentCustody.stage", migrationId, scope, accountUserId, encrypted, expected),
    finalize: (migrationId: string, accountUserId: string): Promise<void> =>
      ipcRenderer.invoke("agentCustody.finalize", migrationId, accountUserId),
  },
  get: async <T>(store: LocalStoreName, id: string): Promise<T | undefined> =>
    fromWire<T | undefined>(store, await ipcRenderer.invoke("localVault.get", store, id)),
  list: async <T>(store: LocalStoreName): Promise<{ id: string; value: T }[]> => {
    const rows = await ipcRenderer.invoke("localVault.list", store) as { id: string; value: unknown }[];
    return Promise.all(rows.map(async (row) => ({ id: row.id, value: await fromWire<T>(store, row.value) })));
  },
  commit: async (writes: LocalWrite[]): Promise<void> => {
    const encoded = await Promise.all(writes.map(async (write) => {
      if (write.store !== "attachments" || write.value == null) {
        return write;
      }
      const value = write.value as { cipherId: string; bytes: Blob };
      return { ...write, value: { cipherId: value.cipherId, bytes: new Uint8Array(await value.bytes.arrayBuffer()) } };
    }));
    return ipcRenderer.invoke("localVault.commit", encoded);
  },
  readKey: (): Promise<Uint8Array | null> => ipcRenderer.invoke("localVault.readKey"),
  writeKey: (key: Uint8Array): Promise<void> => ipcRenderer.invoke("localVault.writeKey", key),
  clearKey: (): Promise<void> => ipcRenderer.invoke("localVault.clearKey"),
  agent: {
    onRequest: (handler: (id: number, request: { action: string; [key: string]: unknown }) => void) => {
      ipcRenderer.on("agent.request", (_event, id: number, request: { action: string }) => handler(id, request));
    },
    respond: (id: number, answer: { error?: string; result?: unknown }) => ipcRenderer.send("agent.response", id, answer),
    ready: () => ipcRenderer.send("agent.ready"),
    changed: () => ipcRenderer.send("agent.changed"),
    pending: (): Promise<unknown> => ipcRenderer.invoke("agent.manage", "pending", {}),
    approve: (connectionId: string): Promise<unknown> => ipcRenderer.invoke("agent.manage", "approve", { connectionId }),
    answer: (requestId: string, answer: string, selectedEntryIds: string[]): Promise<unknown> =>
      ipcRenderer.invoke("agent.manage", "answer", { requestId, answer, selectedEntryIds }),
    revoke: (pairingId: string): Promise<unknown> => ipcRenderer.invoke("agent.manage", "revoke", { pairingId }),
  },
};
