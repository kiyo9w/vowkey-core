import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import * as JSZip from "jszip";
import { of } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AgentTarget, FormAsksV1, validateFormAsks } from "@vowkey/common/vault/agent/targets";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import {
  PrivacyMode,
  ProductInference,
  ReadingServiceUnavailableError,
} from "@vowkey/common/vault/local/product-inference";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { CipherType, FieldType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FieldView } from "@vowkey/common/vault/models/view/field.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import * as sdk from "@vowkey/sdk-internal";

import {
  DocumentCaptureService,
  documentProfileActionsFactory,
  isSamePerson,
  resolveSelectOption,
  unclearReading,
} from "./document-capture.service";

const actualSdk = jest.requireActual("@vowkey/sdk-internal") as typeof sdk;

jest.mock("@vowkey/sdk-internal", () => ({
  ...jest.requireActual("@vowkey/sdk-internal"),
  capture_document_text: jest.fn(),
  decision_begin: jest.fn(),
  decision_finish: jest.fn(),
  decision_requests: jest.fn(),
  decision_take_first_answers: jest.fn(),
  decode_document_barcode: jest.fn(),
  detail_label: (key: string) => `label:${key}`,
  profile_stored_details: jest.fn(),
  profile_details: jest.fn(),
  update_profile: jest.fn(),
}));

const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("isSamePerson", () => {
  it("is one person when a document number or a name is shared", () => {
    expect(
      isSamePerson(
        map({ "id.passport.number": "C9481023" }),
        map({ "id.passport.number": "c9481023", "birth.date": "1998-03-14" }),
      ),
    ).toBe(true);
    expect(isSamePerson(map({ "name.full": "阮 氏玲" }), map({ "name.full": "阮 氏玲" }))).toBe(
      true,
    );
  });

  it("is one person when a bank passbook names the holder as the profile is named", () => {
    expect(
      isSamePerson(
        map({ "name.full": "阮 氏玲", "name.full.kana": "グエン ティ リン" }),
        map({ "bank.account.holder.kanji": "阮 氏玲", "bank.account.number": "4821903" }),
      ),
    ).toBe(true);
  });

  it("is one person when the family name matches and a given name is shared", () => {
    expect(
      isSamePerson(
        map({ "name.family": "Nguyen", "name.given": "Linh" }),
        map({ "name.family.latin": "NGUYEN", "name.given.latin": "THI LINH" }),
      ),
    ).toBe(true);
  });

  it("matches diacritic-folded full names across word order and shared IDs, emails, or phone digits", () => {
    expect(
      isSamePerson(
        map({ "name.full": "Nguyễn Văn An" }),
        map({ "name.full.latin": "AN VAN NGUYEN" }),
      ),
    ).toBe(true);
    expect(
      isSamePerson(
        map({ "id.national.number": "079 098 001234" }),
        map({ "id.national.number": "079098001234" }),
      ),
    ).toBe(true);
    expect(
      isSamePerson(
        map({ "contact.phone": "+84 (912) 345-678" }),
        map({ "contact.phone.mobile": "84912345678" }),
      ),
    ).toBe(true);
  });

  it("is two people when nothing says otherwise", () => {
    expect(
      isSamePerson(
        map({ "name.family": "Nguyen", "name.given": "Linh" }),
        map({ "name.family.latin": "NGUYEN", "name.given.latin": "VAN MINH" }),
      ),
    ).toBe(false);
    expect(isSamePerson(map({}), map({ "id.passport.number": "C9481023" }))).toBe(false);
  });
});

