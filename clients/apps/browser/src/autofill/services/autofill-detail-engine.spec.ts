import { webcrypto } from "node:crypto";

import { mock } from "jest-mock-extended";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

import { CipherType, FieldType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FieldView } from "@vowkey/common/vault/models/view/field.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { writeEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import * as sdk from "@vowkey/sdk-internal";

import AutofillField from "../models/autofill-field";

import {
  clearRememberedFormBindings,
  configureAutofillDetailEngine,
  detailsForFields,
  profileDetailsForCipher,
  rememberFieldDetailBinding,
  rememberedFieldDetailKey,
  stabilizeFieldIdentifier,
  suggestedDetailTypes,
} from "./autofill-detail-engine";

jest.mock("@vowkey/common/platform/abstractions/sdk/sdk-load.service", () => ({
  SdkLoadService: { Ready: Promise.resolve() },
}));

jest.mock("@vowkey/sdk-internal", () => ({
  detail_label: jest.fn((key: string) => {
    const labels: Record<string, string> = {
      "contact.phone": "Phone",
      "work.employer.phone": "Employer phone",
      "id.passport.number": "Passport number",
    };
    return labels[key] ?? "";
  }),
  profile_details: jest.fn((profile: { identity: Record<string, string>; custom: Map<string, string> }) => {
    const details = new Map<string, string>();
    if (profile.identity.phone) {
      details.set("contact.phone", profile.identity.phone);
    }
    if (profile.identity.passport_number) {
      details.set("id.passport.number", profile.identity.passport_number);
    }
    for (const [k, v] of profile.custom.entries()) {
      details.set(k.replace(/^vk\./, ""), v);
    }
    return { details };
  }),
  fill_form_with_profile: jest.fn(
    ({ fields, explicit_fill }: { fields: Array<{ label: string; name: string }>; explicit_fill: boolean }) => ({
      matches: fields.map((f) => ({
        attribute:
          explicit_fill && /passport|旅券|email/i.test(`${f.label} ${f.name}`)
            ? "id.passport.number"
            : "",
        chrome_type: "",
        owner: "applicant",
        score: explicit_fill ? 8 : 0,
        value: null as string | null,
      })),
    }),
  ),
  fill_fields_from_profile: jest.fn(
    ({
      fields,
      profile,
      choices,
    }: {
      fields: Array<{ id?: string; label: string; name: string }>;
      profile: { identity: Record<string, string>; custom: Map<string, string> };
      choices?: Array<{ id: string; attribute: string; owner: string }>;
    }) => ({
      matches: fields.map((f, index) => {
        const chosen = choices?.find((c) => c.id === (f.id || `f_${index}`) || c.id === String(index));
        if (chosen) {
          const val =
            profile.custom.get(`vk.${chosen.attribute}`) ??
            (chosen.attribute === "contact.phone" ? profile.identity.phone : null);
          return {
            attribute: chosen.attribute,
            chrome_type: "",
            owner: chosen.owner,
            score: 9,
            value: (val ?? null) as string | null,
          };
        }
        if (/phone|電話/i.test(`${f.label} ${f.name}`) && profile.identity.phone) {
          return {
            attribute: "contact.phone",
            chrome_type: "",
            owner: "applicant",
            score: 7,
            value: profile.identity.phone as string | null,
          };
        }
        return {
          attribute: "",
          chrome_type: "",
          owner: "applicant",
          score: 0,
          value: null as string | null,
        };
      }),
    }),
  ),
  decision_form_begin: jest.fn(() => "plan-1"),
  decision_form_requests: jest.fn(() => JSON.stringify([{ kind: "round" }])),
  decision_form_take_first_answers: jest.fn(() => "plan-2"),
  decision_form_choices: jest.fn((): unknown[] => []),
}));

