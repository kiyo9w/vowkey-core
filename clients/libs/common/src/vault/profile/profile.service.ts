import { BehaviorSubject, filter, firstValueFrom, of, timeout } from "rxjs";

import { AccountService } from "../../auth/abstractions/account.service";
import { CipherId, UserId } from "../../types/guid";
import { CipherSdkService } from "../abstractions/cipher-sdk.service";
import { CipherService } from "../abstractions/cipher.service";
import { CipherType, FieldType } from "../enums";
import { LocalVaultService } from "../local/local-vault.service";
import { AccountAttachmentCache } from "../local/account-attachments";
import { CipherView } from "../models/view/cipher.view";

import {
  isSampleAttachmentId,
  renderSampleDocumentBytes,
} from "./sample-walkthrough";
import {
  addTypedDetail, AgentRule, applyProjection, chooseVariant, correctVariant, deleteDetail,
  dismissVariant, migrateLegacyProfile, projectEnvelope, readEnvelope, relabelDetail,
  setLocalAgentRule, ValueType, VK_META_FIELD, writeEnvelope,
} from "./vk-meta";

export type ProfileDetailEdit =
  | { kind: "correct"; detailId: string; variantId: string; value: string }
  | { kind: "choose"; detailId: string; variantId: string }
  | { kind: "dismiss"; detailId: string; variantId: string }
  | { kind: "delete"; detailId: string }
  | { kind: "rule"; detailId: string; rule: AgentRule }
  | { kind: "add"; label: string; value: string; valueType: ValueType }
  | { kind: "restore"; detailId: string; variantId: string }
  | { kind: "relabel"; detailId: string; attribute: string | null; label: string };

const MAX_CACHED_DOCUMENTS = 96;
const MAX_CACHED_DOCUMENT_BYTES = 128 * 1024 * 1024;

/** The same authorized profile edit and original-byte path for every Angular surface. */
export class ProfileService {
  private static activeSaveCount = 0;
  static readonly saving$ = new BehaviorSubject<boolean>(false);

  private static cachedScope: string | null = null;
  private static cachedTotalBytes = 0;
  private static readonly byteLru = new Map<
    string,
    { attachmentId: string; bytes: Uint8Array }
  >();
  private static readonly inflightBytes = new Map<
    string,
    Promise<{ attachmentId: string; bytes: Uint8Array }>
  >();
  private static byteCacheEpoch = 0;

  private static toOwnedUint8Array(buf: Uint8Array | ArrayBuffer): Uint8Array {
    if (buf instanceof Uint8Array) {
      const copy = new Uint8Array(buf.byteLength);
      copy.set(buf);
      return copy;
    }
    return new Uint8Array(buf.slice(0));
  }

  private static zeroBytes(buf: unknown): void {
    if (buf instanceof Uint8Array) {
      buf.fill(0);
    } else if (buf instanceof ArrayBuffer) {
      new Uint8Array(buf).fill(0);
    }
  }

  static clearByteCache(): void {
    ProfileService.byteCacheEpoch++;
    for (const entry of ProfileService.byteLru.values()) {
      ProfileService.zeroBytes(entry.bytes);
    }
    ProfileService.byteLru.clear();
    ProfileService.inflightBytes.clear();
    ProfileService.cachedTotalBytes = 0;
  }

  private static ensureScope(userId: UserId | null): string {
    const scope = userId ?? "local";
    if (ProfileService.cachedScope !== null && ProfileService.cachedScope !== scope) {
      ProfileService.clearByteCache();
    }
    ProfileService.cachedScope = scope;
    return scope;
  }

  static peekCachedBytes(
    cipherId: string,
    sourceId: string,
    expectedAttachmentId?: string | null,
  ): Uint8Array | null {
    if (ProfileService.cachedScope == null) {
      return null;
    }
    const key = `${ProfileService.cachedScope}:${cipherId}:${sourceId}`;
    const hit = ProfileService.byteLru.get(key);
    if (!hit) {
      return null;
    }
    if (expectedAttachmentId && hit.attachmentId !== expectedAttachmentId) {
      ProfileService.zeroBytes(hit.bytes);
      ProfileService.cachedTotalBytes = Math.max(
        0,
        ProfileService.cachedTotalBytes - hit.bytes.byteLength,
      );
      ProfileService.byteLru.delete(key);
      return null;
    }
    // Bump LRU order
    ProfileService.byteLru.delete(key);
    ProfileService.byteLru.set(key, hit);
    return hit.bytes;
  }

