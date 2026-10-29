import { mock } from "jest-mock-extended";

import { AgentSnapshot } from "@vowkey/common/vault/agent/executor";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { LocalVaultStore } from "@vowkey/common/vault/local/store";
import { desktopMigrationCustody } from "../../desktop/src/local-vault/custody";

it("remaps an already attached account's pending ids without replacing them with its old snapshot", async () => {
  const vault = mock<LocalVaultService>();
  const store = mock<LocalVaultStore>();
  Object.defineProperty(vault, "store", { value: store });
  vault.migrationMetadata.mockResolvedValue({
    v: 1, installationId: "installation", databaseId: "local-vault-v1", attachedUserId: "account-1",
    activeMigrationId: "migration-1", kdf: null, wrappedUserKey: null, publicKey: null, encryptedPrivateKey: null,
  });
  const source: AgentSnapshot = {
    v: 1, localExecutorId: "executor-1", epoch: 2, requests: [], journal: [], activity: [],
    pairings: [{ pairingId: "editor-1", displayName: "Editor", vaultScopeId: "account-1",
      encryptedVerifier: JSON.stringify("verifier"), createdAt: "2026-01-01T00:00:00.000Z",
      revokedAt: null, accountRegistered: true }],
    grants: [{ pairingId: "editor-1", destinationKey: "web:https://forms.example", cipherId: "pending-1",
      fieldPath: "key.value", revokedAt: null, revision: 1 }],
  };
  const encrypted = JSON.stringify(source);
  store.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
    v: 1, oldScope: "account-1", source: encrypted,
  });
  const ipcCustody = { quiesce: jest.fn().mockResolvedValue(encrypted), stage: jest.fn(), finalize: jest.fn() };
  const original = Object.getOwnPropertyDescriptor(globalThis, "ipc");
  Object.defineProperty(globalThis, "ipc", { configurable: true, value: { localVault: { custody: ipcCustody } } });
  try {
    const custody = desktopMigrationCustody(vault);
    await custody.quiesce("migration-1");
    expect(ipcCustody.quiesce).toHaveBeenCalledWith("migration-1", "account-1");
    await custody.rebind({
      accountUserId: "account-1", cipherIds: new Map([["pending-1", "server-1"]]), attachmentIds: new Map(),
      open: async (value) => value, openAccount: async (value) => value, seal: async (value) => value,
    });
    const staged = JSON.parse(ipcCustody.stage.mock.calls[0][3]) as AgentSnapshot;
    expect(staged.grants[0].cipherId).toBe("server-1");
    expect(staged.pairings[0].accountRegistered).toBe(true);
    expect(staged.pairings[0].previousVaultScopeIds).toBeUndefined();
    expect(ipcCustody.stage.mock.calls[0][4]).toBe(encrypted);
  } finally {
    if (original != null) { Object.defineProperty(globalThis, "ipc", original); }
    else { Reflect.deleteProperty(globalThis, "ipc"); }
  }
});