describe("autofill-detail-engine", () => {
  const storageMap = new Map<string, unknown>();

  beforeEach(async () => {
    storageMap.clear();
    jest.clearAllMocks();
    (chrome.storage.local.get as jest.Mock).mockImplementation(async (key: string) =>
      storageMap.has(key) ? { [key]: storageMap.get(key) } : {},
    );
    (chrome.storage.local.set as jest.Mock).mockImplementation(async (entries: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(entries)) {
        storageMap.set(k, v);
      }
    });
    (chrome.storage.local.remove as jest.Mock).mockImplementation(async (key: string) => {
      storageMap.delete(key);
    });
    configureAutofillDetailEngine({ localVaultService: null, productInference: null });
    await clearRememberedFormBindings();
  });

  describe("stabilizeFieldIdentifier", () => {
    it("strips ephemeral React, Radix, HeadlessUI, MUI, UUID, and numeric IDs while keeping semantic identifiers", () => {
      expect(stabilizeFieldIdentifier(":r0:")).toBe("");
      expect(stabilizeFieldIdentifier("_r_1f_")).toBe("");
      expect(stabilizeFieldIdentifier("«r12»")).toBe("");
      expect(stabilizeFieldIdentifier("radix-:r4:")).toBe("");
      expect(stabilizeFieldIdentifier("headlessui-combobox-input-12")).toBe("");
      expect(stabilizeFieldIdentifier("mui-42")).toBe("");
      expect(stabilizeFieldIdentifier("550e8400-e29b-41d4-a716-446655440000")).toBe("");
      expect(stabilizeFieldIdentifier("987654")).toBe("");

      expect(stabilizeFieldIdentifier("applicant_phone")).toBe("applicant_phone");
      expect(stabilizeFieldIdentifier("work_employer_phone")).toBe("work_employer_phone");
      expect(stabilizeFieldIdentifier("昼間連絡先電話番号")).toBe("昼間連絡先電話番号");
    });
  });

  describe("suggestedDetailTypes", () => {
    it("classifies 1-field wizard steps with explicit_fill while excluding search and chat inputs", async () => {
      const types = await suggestedDetailTypes([
        Object.assign(new AutofillField(), {
          opid: "step-passport",
          htmlName: "passport_no",
          "label-tag": "Passport number",
          type: "text",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "site-search",
          htmlName: "q",
          placeholder: "Search passport FAQs",
          type: "search",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "header-search",
          htmlName: "search",
          placeholder: "Search site",
          type: "text",
          tagName: "input",
        }),
      ]);

      expect(sdk.fill_form_with_profile).toHaveBeenCalledWith(
        expect.objectContaining({ explicit_fill: true }),
      );
      expect(types).toEqual(["id.passport.number", "", ""]);
    });
  });

  describe("sealed FormBindingV1 learning across reloads and ephemeral React IDs", () => {
    it("seals FormBindingV1 via LocalVaultService and replays the chosen detail when React regenerates htmlID", async () => {
      const localVaultService = mock<LocalVaultService>();
      localVaultService.seal.mockImplementation(async (plaintext: string) =>
        Buffer.from(plaintext, "utf8").toString("base64"),
      );
      localVaultService.open.mockImplementation(async (sealed: string) =>
        Buffer.from(sealed, "base64").toString("utf8"),
      );
      configureAutofillDetailEngine({ localVaultService, productInference: null });

      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: Object.assign(new IdentityView(), { phone: "080-1111-2222" }),
        fields: [
          Object.assign(new FieldView(), {
            name: "vk.work.employer.phone",
            value: "03-9999-0000",
            type: FieldType.Text,
          }),
        ],
      });

      const pageUrl = "https://portal.example.org/onboarding/step-2";
      const initialFields = [
        Object.assign(new AutofillField(), {
          opid: "op-1",
          htmlID: ":r0:",
          "label-tag": "Daytime phone",
          type: "tel",
          tagName: "input",
          viewable: true,
        }),
        Object.assign(new AutofillField(), {
          opid: "op-2",
          htmlID: ":r1:",
          "label-tag": "Emergency contact phone",
          type: "tel",
          tagName: "input",
          viewable: true,
        }),
      ];

      await rememberFieldDetailBinding(
        pageUrl,
        initialFields[0],
        cipher,
        "work.employer.phone",
        initialFields,
      );

      const rawStored = JSON.stringify(storageMap.get("vowkeyFormBindings"));
      expect(localVaultService.seal).toHaveBeenCalled();
      expect(rawStored).toContain('"v":1');
      expect(rawStored).not.toContain("work.employer.phone");

      // Simulate page reload with regenerated React IDs
      const reloadedFields = [
        Object.assign(new AutofillField(), {
          opid: "op-10",
          htmlID: "_r_9a_",
          "label-tag": "Daytime phone",
          type: "tel",
          tagName: "input",
          viewable: true,
        }),
        Object.assign(new AutofillField(), {
          opid: "op-11",
          htmlID: "_r_9b_",
          "label-tag": "Emergency contact phone",
          type: "tel",
          tagName: "input",
          viewable: true,
        }),
      ];

      expect(
        await rememberedFieldDetailKey(pageUrl, reloadedFields[0], reloadedFields),
      ).toBe("work.employer.phone");
      expect(
        await rememberedFieldDetailKey(pageUrl, reloadedFields[1], reloadedFields),
      ).toBeNull();

      const matches = await detailsForFields(reloadedFields, cipher, pageUrl);
      expect(matches.map((m) => m.value)).toEqual(["03-9999-0000", "080-1111-2222"]);
    });
  });

  describe("ProductInference fallback and vk.meta-only profiles", () => {
    it("falls back cleanly to local WASM matching when ProductInference rejects", async () => {
      const productInference = mock<ProductInference>();
      productInference.getPrivacyMode.mockReturnValue("masked");
      productInference.describe.mockRejectedValue(new Error("offline"));
      productInference.decide.mockRejectedValue(new Error("offline"));
      configureAutofillDetailEngine({ localVaultService: null, productInference });

      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: Object.assign(new IdentityView(), { phone: "090-5555-6666" }),
      });
      const field = Object.assign(new AutofillField(), {
        opid: "phone",
        "label-tag": "Phone number",
        type: "tel",
        tagName: "input",
      });

      const matches = await detailsForFields([field], cipher, "https://apply.example.org");
      expect(matches[0]?.value).toBe("090-5555-6666");
    });

    it("lists and fills details stored solely in a vk.meta envelope when cipher.identity is null", async () => {
      const cipher = Object.assign(new CipherView(), {
        id: "profile-env-1",
        type: CipherType.Identity,
        name: "Scanned Passport",
        identity: null as unknown as IdentityView,
        fields: [],
      });
      writeEnvelope(cipher, {
        v: 1,
        profileId: "prof-1",
        kind: "person",
        relationship: null,
        status: "confirmed",
        sources: [],
        details: [
          {
            id: "d-phone",
            attribute: "work.employer.phone",
            label: "Employer phone",
            valueType: "phone",
            chosenVariantId: "v1",
            agentRule: "fill",
            variants: [
              {
                id: "v1",
                script: null,
                tag: null,
                value: "03-1234-5678",
                current: true,
                sourceId: null,
                locator: null,
                verified: true,
                origin: "ocr",
              },
            ],
            history: [],
            conflicts: [],
          },
        ],
      });

      const options = await profileDetailsForCipher(cipher);
      expect(options).toEqual([
        { key: "work.employer.phone", label: "Employer phone", value: "03-1234-5678" },
      ]);

      const field = Object.assign(new AutofillField(), {
        opid: "custom-ref",
        "label-tag": "Reference",
        type: "text",
        tagName: "input",
      });
      const matches = await detailsForFields([field], cipher, "https://apply.example.org", {
        opid: "custom-ref",
        key: "work.employer.phone",
      });
      expect(matches[0]?.value).toBe("03-1234-5678");
    });
  });
});