  private static storeCachedBytes(
    key: string,
    attachmentId: string,
    rawBytes: Uint8Array | ArrayBuffer,
    epoch: number,
  ): Uint8Array {
    if (epoch !== ProfileService.byteCacheEpoch) {
      ProfileService.zeroBytes(rawBytes);
      throw new Error("The vault was locked or changed. Open the document again.");
    }
    const bytes = ProfileService.toOwnedUint8Array(rawBytes);
    if (bytes.byteLength > MAX_CACHED_DOCUMENT_BYTES / 2) {
      return bytes;
    }
    const prev = ProfileService.byteLru.get(key);
    if (prev) {
      if (prev.bytes !== bytes) {
        ProfileService.zeroBytes(prev.bytes);
      }
      ProfileService.cachedTotalBytes = Math.max(
        0,
        ProfileService.cachedTotalBytes - prev.bytes.byteLength,
      );
      ProfileService.byteLru.delete(key);
    }
    while (
      ProfileService.byteLru.size >= MAX_CACHED_DOCUMENTS ||
      (ProfileService.byteLru.size > 0 &&
        ProfileService.cachedTotalBytes + bytes.byteLength > MAX_CACHED_DOCUMENT_BYTES)
    ) {
      const oldestKey = ProfileService.byteLru.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const evicted = ProfileService.byteLru.get(oldestKey);
      if (evicted) {
        ProfileService.zeroBytes(evicted.bytes);
        ProfileService.cachedTotalBytes = Math.max(
          0,
          ProfileService.cachedTotalBytes - evicted.bytes.byteLength,
        );
      }
      ProfileService.byteLru.delete(oldestKey);
    }
    ProfileService.byteLru.set(key, { attachmentId, bytes });
    ProfileService.cachedTotalBytes += bytes.byteLength;
    return bytes;
  }

  private static beginSave(): void {
    ProfileService.activeSaveCount++;
    if (!ProfileService.saving$.value) {
      ProfileService.saving$.next(true);
    }
  }

  private static endSave(): void {
    ProfileService.activeSaveCount = Math.max(0, ProfileService.activeSaveCount - 1);
    if (ProfileService.activeSaveCount === 0 && ProfileService.saving$.value) {
      ProfileService.saving$.next(false);
    }
  }

  constructor(
    private readonly accounts: AccountService,
    private readonly ciphers: CipherService,
    private readonly local: LocalVaultService | null,
    private readonly sdk: CipherSdkService,
  ) {}

  private prefetchSignature: string | null = null;

