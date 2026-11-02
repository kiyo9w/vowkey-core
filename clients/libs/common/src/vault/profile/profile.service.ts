import { firstValueFrom } from "rxjs";

import { AccountService } from "../../auth/abstractions/account.service";
import { CipherId, UserId } from "../../types/guid";
import { CipherSdkService } from "../abstractions/cipher-sdk.service";
import { CipherService } from "../abstractions/cipher.service";
import { CipherType } from "../enums";
import { LocalVaultService } from "../local/local-vault.service";
import { CipherView } from "../models/view/cipher.view";

import {
  isSampleAttachmentId,
  renderSampleDocumentBytes,
} from "./sample-walkthrough";
import {
  addTypedDetail, AgentRule, applyProjection, chooseVariant, correctVariant, deleteDetail,
  dismissVariant, migrateLegacyProfile, projectEnvelope, readEnvelope, relabelDetail,
  setAgentRule, ValueType, writeEnvelope,
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

/** The same authorized profile edit and original-byte path for every Angular surface. */
export class ProfileService {
  constructor(
    private readonly accounts: AccountService,
    private readonly ciphers: CipherService,
    private readonly local: LocalVaultService | null,
    private readonly sdk: CipherSdkService,
  ) {}

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
    const meta = migrateLegacyProfile(profile);
    const previous = [...projectEnvelope(meta).text.keys()];
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
      case "rule": setAgentRule(meta, edit.detailId, edit.rule); break;
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
    const saved = userId != null
      ? await this.ciphers.updateWithServer(profile, userId)
      : await this.localVault().save(profile);
    await this.assertAccount(userId);
    return saved;
  }

  async bytes(id: string, sourceId: string): Promise<Uint8Array> {
    const userId = (await firstValueFrom(this.accounts.activeAccount$))?.id ?? null;
    const profile = await this.loadForAccount(id, userId);
    const source = readEnvelope(profile)?.sources.find((item) => item.id === sourceId);
    if (source?.attachmentId == null || source.status === "deleted") {
      throw new Error("The document's bytes are unavailable.");
    }
    if (isSampleAttachmentId(source.attachmentId)) {
      return renderSampleDocumentBytes(source.attachmentId);
    }
    if (userId == null) {
      const bytes = await this.localVault().attachment(source.attachmentId);
      await this.assertAccount(userId);
      return bytes;
    }
    const localBytes = await this.ciphers.getLocalAttachment(id, source.attachmentId, userId);
    if (localBytes != null) {
      await this.assertAccount(userId);
      return localBytes;
    }
    const attachment = profile.attachments.find((item) => item.id === source.attachmentId);
    if (attachment == null) {
      throw new Error("The document's bytes are unavailable.");
    }
    const url = await this.sdk.getAttachmentDownloadUrl(id as CipherId, attachment.id, userId);
    await this.assertAccount(userId);
    const response = await fetch(new Request(url, { cache: "no-store" }));
    if (!response.ok) {
      throw new Error("The document could not be downloaded. Try again when connected.");
    }
    await this.assertAccount(userId);
    const bytes = await this.ciphers.getDecryptedAttachmentBuffer(id as CipherId, attachment, response, userId);
    await this.assertAccount(userId);
    return bytes;
  }

  private localVault(): LocalVaultService {
    if (this.local == null) {
      throw new Error("The local vault is unavailable.");
    }
    return this.local;
  }
}