describe("DocumentCaptureService.add to a guest vault", () => {
  let service: DocumentCaptureService;
  let cipherService: MockProxy<CipherService>;
  let localVault: MockProxy<LocalVaultService>;
  const file = { name: "passport.png" } as File;
  const bytes = new Uint8Array([1, 2, 3]);

  const captured = (details: Record<string, string>, kinds: Record<string, string> = {}) => ({
    details: map(details),
    sources: new Map(
      Object.keys(details).map((key) => [
        key,
        { kind: kinds[key] ?? "mrz", verified: (kinds[key] ?? "mrz") === "mrz" },
      ]),
    ),
  });

  function identity(id: string, name: string): CipherView {
    const view = new CipherView();
    view.id = id;
    view.name = name;
    view.type = CipherType.Identity;
    view.edit = true;
    view.identity = new IdentityView();
    return view;
  }

  beforeEach(() => {
    cipherService = mock<CipherService>();
    localVault = mock<LocalVaultService>();
    localVault.list.mockResolvedValue([]);
    localVault.save.mockImplementation(async (view) => view);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({ details: map({}) }));

    TestBed.configureTestingModule({
      providers: [
        DocumentCaptureService,
        { provide: ApiService, useValue: mock<ApiService>() },
        { provide: ProductInference, useValue: mock<ProductInference>() },
        { provide: LocalVaultService, useValue: localVault },
        { provide: CipherService, useValue: cipherService },
        { provide: CipherSdkService, useValue: mock<CipherSdkService>() },
        {
          provide: AccountService,
          useValue: { activeAccount$: of(null) },
        },
      ],
    });
    service = TestBed.inject(DocumentCaptureService);
  });

  it("starts a profile named for the person when the vault has no one like them", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured(
        {
          "name.given.latin": "THI LINH",
          "name.family.latin": "NGUYEN",
          "id.passport.number": "C9481023",
          "birth.year": "1998",
        },
        { "birth.year": "derived" },
      ),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.created).toBe(true);
    expect(result?.profile.name).toBe("THI LINH NGUYEN");
    expect(result?.profile.type).toBe(CipherType.Identity);
    expect(localVault.save).toHaveBeenCalledTimes(1);
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
    expect(result?.added.map((d) => d.key)).toEqual([
      "name.given.latin",
      "name.family.latin",
      "id.passport.number",
    ]);
    expect(result?.added[2]).toEqual({
      key: "id.passport.number",
      label: "label:id.passport.number",
      value: "C9481023",
      verified: true,
    });
    expect(localVault.save).toHaveBeenCalledWith(expect.anything(), [
      { id: expect.any(String), fileName: "passport.png", bytes },
    ]);
    expect(result?.attached).toBe(true);
  });

  it("adds to the profile of the same person and shows only what is new", async () => {
    const linh = identity("b4aef1fa-ae61-49f9-b72b-086e118660e7", "Linh Nguyen");
    localVault.list.mockResolvedValue([linh]);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({
      details: map({ "id.passport.number": "C9481023", "contact.email": "linh@example.com" }),
    }));
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023", "id.passport.expiry": "2032-04-10" }),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.created).toBe(false);
    expect(result?.added.map((d) => d.key)).toEqual(["id.passport.expiry"]);
    expect(localVault.save).toHaveBeenCalledTimes(1);
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("records a second document even when the profile already has every value", async () => {
    localVault.list.mockResolvedValue([
      identity("b4aef1fa-ae61-49f9-b72b-086e118660e7", "Linh Nguyen"),
    ]);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({
      details: map({ "id.passport.number": "C9481023" }),
    }));
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.added).toEqual([]);
    expect(localVault.save).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ bytes }),
    ]);
    expect(result?.attached).toBe(true);
  });

  it("returns nothing when the document says nothing", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(captured({}));

    expect(await service.add("a letter", file, bytes)).toBeNull();
    expect(localVault.save).not.toHaveBeenCalled();
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("attaches a zero-detail document directly when uploaded into a specific profile", async () => {
    const linh = identity("b4aef1fa-ae61-49f9-b72b-086e118660e7", "Linh Nguyen");
    localVault.list.mockResolvedValue([linh]);
    (sdk.capture_document_text as jest.Mock).mockReturnValue(captured({}));

    const result = await service.capture(
      { details: map({}), sources: new Map() },
      { name: "utility-bill-scan.jpg", type: "image/jpeg" } as File,
      bytes,
      { profileId: linh.id },
    );

    expect(result).not.toBeNull();
    expect(result?.created).toBe(false);
    expect(result?.profile.id).toBe(linh.id);
    expect(result?.attached).toBe(true);
    expect(localVault.save).toHaveBeenCalledTimes(1);
  });

  it("detects duplicate uploads by SHA-256 without creating duplicate profiles or attachments", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023", "name.full": "Linh Nguyen" }),
    );
    let stored: CipherView[] = [];
    localVault.list.mockImplementation(async () => stored);
    localVault.save.mockImplementation(async (view) => {
      stored = [view];
      return view;
    });

    const first = await service.add("text", file, bytes);
    expect(first?.created).toBe(true);
    expect(first?.duplicate).toBeUndefined();
    expect(localVault.save).toHaveBeenCalledTimes(1);

    const second = await service.add("text", { name: "passport-copy.png" } as File, bytes);
    expect(second?.created).toBe(false);
    expect(second?.duplicate).toBe(true);
    expect(second?.sourceId).toBe(first?.sourceId);
    expect(second?.added).toEqual([]);
    expect(localVault.save).toHaveBeenCalledTimes(1);
  });

  it("reports a failed local transaction instead of claiming the document was saved", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );
    localVault.save.mockRejectedValue(new Error("disk full"));
    await expect(service.add("text", file, bytes)).rejects.toThrow("disk full");
  });

  it("names a new profile from given and family names when the document has no .latin keys", async () => {
    const photoFile = { name: "midv500_handheld_50.jpg" } as File;
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured(
        {
          "name.given": "Monika",
          "name.family": "Sojli",
          "id.national_id": "I05101999Q",
        },
        {
          "name.given": "decision",
          "name.family": "decision",
          "id.national_id": "decision",
        },
      ),
    );

    const result = await service.add("text", photoFile, bytes);

    expect(result?.created).toBe(true);
    expect(result?.profile.name).toBe("Monika Sojli");
  });
});

