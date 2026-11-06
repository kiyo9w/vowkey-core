import { BehaviorSubject } from "rxjs";

import { AccountService } from "../../auth/abstractions/account.service";
import { UserId } from "../../types/guid";
import { CipherSdkService } from "../abstractions/cipher-sdk.service";
import { CipherService } from "../abstractions/cipher.service";
import { CipherType, FieldType } from "../enums";
import { AttachmentView } from "../models/view/attachment.view";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";

import { ProfileService } from "./profile.service";
import {
  agentRuleOf,
  migrateLegacyProfile,
  prepareProfileSave,
  readEnvelope,
  recordCapture,
  writeEnvelope,
} from "./vk-meta";

function textField(name: string, value: string): FieldView {
  const f = new FieldView();
  f.name = name;
  f.value = value;
  f.type = FieldType.Text;
  return f;
}

describe("ProfileService.edit", () => {
  const userId = "11111111-1111-4111-8111-111111111111" as UserId;
  const profileId = "6f1c0a2e-7b34-4c1d-9a10-2d5e6f708192";

  it("changes an AI permission rule on this computer without saving the profile to the account", async () => {
    let seq = 0;
    const opts = {
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
      now: () => new Date("2026-04-02T08:15:00.000Z"),
    };

    const stored = new CipherView();
    stored.id = profileId;
    stored.type = CipherType.Identity;
    stored.name = "Takeshi Yamada";
    stored.edit = true;
    stored.viewPassword = true;
    stored.identity = new IdentityView();
    // Stale legacy wire identity value that differs from the envelope's verified OCR detail
    stored.identity.passportNumber = "OLD-STALE-999";

    const seed = new CipherView();
    seed.id = profileId;
    seed.type = CipherType.Identity;
    const meta = migrateLegacyProfile(seed, opts);
    recordCapture(
      meta,
      { fileName: "passport.png", mediaType: "image/png", kind: "passport" },
      [
        { key: "passport.number", value: "TK1234567", origin: "ocr", verified: true },
        { key: "name.given.latin", value: "Takeshi", origin: "ocr", verified: true },
      ],
      opts,
    );
    writeEnvelope(stored, meta);
    // Stray FieldType.Text left over on cipher.fields alongside vk.meta
    stored.fields.push(textField("stray.unprojected.key", "leftover-wire-noise"));

    const passportDetail = readEnvelope(stored)!.details.find(
      (d) => d.attribute?.includes("passport"),
    )!;
    expect(passportDetail).toBeDefined();
    expect(agentRuleOf(passportDetail)).toBe("ask");

    const savingTransitions: boolean[] = [];
    const sub = ProfileService.saving$.subscribe((v) => savingTransitions.push(v));

    const accounts = {
      activeAccount$: new BehaviorSubject({ id: userId }),
    } as unknown as AccountService;

    let observedSavingDuringRpc = false;
    const ciphers = {
      get: jest.fn(async () => ({ id: profileId })),
      decrypt: jest.fn(async () => stored),
      updateWithServer: jest.fn(
        async (cipher: CipherView, _uid: UserId, original?: CipherView) => {
          observedSavingDuringRpc = ProfileService.saving$.value;
          // Run the exact reconciliation CipherService.updateWithServer runs before encryption
          prepareProfileSave(cipher, original);
          return cipher;
        },
      ),
    } as unknown as CipherService;

    const service = new ProfileService(
      accounts,
      ciphers,
      null,
      {} as unknown as CipherSdkService,
    );

    const saved = await service.edit(profileId, {
      kind: "rule",
      detailId: passportDetail.id,
      rule: "never",
    });
    sub.unsubscribe();

    // An AI permission rule stays on this computer: nothing is saved to the account.
    expect(ciphers.updateWithServer).not.toHaveBeenCalled();
    expect(savingTransitions).toEqual([false]);
    expect(observedSavingDuringRpc).toBe(false);
    expect(agentRuleOf(readEnvelope(saved)!.details.find((d) => d.id === passportDetail.id)!)).toBe("never");
  });

  it("caches decrypted document bytes across repeated tab switches, deduplicates concurrent reads, and zeroes cache on clear", async () => {
    ProfileService.clearByteCache();
    const stored = new CipherView();
    stored.id = profileId;
    stored.type = CipherType.Identity;
    stored.name = "Trần Bảo Ngọc";
    const att = new AttachmentView();
    att.id = "att-rescard";
    stored.attachments = [att];

    const seed = new CipherView();
    seed.id = profileId;
    seed.type = CipherType.Identity;
    let seq = 0;
    const opts = {
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
      now: () => new Date("2026-04-02T08:15:00.000Z"),
    };
    const meta = migrateLegacyProfile(seed, opts);
    recordCapture(
      meta,
      {
        fileName: "Residence Card (Front).png",
        mediaType: "image/png",
        kind: "residence_card",
      },
      [],
      opts,
    );
    meta.sources[0].attachmentId = "att-rescard";
    const sourceId = meta.sources[0].id;
    writeEnvelope(stored, meta);

    const activeAccount$ = new BehaviorSubject<{ id: UserId } | null>({ id: userId });
    const rawBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    const getUrl = jest.fn(async () => "https://vault.example/att-rescard");
    const decryptBuf = jest.fn(async () => new Uint8Array(rawBytes));
    const origFetch = globalThis.fetch;
    const mockFetch = jest.fn(async () => ({ ok: true } as Response));
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    try {
      const service = new ProfileService(
        { activeAccount$ } as unknown as AccountService,
        {
          get: jest.fn(async () => ({ id: profileId })),
          decrypt: jest.fn(async () => stored),
          getLocalAttachment: jest.fn(async () => null),
          getDecryptedAttachmentBuffer: decryptBuf,
        } as unknown as CipherService,
        null,
        { getAttachmentDownloadUrl: getUrl } as unknown as CipherSdkService,
      );

      // Concurrent reads share one network + decrypt pass
      const [b1, b2] = await Promise.all([
        service.bytes(profileId, sourceId, "att-rescard"),
        service.bytes(profileId, sourceId, "att-rescard"),
      ]);
      expect(Array.from(b1)).toEqual(Array.from(rawBytes));
      expect(b2).toBe(b1);
      expect(getUrl).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(decryptBuf).toHaveBeenCalledTimes(1);

      // Synchronous peek + subsequent tab switch hit RAM in 0ms with 0 extra fetches
      expect(ProfileService.peekCachedBytes(profileId, sourceId, "att-rescard")).toBe(b1);
      const b3 = await service.bytes(profileId, sourceId, "att-rescard");
      expect(b3).toBe(b1);
      expect(getUrl).toHaveBeenCalledTimes(1);

      // Vault lock / clear zeroes underlying buffer and evicts entry
      ProfileService.clearByteCache();
      expect(ProfileService.peekCachedBytes(profileId, sourceId, "att-rescard")).toBeNull();
      expect(Array.from(b1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    } finally {
      globalThis.fetch = origFetch;
      ProfileService.clearByteCache();
    }
  });
});
