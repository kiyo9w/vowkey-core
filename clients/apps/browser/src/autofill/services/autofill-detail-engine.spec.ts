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
  profileFieldAlternatesForCipher,
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
      details.set(k, v);
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
    }) => {
      const idCounts = new Map<string, number>();
      for (const f of fields) {
        const trimmed = (f.id ?? "").trim();
        if (trimmed) {
          idCounts.set(trimmed, (idCounts.get(trimmed) ?? 0) + 1);
        }
      }
      return {
        matches: fields.map((f, index) => {
          const trimmedId = (f.id ?? "").trim();
          const choiceId =
            trimmedId && idCounts.get(trimmedId) === 1 ? trimmedId : `__vk_f_${index}`;
          const chosen = choices?.find(
            (c) => c.id === choiceId || (trimmedId !== "" && c.id === trimmedId),
          );
          if (chosen) {
            if (!chosen.attribute) {
              return {
                attribute: "",
                chrome_type: "UNKNOWN_TYPE",
                owner: chosen.owner || "applicant",
                score: 0,
                value: null as string | null,
              };
            }
            const personAttr = [
              "name.",
              "birth.",
              "person.",
              "id.",
              "visa.",
              "address.",
              "contact.",
            ].some((prefix) => chosen.attribute.startsWith(prefix));
            const effectiveOwner = personAttr ? chosen.owner || "applicant" : "applicant";
            const val =
              effectiveOwner === "applicant"
                ? (profile.custom.get(chosen.attribute) ??
                  (chosen.attribute === "contact.phone"
                    ? profile.identity.phone
                    : chosen.attribute === "id.passport.number"
                      ? profile.identity.passport_number
                      : null))
                : null;
            return {
              attribute: chosen.attribute,
              chrome_type: "UNKNOWN_TYPE",
              owner: effectiveOwner,
              score: 8,
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
      };
    },
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

    it("passes input_type 'textarea' for textarea elements even when field.type is unset", async () => {
      const { fill_fields_from_profile } = jest.requireMock("@vowkey/sdk-internal") as {
        fill_fields_from_profile: jest.Mock;
      };
      fill_fields_from_profile.mockClear();

      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: new IdentityView(),
      });
      const textarea = Object.assign(new AutofillField(), {
        opid: "essay",
        htmlID: "motivation_note",
        htmlName: "motivation_essay",
        "label-tag": "志望動機・自由記入欄",
        placeholder: "自由記述欄には個人番号や無関係な値を埋めません",
        tagName: "textarea",
      });

      await detailsForFields([textarea], cipher, "https://apply.example.org");
      expect(fill_fields_from_profile).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: [expect.objectContaining({ input_type: "textarea" })],
        }),
      );
    });

    it("merges FormAsksV1 canonical attribute and owner with Decision choices while blocking spouse and official_only leaks", async () => {
      const productInference = mock<ProductInference>();
      productInference.getPrivacyMode.mockReturnValue("masked");
      productInference.describe.mockResolvedValue({
        v: 1,
        targetId: "t-1",
        formSignature: "sig-1",
        sections: [],
        fields: [
          {
            id: "f_0",
            sectionId: "s-app",
            what: "Applicant daytime telephone number",
            whose: "The person applying for the account",
            attribute: "contact.phone",
            owner: "self",
            format: { label: "digits-hyphen", options: [] },
          },
          {
            id: "f_1",
            sectionId: "s-opaque",
            what: "Passport number",
            whose: "Applicant",
            attribute: "id.passport.number",
            owner: "",
            format: { label: "", options: [] },
          },
          {
            id: "f_2",
            sectionId: "s-spouse",
            what: "Spouse telephone number",
            whose: "Spouse of the applicant",
            attribute: "contact.phone",
            owner: "spouse",
            format: { label: "", options: [] },
          },
          {
            id: "f_3",
            sectionId: "s-office",
            what: "Clerk receipt number",
            whose: "Receiving municipal clerk",
            attribute: "id.passport.number",
            owner: "official_only",
            format: { label: "", options: [] },
          },
        ],
      });
      productInference.decide.mockResolvedValue({ choices: [] });
      (sdk.decision_form_requests as jest.Mock)
        .mockReturnValueOnce(JSON.stringify([{ kind: "round" }]))
        .mockReturnValueOnce("[]");
      (sdk.decision_form_choices as jest.Mock).mockReturnValueOnce([
        { id: "applicant_tel", attribute: "contact.phone", owner: "applicant" },
        { id: "__vk_f_1", attribute: "id.passport.number", owner: "applicant" },
        { id: "spouse_tel", attribute: "contact.phone", owner: "applicant" },
        { id: "clerk_receipt", attribute: "id.passport.number", owner: "applicant" },
      ]);
      configureAutofillDetailEngine({ localVaultService: null, productInference });

      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: Object.assign(new IdentityView(), {
          phone: "090-1234-5678",
          passportNumber: "TR9876543",
        }),
        fields: [
          Object.assign(new FieldView(), {
            name: "vk.id.passport.number",
            value: "TR9876543",
            type: FieldType.Text,
          }),
        ],
      });

      const fields = [
        Object.assign(new AutofillField(), {
          opid: "op-app-tel",
          htmlID: "applicant_tel",
          "label-tag": "昼間連絡先電話番号",
          type: "tel",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-opaque",
          htmlID: ":r1:",
          "label-tag": "Text12",
          type: "text",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-spouse-tel",
          htmlID: "spouse_tel",
          "label-tag": "電話番号",
          type: "tel",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-clerk",
          htmlID: "clerk_receipt",
          "label-tag": "受付番号",
          type: "text",
          tagName: "input",
        }),
      ];

      const matches = await detailsForFields(fields, cipher, "https://city.example.jp/apply");

      const beginPayload = JSON.parse(
        (sdk.decision_form_begin as jest.Mock).mock.calls[0][0] as string,
      ) as { fields: unknown[]; held: string[] };
      expect(beginPayload.fields).toEqual([
        expect.objectContaining({
          id: "applicant_tel",
          label: "昼間連絡先電話番号",
          format: "digits-hyphen",
          section: "",
        }),
        expect.objectContaining({
          id: "",
          label: "Text12 Passport number",
          section: "",
        }),
        expect.objectContaining({
          id: "spouse_tel",
          label: "電話番号",
          section: "spouse",
        }),
        expect.objectContaining({
          id: "clerk_receipt",
          label: "受付番号",
          section: "official_only",
        }),
      ]);
      expect(beginPayload.held).toEqual(
        expect.arrayContaining(["contact.phone", "id.passport.number"]),
      );

      expect(sdk.fill_fields_from_profile).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: [
            { id: "applicant_tel", attribute: "contact.phone", owner: "applicant" },
            { id: "__vk_f_1", attribute: "id.passport.number", owner: "applicant" },
            { id: "spouse_tel", attribute: "contact.phone", owner: "spouse" },
            { id: "clerk_receipt", attribute: "", owner: "official_only" },
          ],
        }),
      );
      expect(matches.map((m) => m.value)).toEqual(["090-1234-5678", "TR9876543", null, null]);
    });

    it("falls back to FormAsksV1 canonical attribute and owner when decide() rejects with 503", async () => {
      const productInference = mock<ProductInference>();
      productInference.getPrivacyMode.mockReturnValue("masked");
      productInference.describe.mockResolvedValue({
        v: 1,
        targetId: "t-503",
        formSignature: "sig-503",
        sections: [],
        fields: [
          {
            id: "f_0",
            sectionId: "s-app",
            what: "Mobile phone",
            whose: "Applicant",
            attribute: "contact.phone",
            owner: "applicant",
            format: { label: "", options: [] },
          },
          {
            id: "f_1",
            sectionId: "s-ephemeral",
            what: "Employer phone",
            whose: "Applicant employer",
            attribute: "work.employer.phone",
            owner: "employer",
            format: { label: "", options: [] },
          },
          {
            id: "f_2",
            sectionId: "s-spouse",
            what: "Spouse phone",
            whose: "Spouse",
            attribute: "contact.phone",
            owner: "spouse",
            format: { label: "", options: [] },
          },
          {
            id: "f_3",
            sectionId: "s-office",
            what: "For official use",
            whose: "Official",
            attribute: "contact.phone",
            owner: "official_only",
            format: { label: "", options: [] },
          },
          {
            id: "f_4",
            sectionId: "s-free",
            what: "Reason for application",
            whose: "Applicant",
            attribute: "none",
            owner: "applicant",
            format: { label: "", options: [] },
          },
        ],
      });
      productInference.decide.mockRejectedValue(new Error("503 Service Unavailable"));
      (sdk.decision_form_requests as jest.Mock).mockReturnValue(JSON.stringify([{ kind: "round" }]));
      configureAutofillDetailEngine({ localVaultService: null, productInference });

      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: Object.assign(new IdentityView(), { phone: "080-7777-8888" }),
        fields: [
          Object.assign(new FieldView(), {
            name: "vk.work.employer.phone",
            value: "03-5555-1212",
            type: FieldType.Text,
          }),
        ],
      });

      const fields = [
        Object.assign(new AutofillField(), {
          opid: "op-503-0",
          htmlID: "mobile_tel",
          "label-tag": "携帯電話番号",
          type: "tel",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-503-1",
          htmlID: ":r9:",
          "label-tag": "",
          type: "tel",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-503-2",
          htmlID: "spouse_phone",
          "label-tag": "配偶者電話番号",
          type: "tel",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-503-3",
          htmlID: "office_stamp",
          "label-tag": "事務処理欄（電話確認）",
          type: "text",
          tagName: "input",
        }),
        Object.assign(new AutofillField(), {
          opid: "op-503-4",
          htmlID: "application_reason",
          "label-tag": "申請理由（電話連絡希望時間帯など）",
          type: "text",
          tagName: "input",
        }),
      ];

      const matches = await detailsForFields(fields, cipher, "https://bank.example.jp/open-503");

      expect(sdk.fill_fields_from_profile).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: [
            { id: "mobile_tel", attribute: "contact.phone", owner: "applicant" },
            { id: "__vk_f_1", attribute: "work.employer.phone", owner: "employer" },
            { id: "spouse_phone", attribute: "contact.phone", owner: "spouse" },
            { id: "office_stamp", attribute: "", owner: "official_only" },
            { id: "application_reason", attribute: "", owner: "applicant" },
          ],
        }),
      );
      expect(matches.map((m) => m.value)).toEqual([
        "080-7777-8888",
        "03-5555-1212",
        null,
        null,
        null,
      ]);
    });

    it("normalizes unset maxLength sentinel 999 to 0 while keeping bounded maxLength", async () => {
      configureAutofillDetailEngine({ localVaultService: null, productInference: null });
      const cipher = Object.assign(new CipherView(), {
        type: CipherType.Identity,
        identity: Object.assign(new IdentityView(), { phone: "080-7777-8888" }),
      });
      const fields = [
        Object.assign(new AutofillField(), {
          opid: "op-email-1",
          htmlID: "correoElectronico",
          "label-tag": "Email",
          type: "email",
          tagName: "input",
          maxLength: 999,
        }),
        Object.assign(new AutofillField(), {
          opid: "op-zip-1",
          htmlID: "postalBox",
          "label-tag": "郵便番号",
          type: "text",
          tagName: "input",
          maxLength: 3,
        }),
      ];

      await detailsForFields(fields, cipher, "https://form.example/arrive");

      expect(sdk.fill_fields_from_profile).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: [
            expect.objectContaining({ id: "correoElectronico", max_length: 0 }),
            expect.objectContaining({ id: "postalBox", max_length: 3 }),
          ],
        }),
      );
    });

    it("excludes Don't fill (agentRule: never) details and resolves multi-source/history alternates", async () => {
      configureAutofillDetailEngine({ localVaultService: null, productInference: null });
      const cipher = Object.assign(new CipherView(), {
        id: "profile-perm-1",
        type: CipherType.Identity,
        name: "Trần Minh Khoa",
        identity: Object.assign(new IdentityView(), {
          phone: "080-4417-2290",
          passportNumber: "C9900417",
        }),
        fields: [],
      });
      writeEnvelope(cipher, {
        v: 1,
        profileId: "prof-perm-1",
        kind: "person",
        relationship: "self",
        status: "confirmed",
        sources: [
          {
            id: "src-rc",
            attachmentId: null,
            fileName: "rc.jpg",
            mediaType: "image/jpeg",
            kind: "Residence card",
            documentDate: "2025-04-25",
            effectiveOn: "2025-04-25",
            capturedAt: "2026-11-05T00:00:00Z",
            expiresOn: null,
            status: "current",
          },
          {
            id: "src-pass",
            attachmentId: null,
            fileName: "passport.jpg",
            mediaType: "image/jpeg",
            kind: "Passport",
            documentDate: "2023-03-14",
            effectiveOn: "2023-03-14",
            capturedAt: "2026-11-05T00:00:00Z",
            expiresOn: null,
            status: "current",
          },
        ],
        details: [
          {
            id: "det-passport",
            attribute: "id.passport.number",
            label: "Passport number",
            valueType: "text",
            chosenVariantId: "v-pass-blocked",
            agentRule: "never",
            variants: [
              {
                id: "v-pass-blocked",
                script: null,
                tag: null,
                value: "C9900417",
                current: true,
                sourceId: "src-pass",
                locator: null,
                verified: true,
                origin: "mrz",
              },
            ],
            history: [],
            conflicts: [],
          },
          {
            id: "det-phone",
            attribute: "contact.phone",
            label: "Phone",
            valueType: "phone",
            chosenVariantId: "v-phone-primary",
            agentRule: "fill",
            variants: [
              {
                id: "v-phone-primary",
                script: null,
                tag: null,
                value: "080-4417-2290",
                current: true,
                sourceId: "src-rc",
                locator: null,
                verified: false,
                origin: "typed",
              },
              {
                id: "v-phone-alt",
                script: null,
                tag: null,
                value: "090-1111-2222",
                current: true,
                sourceId: "src-pass",
                locator: null,
                verified: false,
                origin: "ocr",
              },
            ],
            history: [
              {
                reason: "superseded",
                retiredAt: "2024-01-01T00:00:00Z",
                variant: {
                  id: "v-phone-hist",
                  script: null,
                  tag: null,
                  value: "070-3333-4444",
                  current: false,
                  sourceId: "src-rc",
                  locator: null,
                  verified: false,
                  origin: "ocr",
                },
              },
            ],
            conflicts: [],
          },
        ],
      });

      const pickerOptions = await profileDetailsForCipher(cipher);
      expect(pickerOptions.map((o) => o.key)).not.toContain("id.passport.number");

      const phoneField = Object.assign(new AutofillField(), {
        opid: "op-phone",
        htmlID: "phone",
        "label-tag": "Phone number",
        type: "tel",
        tagName: "input",
      });
      const passportField = Object.assign(new AutofillField(), {
        opid: "op-pass",
        htmlID: "passport_no",
        "label-tag": "Passport number",
        type: "text",
        tagName: "input",
      });

      const initialMatches = await detailsForFields([phoneField, passportField], cipher);
      expect(initialMatches[0]?.value).toBe("080-4417-2290");
      expect(initialMatches[1]?.value).toBeNull();

      const alternates = await profileFieldAlternatesForCipher(
        cipher,
        [phoneField, passportField],
        "op-phone",
        "080-4417-2290",
      );
      expect(alternates).toEqual([
        { key: "variant:contact.phone:v-phone-alt", label: "Passport", value: "090-1111-2222" },
        { key: "history:contact.phone:0", label: "Previous", value: "070-3333-4444" },
      ]);

      const overridden = await detailsForFields(
        [phoneField],
        cipher,
        "https://form.example/phone",
        { opid: "op-phone", key: alternates[1].key },
        [phoneField],
      );
      expect(overridden[0]?.value).toBe("070-3333-4444");
    });
  });
});