describe("DocumentCaptureService.read", () => {
  let service: DocumentCaptureService;
  let privacyMode: PrivacyMode;
  const file = { name: "residence-card.jpg" } as File;
  const bytes = new Uint8Array([1, 2, 3]);
  const read = { details: new Map([["name.full", "A"]]), sources: new Map() };
  const capture = {
    readPieces: jest.fn(),
    readDocument: jest.fn(),
    decisionSettings: jest.fn(),
    askDecision: jest.fn(),
  };
  const inference = {
    decide: jest.fn(),
    getPrivacyMode: jest.fn(() => privacyMode),
    readDocumentVision: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    privacyMode = "masked";
    inference.getPrivacyMode.mockImplementation(() => privacyMode);
    (globalThis as any).ipc = { capture };
    capture.readPieces.mockResolvedValue('{"pages":[]}');
    capture.decisionSettings.mockResolvedValue(null);
    inference.decide.mockImplementation(async (request) => ({ answers: {}, request }));
    (sdk.decision_begin as jest.Mock).mockReturnValue("plan-1");
    (sdk.decision_take_first_answers as jest.Mock).mockReturnValue("plan-2");
    (sdk.decision_requests as jest.Mock).mockImplementation((_plan: string, second: boolean) =>
      JSON.stringify([{ round: second ? 2 : 1 }]),
    );
    (sdk.decision_finish as jest.Mock).mockReturnValue(read);
    (sdk.decode_document_barcode as jest.Mock).mockImplementation(() => {
      throw new Error("no barcode");
    });
    TestBed.configureTestingModule({
      providers: [
        DocumentCaptureService,
        { provide: ApiService, useValue: mock<ApiService>() },
        { provide: ProductInference, useValue: inference },
        { provide: CipherService, useValue: mock<CipherService>() },
        { provide: CipherSdkService, useValue: mock<CipherSdkService>() },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" }) } },
      ],
    });
    service = TestBed.inject(DocumentCaptureService);
  });

  it("asks Decision through the key on this computer when there is one, and not through the relay", async () => {
    capture.decisionSettings.mockResolvedValue({ perRequest: 0 });
    capture.askDecision.mockResolvedValue({ answers: {} });

    await service.read(file, bytes);

    expect(capture.askDecision).toHaveBeenCalled();
    expect(inference.decide).not.toHaveBeenCalled();
  });

  it("asks Decision about the pieces of the document in two rounds and takes what it placed", async () => {
    const result = await service.read(file, bytes);

    expect(result).toEqual({ captured: read, unclear: null });
    expect(capture.readPieces).toHaveBeenCalledWith(bytes, "residence-card.jpg");
    expect(inference.decide).toHaveBeenCalledWith({ round: 1 });
    expect(inference.decide).toHaveBeenCalledWith({ round: 2 });
    expect(sdk.decision_begin).toHaveBeenCalledWith('{"pages":[]}', 0);
    expect(sdk.decision_take_first_answers).toHaveBeenCalledWith("plan-1", expect.any(String));
    expect(sdk.decision_finish).toHaveBeenCalledWith(
      "plan-2",
      expect.any(String),
      "",
      expect.any(Number),
    );
    expect(sdk.capture_document_text).not.toHaveBeenCalled();
  });

  it("says when a photo's print was too small to read", async () => {
    capture.readPieces.mockResolvedValue(
      JSON.stringify({ pages: [{ pieces: [], unsure: 0.83, lineHeight: 6 }] }),
    );

    expect((await service.read(file, bytes)).unclear).toBe("small");
  });

  it("reports the reading service outage when the document has no standard machine-readable data", async () => {
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));
    capture.readDocument.mockResolvedValue("text of the card");
    (sdk.capture_document_text as jest.Mock).mockReturnValue({
      details: new Map(),
      sources: new Map(),
    });
    await expect(service.read(file, bytes)).rejects.toThrow("reading service is unavailable");
  });

  it("reads only the standard parts when Decision cannot be asked", async () => {
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));
    capture.readDocument.mockResolvedValue("text of the card");
    (sdk.capture_document_text as jest.Mock).mockReturnValue(read);

    expect((await service.read(file, bytes)).captured).toBe(read);
    expect(sdk.capture_document_text).toHaveBeenCalled();
  });

  it("stays strictly on-device in local privacy mode and extracts spatial label-value details", async () => {
    privacyMode = "local";
    (sdk.profile_details as jest.Mock).mockImplementation(actualSdk.profile_details);
    (sdk.capture_document_text as jest.Mock).mockImplementation(actualSdk.capture_document_text);
    capture.readDocument.mockResolvedValue("");
    capture.readPieces.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            index: 0,
            unsure: 0.04,
            lineHeight: 18,
            pieces: [
              { text: "Passport No:", x: 0.1, y: 0.3, w: 0.18, h: 0.03, confidence: 0.99 },
              { text: "C9481023", x: 0.32, y: 0.3, w: 0.14, h: 0.03, confidence: 0.99 },
            ],
          },
        ],
      }),
    );

    const result = await service.read(file, bytes);

    expect(inference.decide).not.toHaveBeenCalled();
    expect(capture.askDecision).not.toHaveBeenCalled();
    expect(inference.readDocumentVision).not.toHaveBeenCalled();
    expect(result.unclear).toBeNull();
    expect(result.captured.details.get("id.passport.number")).toBe("C9481023");
    expect(result.captured.sources.get("id.passport.number")?.locator).toEqual({
      kind: "page",
      page: 0,
      x: 0.32,
      y: 0.3,
      w: 0.14,
      h: 0.03,
    });
  });

  it("merges Cloud Vision details while keeping verified local MRZ values and deriving companions", async () => {
    privacyMode = "cloud_vision";
    (sdk.profile_details as jest.Mock).mockImplementation(actualSdk.profile_details);
    capture.readPieces.mockResolvedValue(
      JSON.stringify({ pages: [{ pieces: [{ text: "ID" }], unsure: 0.05, lineHeight: 20 }] }),
    );
    capture.readDocument.mockResolvedValue("MRZ");
    (sdk.capture_document_text as jest.Mock).mockReturnValue({
      details: new Map([
        ["id.passport.number", "C9481023"],
        ["birth.date", "1980-01-01"],
      ]),
      sources: new Map([
        ["id.passport.number", { kind: "mrz", verified: true }],
        ["birth.date", { kind: "mrz", verified: true }],
      ]),
    });
    inference.readDocumentVision.mockResolvedValue({
      details: {
        "id.passport.number": "C9481O23",
        "name.given": "Monika",
        "name.family": "Sojli",
        "birth.place": "Tirana",
      },
    });

    const result = await service.read(file, bytes);

    expect(inference.readDocumentVision).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/jpeg;base64,/),
      "residence-card.jpg",
    );
    expect(inference.decide).not.toHaveBeenCalled();
    expect(result.captured.details.get("id.passport.number")).toBe("C9481023");
    expect(result.captured.sources.get("id.passport.number")?.verified).toBe(true);
    expect(result.captured.details.get("birth.place")).toBe("Tirana");
    expect(result.captured.details.get("name.full")).toBe("Monika Sojli");
    expect(result.captured.details.get("birth.year")).toBe("1980");
  });

  it("grounds un-located MRZ/Vision details to printed pieces and narrows whole-line boxes to the value span", async () => {
    capture.readPieces.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            index: 0,
            unsure: 0.03,
            lineHeight: 20,
            pieces: [
              { text: "Passport No: C9481023", x: 0.1, y: 0.25, w: 0.42, h: 0.035, confidence: 0.99 },
              { text: "14/08/1980", x: 0.58, y: 0.42, w: 0.18, h: 0.032, confidence: 0.98 },
            ],
          },
        ],
      }),
    );
    (sdk.decision_finish as jest.Mock).mockReturnValue({
      details: new Map([
        ["id.passport.number", "C9481023"],
        ["birth.date", "1980-08-14"],
      ]),
      sources: new Map([
        [
          "id.passport.number",
          {
            kind: "decision",
            verified: false,
            locator: { kind: "page", page: 0, x: 0.1, y: 0.25, w: 0.42, h: 0.035 },
          },
        ],
        ["birth.date", { kind: "mrz", verified: true }],
      ]),
    });

    const result = await service.read(file, bytes);
    const passportLoc = result.captured.sources.get("id.passport.number")?.locator;
    const birthLoc = result.captured.sources.get("birth.date")?.locator;

    expect(passportLoc?.kind).toBe("page");
    if (passportLoc?.kind === "page") {
      expect(passportLoc.x).toBeGreaterThan(0.3);
      expect(passportLoc.w).toBeLessThan(0.2);
      expect(passportLoc.y).toBeCloseTo(0.25, 3);
    }
    expect(birthLoc).toEqual({
      kind: "page",
      page: 0,
      x: 0.58,
      y: 0.42,
      w: 0.18,
      h: 0.032,
    });
  });

  it("stops document replacement with a clear message when the photo is unreadable or too small", async () => {
    capture.readPieces.mockResolvedValue(
      JSON.stringify({ pages: [{ pieces: [], unsure: 1, diagnostic: "unreadable" }] }),
    );
    capture.readDocument.mockResolvedValue("");
    (sdk.capture_document_text as jest.Mock).mockReturnValue({
      details: new Map(),
      sources: new Map(),
    });
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));

    const actions = documentProfileActionsFactory(service);
    const blurryFile = {
      name: "blurry.jpg",
      arrayBuffer: async () => bytes.buffer,
    } as unknown as File;

    await expect(actions.replace("profile-1", "source-1", blurryFile)).rejects.toThrow(
      "Couldn't read this photo. Hold the document flat in good light and try again.",
    );
  });
});

