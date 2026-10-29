import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { MigrationCustody, remapPhysicalIds } from "@vowkey/common/vault/local/migration";
import { AgentSnapshot } from "@vowkey/common/vault/agent/executor";
import { mergeAgentSnapshots } from "@vowkey/common/vault/agent/snapshot";
import { LocalVaultAccountKeyCustody } from "@vowkey/common/vault/local/protection";

export function desktopAccountKeyCustody(): LocalVaultAccountKeyCustody {
  return {
    quiesce: (id, userId) => ipc.localVault.custody.quiesce(id, userId),
    stage: (id, userId, encrypted, expected) =>
      ipc.localVault.custody.stage(id, userId, userId, encrypted, expected),
    finalize: (id, userId) => ipc.localVault.custody.finalize(id, userId),
    resume: () => {
      ipc.localVault.agent.changed();
      ipc.localVault.agent.ready();
    },
  };
}

interface DesktopCustodyIntent {
  v: 1;
  oldScope: string;
  source: string | null;
}

export function desktopMigrationCustody(vault: LocalVaultService): MigrationCustody {
  return {
    quiesce: async (migrationId) => {
      await vault.quiesce(migrationId);
      const id = `${migrationId}:desktop-custody`;
      if (await vault.store.get("migrations", id) != null) {
        return;
      }
      const metadata = await vault.migrationMetadata();
      const oldScope = metadata.attachedUserId ?? `local:${metadata.installationId}`;
      const source = await ipc.localVault.custody.quiesce(migrationId, oldScope);
      await vault.store.commit([{
        store: "migrations", id, value: { v: 1, oldScope, source } satisfies DesktopCustodyIntent,
      }]);
    },
    rebind: async (input) => {
      const migrationId = (await vault.migrationMetadata()).activeMigrationId;
      if (migrationId == null) {
        throw new Error("The local vault is not being attached.");
      }
      const intent = await vault.store.get<DesktopCustodyIntent>("migrations", `${migrationId}:desktop-custody`);
      if (intent == null || intent.v !== 1) {
        throw new Error("The local agent handoff is unavailable.");
      }
      let destination: string | null = null;
      const existing = await ipc.localVault.custody.quiesce(migrationId, input.accountUserId);
      const encryptedSource = intent.oldScope === input.accountUserId ? existing ?? intent.source : intent.source;
      if (encryptedSource != null) {
        const source = JSON.parse(await input.open(encryptedSource)) as AgentSnapshot;
        if (source.v !== 1 || !Array.isArray(source.pairings) || !Array.isArray(source.requests)) {
          throw new Error("The local agent state is unreadable.");
        }
        const snapshot = remapPhysicalIds(source, input.cipherIds, input.attachmentIds,
          intent.oldScope, input.accountUserId) as AgentSnapshot;
        for (const pairing of snapshot.pairings) {
          if (intent.oldScope !== input.accountUserId) {
            pairing.previousVaultScopeIds = [...new Set([
              ...pairing.previousVaultScopeIds ?? [], intent.oldScope,
            ])];
            pairing.accountRegistered = false;
          }
          pairing.encryptedVerifier = await input.seal(await input.open(pairing.encryptedVerifier));
        }
        if (intent.oldScope !== input.accountUserId) {
          for (const request of snapshot.requests) { request.accountRegistered = false; }
        }
        const account = existing == null || intent.oldScope === input.accountUserId
          ? null : JSON.parse(await input.openAccount(existing)) as AgentSnapshot;
        destination = await input.seal(JSON.stringify(mergeAgentSnapshots(snapshot, account)));
      }
      await ipc.localVault.custody.stage(migrationId, intent.oldScope, input.accountUserId, destination, existing);
    },
    finalize: async (migrationId, accountUserId) => {
      await ipc.localVault.custody.finalize(migrationId, accountUserId);
      await vault.store.commit([{ store: "migrations", id: `${migrationId}:desktop-custody` }]);
    },
  };
}
