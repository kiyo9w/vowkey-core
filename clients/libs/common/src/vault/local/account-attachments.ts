import type { LocalAttachmentRecord } from "./local-vault.service";
import type { LocalVaultStore, LocalWrite } from "./store";

const CACHE_KIND = "account-attachment-v1";
const CACHE_PREFIX = `["${CACHE_KIND}",`;

/** Account attachments retain the server's ciphertext, separate from guest item ownership. */
export class AccountAttachmentCache {
  constructor(private readonly store: LocalVaultStore) {}

  private id(userId: string, cipherId: string, attachmentId: string): string {
    return JSON.stringify([CACHE_KIND, userId, cipherId, attachmentId]);
  }

  async get(userId: string, cipherId: string, attachmentId: string): Promise<Blob | null> {
    const id = this.id(userId, cipherId, attachmentId);
    const record = await this.store.get<LocalAttachmentRecord>("attachments", id);
    return record?.cipherId === id ? record.bytes : null;
  }

  async put(userId: string, cipherId: string, attachmentId: string, ciphertext: ArrayBuffer): Promise<void> {
    const id = this.id(userId, cipherId, attachmentId);
    await this.store.commit([
      { store: "attachments", id, value: { cipherId: id, bytes: new Blob([ciphertext]) } satisfies LocalAttachmentRecord },
      { store: "operations", id, value: true },
    ]);
  }

  async retain(userId: string, attachments: ReadonlyMap<string, ReadonlySet<string>>, onlyCipherIds?: ReadonlySet<string>): Promise<void> {
    const writes: LocalWrite[] = [];
    for (const { id } of await this.store.list("operations")) {
      if (!id.startsWith(CACHE_PREFIX)) {
        continue;
      }
      const [, owner, cipherId, attachmentId] = JSON.parse(id) as string[];
      if (owner !== userId || onlyCipherIds != null && !onlyCipherIds.has(cipherId)) {
        continue;
      }
      if (!attachments.get(cipherId)?.has(attachmentId)) {
        writes.push({ store: "attachments", id }, { store: "operations", id });
      }
    }
    if (writes.length > 0) {
      await this.store.commit(writes);
    }
  }
}