describe("unclearReading", () => {
  it("finds a page whose print was mostly read unsure, and says whether its print was small", () => {
    expect(unclearReading('{"pages":[{"unsure":0.83,"lineHeight":6}]}')).toBe("small");
    expect(unclearReading('{"pages":[{"unsure":0.7,"lineHeight":18}]}')).toBe("unclear");
    expect(unclearReading('{"pages":[{"unsure":0.6}]}')).toBe("unclear");
  });

  it("flags explicit too_small and unreadable boundary diagnostics from the reader", () => {
    expect(
      unclearReading('{"pages":[{"unsure":0.12,"lineHeight":5.3,"diagnostic":"too_small"}]}'),
    ).toBe("small");
    expect(unclearReading('{"pages":[{"unsure":1,"diagnostic":"unreadable"}]}')).toBe("unclear");
  });

  it("finds nothing in a page that read clearly, or in a reading without the measure", () => {
    expect(unclearReading('{"pages":[{"unsure":0.12,"lineHeight":18}]}')).toBeNull();
    expect(unclearReading('{"pages":[{"pieces":[]}]}')).toBeNull();
    expect(unclearReading("not json")).toBeNull();
  });
});

describe("DocumentCaptureService form filling", () => {
  let service: DocumentCaptureService;
  let privacyMode: PrivacyMode;
  const capture = {
    readPdfForm: jest.fn(),
    fillPdfForm: jest.fn(),
    saveCopy: jest.fn(),
    decisionSettings: jest.fn(),
    askDecision: jest.fn(),
    pathForFile: jest.fn(),
  };
  const inference = {
    decide: jest.fn(),
    describe: jest.fn(),
    getPrivacyMode: jest.fn(() => privacyMode),
  };

  function profileWith(details: Record<string, string>): CipherView {
    const view = new CipherView();
    view.id = "profile-1";
    view.name = "Monika Sojli";
    view.type = CipherType.Identity;
    view.identity = new IdentityView();
    view.fields = Object.entries(details).map(([name, value]) => {
      const f = new FieldView();
      f.name = name;
      f.value = value;
      f.type = FieldType.Text;
      return f;
    });
    return view;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    privacyMode = "masked";
    inference.getPrivacyMode.mockImplementation(() => privacyMode);
    (sdk.profile_details as jest.Mock).mockImplementation(actualSdk.profile_details);
    (globalThis as any).ipc = { capture };
    capture.decisionSettings.mockResolvedValue(null);
    capture.pathForFile.mockReturnValue("/tmp/form.pdf");
    capture.fillPdfForm.mockImplementation(async ({ values }) => ({
      path: "/tmp/form (filled).pdf",
      filled: Object.keys(values).length,
    }));
    capture.saveCopy.mockResolvedValue("/tmp/form (filled).docx");

    TestBed.configureTestingModule({
      providers: [
        DocumentCaptureService,
        { provide: ApiService, useValue: mock<ApiService>() },
        { provide: ProductInference, useValue: inference },
        { provide: CipherService, useValue: mock<CipherService>() },
        { provide: CipherSdkService, useValue: mock<CipherSdkService>() },
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" }) } },
      ],
    });
    service = TestBed.inject(DocumentCaptureService);
  });

  it("fills PDF and paper forms locally when the reading service is offline and preserves structural comb keys", async () => {
    inference.describe.mockRejectedValue(new ReadingServiceUnavailableError(503));
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));
    capture.readPdfForm.mockResolvedValue([
      {
        key: "box:0:120:420:280:22:comb:12",
        name: "",
        tooltip: "",
        label: "National ID Number",
        type: "text",
        maxLength: 12,
        options: [],
      },
      {
        key: "box:0:120:460:220:22:slots:0.000,0.380;0.430,0.680;0.730,1.000",
        name: "",
        tooltip: "",
        label: "Date of Birth",
        type: "text",
        maxLength: 0,
        options: [],
      },
    ]);

    const profile = profileWith({
      "id.national.number": "012345678901",
      "birth.date": "1998-03-14",
    });

    const out = await service.fillPdfForm(
      { name: "paper-form.png" } as File,
      new Uint8Array([9, 9]),
      profile,
    );

    expect(out.filled).toBe(2);
    expect(capture.fillPdfForm).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          "box:0:120:420:280:22:comb:12": "012345678901",
          "box:0:120:460:220:22:slots:0.000,0.380;0.430,0.680;0.730,1.000": "1998-03-14",
        },
      }),
    );
  });

  it("describes unfamiliar form labels with zero PII and leaves non-applicant fields empty", async () => {
    capture.readPdfForm.mockResolvedValue([
      {
        key: "box:0:100:200:180:20",
        name: "",
        tooltip: "",
        label: "Commune d'origine déclarée",
        type: "text",
        maxLength: 0,
        options: [],
      },
      {
        key: "box:0:100:240:180:20",
        name: "",
        tooltip: "",
        label: "Patronyme de la personne conjointe",
        type: "text",
        maxLength: 0,
        options: [],
      },
    ]);
    inference.describe.mockImplementation(async (target: AgentTarget) => {
      const serialized = JSON.stringify(target);
      expect(serialized).not.toContain("Tirana");
      expect(serialized).not.toContain("Sojli");
      expect(serialized).not.toContain("SECRET999");
      const asks: FormAsksV1 = {
        v: 1,
        targetId: target.targetId,
        formSignature: target.formSignature,
        sections: target.sections.map((s) => ({ ...s, profileHint: null })),
        fields: [
          {
            id: "f_0",
            sectionId: "main",
            what: "birth.place",
            whose: "self",
            format: { label: "", options: [] },
          },
          {
            id: "f_1",
            sectionId: "main",
            what: "name.family",
            whose: "spouse",
            format: { label: "", options: [] },
          },
        ],
      };
      expect(validateFormAsks(asks, target)).toBe(true);
      return asks;
    });
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));

    const profile = profileWith({
      "birth.place": "Tirana",
      "name.family": "Sojli",
      "id.passport.number": "SECRET999",
    });

    const out = await service.fillPdfForm(
      { name: "demande.pdf" } as File,
      new Uint8Array([1, 2]),
      profile,
    );

    expect(inference.describe).toHaveBeenCalledTimes(1);
    expect(out.filled).toBe(1);
    expect(capture.fillPdfForm).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          "box:0:100:200:180:20": "Tirana",
        },
      }),
    );
  });

  it("fills unfamiliar Word table cells via zero-PII describe() in masked mode and skips network in local mode", async () => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
        `<w:tbl><w:tr>` +
        `<w:tc><w:p><w:r><w:t>Domicile habituel du déclarant</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p></w:p></w:tc>` +
        `</w:tr></w:tbl>` +
        `</w:body></w:document>`,
    );
    const docxBytes = await zip.generateAsync({ type: "uint8array" });
    const profile = profileWith({
      "address.full": "2-8-1 Nishishinjuku, Shinjuku-ku, Tokyo",
    });

    let savedBytes: Uint8Array | null = null;
    capture.saveCopy.mockImplementation(async ({ bytes }) => {
      savedBytes = bytes;
      return "/tmp/declaration (filled).docx";
    });
    inference.describe.mockImplementation(async (target: AgentTarget) => {
      expect(JSON.stringify(target)).not.toContain("Nishishinjuku");
      const asks: FormAsksV1 = {
        v: 1,
        targetId: target.targetId,
        formSignature: target.formSignature,
        sections: target.sections.map((s) => ({ ...s, profileHint: null })),
        fields: [
          {
            id: "f_0",
            sectionId: "main",
            what: "address.full",
            whose: "applicant",
            format: { label: "", options: [] },
          },
        ],
      };
      expect(validateFormAsks(asks, target)).toBe(true);
      return asks;
    });

    const filled = await service.fillForm(
      { name: "declaration.docx" } as File,
      docxBytes,
      profile,
    );
    expect(inference.describe).toHaveBeenCalledTimes(1);
    expect(filled).toEqual({ path: "/tmp/declaration (filled).docx", filled: 1 });
    const outZip = await new JSZip().loadAsync(savedBytes!);
    const outXml = await outZip.file("word/document.xml")!.async("string");
    expect(outXml).toContain("2-8-1 Nishishinjuku, Shinjuku-ku, Tokyo");

    inference.describe.mockClear();
    privacyMode = "local";
    const localOut = await service.fillForm(
      { name: "declaration.docx" } as File,
      docxBytes,
      profile,
    );
    expect(inference.describe).not.toHaveBeenCalled();
    expect(localOut).toEqual({ path: null, filled: 0 });
  });

  it("fills unfamiliar Excel sheet cells via zero-PII describe() in masked mode", async () => {
    const zip = new JSZip();
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<si><t>Commune d'origine déclarée</t></si>` +
        `</sst>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?>` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
        `<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"/></row>` +
        `</sheetData></worksheet>`,
    );
    const xlsxBytes = await zip.generateAsync({ type: "uint8array" });
    const profile = profileWith({ "birth.place": "Tirana" });

    let savedBytes: Uint8Array | null = null;
    capture.saveCopy.mockImplementation(async ({ bytes }) => {
      savedBytes = bytes;
      return "/tmp/onboarding (filled).xlsx";
    });
    inference.describe.mockImplementation(async (target: AgentTarget) => {
      expect(JSON.stringify(target)).not.toContain("Tirana");
      const asks: FormAsksV1 = {
        v: 1,
        targetId: target.targetId,
        formSignature: target.formSignature,
        sections: target.sections.map((s) => ({ ...s, profileHint: null })),
        fields: [
          {
            id: "f_0",
            sectionId: "main",
            what: "birth.place",
            whose: "self",
            format: { label: "", options: [] },
          },
        ],
      };
      expect(validateFormAsks(asks, target)).toBe(true);
      return asks;
    });

    const filled = await service.fillForm(
      { name: "onboarding.xlsx" } as File,
      xlsxBytes,
      profile,
    );
    expect(inference.describe).toHaveBeenCalledTimes(1);
    expect(filled).toEqual({ path: "/tmp/onboarding (filled).xlsx", filled: 1 });
    const outZip = await new JSZip().loadAsync(savedBytes!);
    const outSheet = await outZip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(outSheet).toContain("Tirana");
  });

  it("uses canonical attribute + owner from describe() to suppress preparer/official_only fields and resolve localized select/checkbox options", async () => {
    capture.readPdfForm.mockResolvedValue([
      {
        key: "box:0:0.6705:0.8221:0.0718:0.0187:choices:男@0.67,0.82,0.03,0.02;女@0.71,0.82,0.03,0.02",
        name: "",
        tooltip: "",
        label: "性別",
        section: "",
        type: "select-one",
        maxLength: 0,
        options: ["男", "女"],
      },
      {
        key: "box:0:0.2080:0.0900:0.2153:0.0220",
        name: "",
        tooltip: "",
        label: "（1）氏名",
        section: "※ 取次者 Agent or other authorized person",
        type: "text",
        maxLength: 0,
        options: [],
      },
      {
        key: "box:0:0.7000:0.9500:0.1500:0.0200",
        name: "",
        tooltip: "",
        label: "受付番号",
        section: "官公署記入欄",
        type: "text",
        maxLength: 0,
        options: [],
      },
      {
        key: "chk_female",
        name: "chk_female",
        tooltip: "",
        label: "weiblich",
        section: "",
        type: "checkbox",
        maxLength: 0,
        options: [],
      },
      {
        key: "chk_male",
        name: "chk_male",
        tooltip: "",
        label: "männlich",
        section: "",
        type: "checkbox",
        maxLength: 0,
        options: [],
      },
    ]);

    inference.describe.mockImplementation(async (target: AgentTarget) => {
      expect(target.sections.map((s) => s.label)).toEqual(
        expect.arrayContaining([
          "jp-isa-reentry-permit.pdf",
          "※ 取次者 Agent or other authorized person",
          "官公署記入欄",
        ]),
      );
      const byFieldId: Record<
        string,
        Omit<FormAsksV1["fields"][number], "id" | "sectionId">
      > = {
        f_0: {
          what: "Sex",
          whose: "applicant",
          attribute: "person.sex",
          owner: "applicant",
          format: { label: "", options: ["男", "女"] },
        },
        f_1: {
          what: "Full name",
          whose: "agent",
          attribute: "name.full",
          owner: "preparer",
          format: { label: "", options: [] },
        },
        f_2: {
          what: "Receipt number",
          whose: "office",
          attribute: "none",
          owner: "official_only",
          format: { label: "", options: [] },
        },
        f_3: {
          what: "Female",
          whose: "applicant",
          attribute: "person.sex",
          owner: "applicant",
          format: { label: "", options: [] },
        },
        f_4: {
          what: "Male",
          whose: "applicant",
          attribute: "person.sex",
          owner: "applicant",
          format: { label: "", options: [] },
        },
      };
      const asks: FormAsksV1 = {
        v: 1,
        targetId: target.targetId,
        formSignature: target.formSignature,
        sections: target.sections.map((s) => ({ ...s, profileHint: null })),
        fields: target.fields.map((tf) => ({
          id: tf.id,
          sectionId: tf.sectionId,
          ...byFieldId[tf.id],
        })),
      };
      expect(validateFormAsks(asks, target)).toBe(true);
      return asks;
    });
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));

    const profile = profileWith({
      "name.full": "阮 氏玲",
      "person.sex": "F",
    });

    const out = await service.fillPdfForm(
      { name: "jp-isa-reentry-permit.pdf" } as File,
      new Uint8Array([1, 2, 3]),
      profile,
    );

    expect(out.filled).toBe(2);
    expect(capture.fillPdfForm).toHaveBeenCalledWith(
      expect.objectContaining({
        values: {
          "box:0:0.6705:0.8221:0.0718:0.0187:choices:男@0.67,0.82,0.03,0.02;女@0.71,0.82,0.03,0.02":
            "女",
          chk_female: "true",
        },
      }),
    );
    expect(resolveSelectOption("VNM", ["日本 (JPN)", "ベトナム (VNM)"])).toBe("ベトナム (VNM)");
  });

  it("classifies dropped files by visual/structural layout instead of filename regex", async () => {
    (capture as any).classifyFile = jest
      .fn()
      .mockResolvedValueOnce({ kind: "form", widgets: 0, formSignals: 9, docSignals: 0 })
      .mockResolvedValueOnce({ kind: "ambiguous", widgets: 0, formSignals: 3, docSignals: 2 });

    await expect(
      service.classifyDroppedFile({ name: "IMG_4021.JPG" } as File, new Uint8Array([0xff, 0xd8])),
    ).resolves.toBe("form");
    await expect(
      service.classifyDroppedFile({ name: "scan_001.pdf" } as File, new Uint8Array([0x25, 0x50])),
    ).resolves.toBe("ambiguous");
  });
});
