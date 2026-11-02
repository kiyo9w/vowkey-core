import { BehaviorSubject } from "rxjs";

import { AccountService } from "../../auth/abstractions/account.service";
import { Utils } from "../../platform/misc/utils";
import { UserId } from "../../types/guid";
import { CipherSdkService } from "../abstractions/cipher-sdk.service";
import { CipherService } from "../abstractions/cipher.service";
import { LocalVaultService } from "../local/local-vault.service";
import { CipherView } from "../models/view/cipher.view";

import { ProfileService } from "./profile.service";
import {
  buildSampleProfileCipher,
  fillPracticeFormFromSample,
  isSampleProfile,
  SAMPLE_SCENARIO_LIST,
} from "./sample-walkthrough";
import { readEnvelope } from "./vk-meta";

describe("sample-walkthrough & ProfileService.bytes", () => {
  it("builds valid VkMetaV1 sample profiles across all scenarios with zero attachment blobs and in-bounds PageLocators", () => {
    for (const scenario of SAMPLE_SCENARIO_LIST) {
      const cipher = buildSampleProfileCipher(scenario.id);
      cipher.id = Utils.newGuid();

      expect(isSampleProfile(cipher)).toBe(true);
      expect(cipher.attachments).toEqual([]);

      const meta = readEnvelope(cipher);
      expect(meta).not.toBeNull();
      expect(meta!.sources).toHaveLength(1);
      expect(meta!.sources[0].attachmentId).toBe(`sample:${scenario.id}`);
      expect(meta!.sources[0].mediaType).toBe("image/png");

      for (const detail of meta!.details) {
        expect(detail.variants.length).toBeGreaterThan(0);
        for (const variant of detail.variants) {
          expect(variant.sourceId).toBe(meta!.sources[0].id);
          expect(variant.locator?.kind).toBe("page");
          if (variant.locator?.kind === "page") {
            expect(variant.locator.x).toBeGreaterThanOrEqual(0);
            expect(variant.locator.y).toBeGreaterThanOrEqual(0);
            expect(variant.locator.x + variant.locator.w).toBeLessThanOrEqual(1);
            expect(variant.locator.y + variant.locator.h).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("resolves sample:* PNG bytes offline through ProfileService.bytes for both guest and signed-in accounts without network calls", async () => {
    const sample = buildSampleProfileCipher("passport");
    sample.id = Utils.newGuid();
    const sourceId = readEnvelope(sample)!.sources[0].id;

    const activeAccount$ = new BehaviorSubject<{ id: UserId } | null>(null);
    const localAttachmentSpy = jest.fn();
    const sdkUrlSpy = jest.fn();

    const localVault = {
      list: jest.fn().mockResolvedValue([sample]),
      attachment: localAttachmentSpy,
      save: jest.fn(async (c: CipherView) => c),
    } as unknown as LocalVaultService;

    const ciphers = {
      get: jest.fn().mockResolvedValue({ id: sample.id }),
      decrypt: jest.fn().mockResolvedValue(sample),
      getLocalAttachment: jest.fn().mockResolvedValue(null),
      updateWithServer: jest.fn(async (c: CipherView) => c),
    } as unknown as CipherService;

    const sdk = {
      getAttachmentDownloadUrl: sdkUrlSpy,
    } as unknown as CipherSdkService;

    const service = new ProfileService(
      { activeAccount$ } as unknown as AccountService,
      ciphers,
      localVault,
      sdk,
    );

    const guestBytes = await service.bytes(sample.id, sourceId);
    expect(Array.from(guestBytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(localAttachmentSpy).not.toHaveBeenCalled();
    expect(sdkUrlSpy).not.toHaveBeenCalled();

    activeAccount$.next({ id: Utils.newGuid() as UserId });
    const accountBytes = await service.bytes(sample.id, sourceId);
    expect(Array.from(accountBytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(sdkUrlSpy).not.toHaveBeenCalled();
  });

  it("preserves the sample marker on ProfileService.edit and propagates user corrections into practice form fills", async () => {
    let stored = buildSampleProfileCipher("idcard");
    stored.id = Utils.newGuid();

    const familyDetail = readEnvelope(stored)!.details.find((d) => d.attribute === "name.family")!;
    const variantId = familyDetail.variants[0].id;

    const activeAccount$ = new BehaviorSubject<{ id: UserId } | null>(null);
    const localVault = {
      list: jest.fn(async () => [stored]),
      save: jest.fn(async (c: CipherView) => {
        stored = c;
        return c;
      }),
    } as unknown as LocalVaultService;

    const service = new ProfileService(
      { activeAccount$ } as unknown as AccountService,
      {} as CipherService,
      localVault,
      {} as CipherSdkService,
    );

    const updated = await service.edit(stored.id!, {
      kind: "correct",
      detailId: familyDetail.id,
      variantId,
      value: "Lindqvist",
    });

    expect(isSampleProfile(updated)).toBe(true);
    const filled = fillPracticeFormFromSample(updated);
    expect(filled.values["family"]).toBe("Lindqvist");
    expect(filled.filledCount).toBe(6);
  });
});