  async prefetch(profiles: readonly CipherView[]): Promise<void> {
    if (this.local == null) {
      return;
    }
    const userId = (await firstValueFrom(this.accounts.activeAccount$))?.id ?? null;
    if (userId == null) {
      return;
    }
    ProfileService.ensureScope(userId);
    const originals = profiles
      .filter((profile) => !profile.isDeleted && !profile.migrationPending)
      .flatMap((profile) => (readEnvelope(profile)?.sources ?? [])
        .filter((source) => source.attachmentId != null && source.status !== "deleted")
        .map((source) => ({ cipherId: profile.id, sourceId: source.id, attachmentId: source.attachmentId! })));
    const signature = JSON.stringify([userId, originals]);
    if (this.prefetchSignature === signature) {
      return;
    }
    this.prefetchSignature = signature;
    const epoch = ProfileService.byteCacheEpoch;
    const retained = new Map<string, Set<string>>();
    for (const original of originals) {
      const attachments = retained.get(original.cipherId) ?? new Set<string>();
      attachments.add(original.attachmentId);
      retained.set(original.cipherId, attachments);
    }
    let cursor = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(4, originals.length) }, async () => {
      while (cursor < originals.length && epoch === ProfileService.byteCacheEpoch) {
        const original = originals[cursor++];
        try {
          await this.bytes(original.cipherId, original.sourceId, original.attachmentId);
        } catch (error) {
          failure ??= error;
        }
      }
    }));
    if (epoch !== ProfileService.byteCacheEpoch) {
      this.prefetchSignature = null;
      return;
    }
    await this.assertAccount(userId);
    await new AccountAttachmentCache(this.local.store).retain(userId, retained);
    if (failure != null) {
      this.prefetchSignature = null;
      throw failure;
    }
  }

  async load(id: string): Promise<CipherView> {
    const userId = (await firstValueFrom(this.accounts.activeAccount$))?.id ?? null;
    return this.loadForAccount(id, userId);
  }

  private async assertAccount(userId: UserId | null): Promise<void> {
    if (((await firstValueFrom(this.accounts.activeAccount$))?.id ?? null) !== userId) {
      throw new Error("The active vault changed. Open the profile again.");
    }
  }

  private async loadForAccount(id: string, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    const encrypted = userId != null ? await this.ciphers.get(id, userId) : null;
    await this.assertAccount(userId);
    const profile = userId != null
      ? encrypted != null ? await this.ciphers.decrypt(encrypted, userId) : null
      : (await this.localVault().list()).find((item) => item.id === id);
    await this.assertAccount(userId);
    if (profile == null || profile.type !== CipherType.Identity || profile.isDeleted || profile.migrationPending) {
      throw new Error("The profile is unavailable.");
    }
    return CipherView.fromSdkCipherView(profile.toSdkCipherView())!;
  }

  async edit(id: string, edit: ProfileDetailEdit): Promise<CipherView> {
    const userId = (await firstValueFrom(this.accounts.activeAccount$))?.id ?? null;
    const profile = await this.loadForAccount(id, userId);
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    const original = CipherView.fromSdkCipherView(profile.toSdkCipherView())!;
    const hadEnvelope = readEnvelope(profile) != null;
    const meta = migrateLegacyProfile(profile);
    if (edit.kind === "rule") {
      if (!meta.details.some((item) => item.id === edit.detailId)) {
        throw new Error("That detail is not in this profile.");
      }
      setLocalAgentRule(edit.detailId, edit.rule);
      return original;
    }
    const previous = new Set<string>(projectEnvelope(meta).text.keys());
    if (hadEnvelope) {
      for (const field of profile.fields ?? []) {
        if (field.type === FieldType.Text && field.name && field.name !== VK_META_FIELD) {
          previous.add(field.name);
        }
      }
    }
    const detail = "detailId" in edit ? meta.details.find((item) => item.id === edit.detailId) : null;
    if (detail?.valueType === "secret" && profile.viewPassword === false) {
      throw new Error("This detail cannot be viewed or edited.");
    }
    switch (edit.kind) {
      case "correct":
        if (!edit.value.trim()) {
          throw new Error("Enter a value, or delete the detail.");
        }
        correctVariant(meta, edit.detailId, edit.variantId, edit.value);
        break;
      case "choose": chooseVariant(meta, edit.detailId, edit.variantId); break;
      case "dismiss": dismissVariant(meta, edit.detailId, edit.variantId); break;
      case "delete": deleteDetail(meta, edit.detailId); break;
      case "add":
        if (!edit.label.trim() || !edit.value.trim()) {
          throw new Error("Enter a label and a value.");
        }
        addTypedDetail(meta, edit);
        break;
      case "restore": {
        const historical = detail?.history.find((entry) => entry.variant.id === edit.variantId)?.variant;
        if (historical == null || detail == null) {
          throw new Error("The saved value is unavailable.");
        }
        const restored = { ...historical, id: crypto.randomUUID(), current: true };
        detail.variants.push(restored);
        detail.chosenVariantId = restored.id;
        break;
      }
      case "relabel":
        relabelDetail(meta, edit.detailId, edit.attribute, edit.label);
        break;
    }
    writeEnvelope(profile, meta);
    applyProjection(profile, projectEnvelope(meta), previous);
    await this.assertAccount(userId);
    ProfileService.beginSave();
    try {
      const saved = userId != null
        ? await this.ciphers.updateWithServer(profile, userId, original)
        : await this.localVault().save(profile);
      if (userId != null && typeof this.ciphers.cipherViews$ === "function") {
        await firstValueFrom(
          this.ciphers.cipherViews$(userId).pipe(
            filter((views) => views != null),
            timeout({ first: 1500, with: () => of([]) }),
          ),
        );
      }
      await this.assertAccount(userId);
      return saved;
    } finally {
      ProfileService.endSave();
    }
  }

  async bytes(
    id: string,
    sourceId: string,
    expectedAttachmentId?: string | null,
  ): Promise<Uint8Array> {
    const userId = (await firstValueFrom(this.accounts.activeAccount$))?.id ?? null;
    const scope = ProfileService.ensureScope(userId);
    const epoch = ProfileService.byteCacheEpoch;
    const cacheKey = `${scope}:${id}:${sourceId}`;
    const cached = ProfileService.peekCachedBytes(id, sourceId, expectedAttachmentId);
    if (cached != null) {
      return cached;
    }
    const existingInflight = ProfileService.inflightBytes.get(cacheKey);
    if (existingInflight != null) {
      const resolved = await existingInflight;
      if (!expectedAttachmentId || resolved.attachmentId === expectedAttachmentId) {
        await this.assertAccount(userId);
        return resolved.bytes;
      }
    }

    const loadTask = (async (): Promise<{ attachmentId: string; bytes: Uint8Array }> => {
      const profile = await this.loadForAccount(id, userId);
      const source = readEnvelope(profile)?.sources.find((item) => item.id === sourceId);
      if (source?.attachmentId == null || source.status === "deleted") {
        throw new Error("The document's bytes are unavailable.");
      }
      const attId = source.attachmentId;
      const rechecked = ProfileService.peekCachedBytes(id, sourceId, attId);
      if (rechecked != null) {
        return { attachmentId: attId, bytes: rechecked };
      }
      if (isSampleAttachmentId(attId)) {
        const sampleBytes = await renderSampleDocumentBytes(attId);
        await this.assertAccount(userId);
        const normalized = ProfileService.storeCachedBytes(cacheKey, attId, sampleBytes, epoch);
        return { attachmentId: attId, bytes: normalized };
      }
      if (userId == null) {
        const localVaultBytes = await this.localVault().attachment(attId);
        await this.assertAccount(userId);
        const normalized = ProfileService.storeCachedBytes(cacheKey, attId, localVaultBytes, epoch);
        return { attachmentId: attId, bytes: normalized };
      }
      const localBytes = await this.ciphers.getLocalAttachment(id, attId, userId);
      if (localBytes != null) {
        await this.assertAccount(userId);
        const normalized = ProfileService.storeCachedBytes(cacheKey, attId, localBytes, epoch);
        return { attachmentId: attId, bytes: normalized };
      }
      const attachment = profile.attachments.find((item) => item.id === attId);
      if (attachment == null) {
        throw new Error("The document's bytes are unavailable.");
      }
      const cache = this.local == null ? null : new AccountAttachmentCache(this.local.store);
      const persisted = await cache?.get(userId, id, attId);
      let response: Response;
      if (persisted != null) {
        response = new Response(persisted);
      } else {
        const url = await this.sdk.getAttachmentDownloadUrl(id as CipherId, attachment.id, userId);
        await this.assertAccount(userId);
        response = await fetch(
          typeof Request === "function" ? new Request(url, { cache: "no-store" }) : url,
          typeof Request === "function" ? undefined : { cache: "no-store" },
        );
      }
      if (!response.ok) {
        throw new Error("The document could not be downloaded. Try again when connected.");
      }
      const ciphertext = cache != null && persisted == null ? await response.clone().arrayBuffer() : null;
      await this.assertAccount(userId);
      const decrypted = await this.ciphers.getDecryptedAttachmentBuffer(
        id as CipherId,
        attachment,
        response,
        userId,
      );
      await this.assertAccount(userId);
      if (ciphertext != null) {
        await cache!.put(userId, id, attId, ciphertext);
      }
      const normalized = ProfileService.storeCachedBytes(cacheKey, attId, decrypted, epoch);
      return { attachmentId: attId, bytes: normalized };
    })();

    ProfileService.inflightBytes.set(cacheKey, loadTask);
    try {
      const result = await loadTask;
      return result.bytes;
    } finally {
      if (ProfileService.inflightBytes.get(cacheKey) === loadTask) {
        ProfileService.inflightBytes.delete(cacheKey);
      }
    }
  }

  private localVault(): LocalVaultService {
    if (this.local == null) {
      throw new Error("The local vault is unavailable.");
    }
    return this.local;
  }
}
