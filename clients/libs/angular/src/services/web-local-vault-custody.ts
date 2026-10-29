import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { MigrationCustody } from "@vowkey/common/vault/local/migration";

interface WebCustodyIntent {
  v: 1;
  migrationId: string;
  source: string;
  destination?: string;
}

/** Web has no broker files or OS credentials; its active fill gate is page-owned. */
export class WebLocalVaultCustody implements MigrationCustody {
  constructor(private readonly vault: LocalVaultService) {}

  async quiesce(migrationId: string): Promise<void> {
    await this.vault.quiesce(migrationId);
    const id = `${migrationId}:web-custody`;
    if (await this.vault.store.get("migrations", id) == null) {
      const metadata = await this.vault.migrationMetadata();
      await this.vault.store.commit([{
        store: "migrations", id, value: {
          v: 1, migrationId,
          source: await this.vault.seal(JSON.stringify({
            v: 1, migrationId, scopeId: metadata.attachedUserId ?? `local:${metadata.installationId}`,
          })),
        } satisfies WebCustodyIntent,
      }]);
    }
  }

  async rebind(input: Parameters<MigrationCustody["rebind"]>[0]): Promise<void> {
    const metadata = await this.vault.migrationMetadata();
    const migrationId = metadata.activeMigrationId;
    if (migrationId == null) {
      throw new Error("The local fill gate has not been closed for attachment.");
    }
    const id = `${migrationId}:web-custody`;
    const intent = await this.vault.store.get<WebCustodyIntent>("migrations", id);
    if (intent == null) {
      throw new Error("The local fill handoff is unavailable. Your saved items are retained.");
    }
    const source = JSON.parse(await input.open(intent.source)) as { migrationId: string };
    if (source.migrationId !== migrationId) {
      throw new Error("The local fill handoff does not match this attachment.");
    }
    const destination = await input.seal(JSON.stringify({
      v: 1, migrationId, accountUserId: input.accountUserId,
      cipherIds: [...input.cipherIds], attachmentIds: [...input.attachmentIds],
    }));
    await this.vault.store.commit([{ store: "migrations", id, value: { ...intent, destination } }]);
  }

  async finalize(migrationId: string, accountUserId: string): Promise<void> {
    const id = `${migrationId}:web-custody`;
    const intent = await this.vault.store.get<WebCustodyIntent>("migrations", id);
    if (intent == null) {
      return;
    }
    if (intent.destination == null) {
      throw new Error("The local fill handoff has not been protected by the account.");
    }
    const destination = JSON.parse(await this.vault.open(intent.destination)) as {
      migrationId: string; accountUserId: string;
    };
    if (destination.migrationId !== migrationId || destination.accountUserId !== accountUserId) {
      throw new Error("The local fill handoff belongs to another account.");
    }
    await this.vault.store.commit([{ store: "migrations", id }]);
  }
}
