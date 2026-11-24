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
import { CardView } from "@vowkey/common/vault/models/view/card.view";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FieldView } from "@vowkey/common/vault/models/view/field.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";
import { readEnvelope, setProfileRef, writeEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import * as sdk from "@vowkey/sdk-internal";

import {
  CaptureProfileChoiceRequiredError,
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


  it("matches diacritic-folded whole names across word order and matching document IDs", () => {
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
  });

  it("matches CJK and Kana names across honorific suffixes and whitespace differences", () => {
    expect(
      isSamePerson(
        map({ "name.full.kana": "チャン ミン コア" }),
        map({ "bank.account.holder.kanji": "チャンミンコア様" }),
      ),
    ).toBe(true);
    expect(
      isSamePerson(
        map({ "name.full.kanji": "山田 太郎" }),
        map({ "name.full": "山田太郎 殿" }),
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

  it("keeps household members apart when they share a family name, a common given token, and a phone or email", () => {
    const household = {
      "name.family": "Nguyen",
      "contact.phone": "0901234567",
      "contact.email": "tran.family@example.test",
    };
    expect(
      isSamePerson(
        map({ ...household, "name.given": "Thi Linh" }),
        map({ ...household, "name.given": "Thi Lan Anh", "name.family.latin": "NGUYEN" }),
      ),
    ).toBe(false);
    expect(
      isSamePerson(
        map({ "name.full": "Nguyen Thi Linh", "contact.phone.mobile": "0901234567" }),
        map({ "name.full.latin": "NGUYEN THI LAN ANH", "contact.phone": "090-123-4567" }),
      ),
    ).toBe(false);
  });

  it("keeps one person when a renewed document changes the number but keeps the name and birth date", () => {
    expect(
      isSamePerson(
        map({
          "name.family": "Nguyen",
          "name.given": "Thi Linh",
          "birth.date": "1998-03-14",
          "id.passport.number": "C9481023",
        }),
        map({
          "name.family.latin": "NGUYEN",
          "name.given.latin": "LINH THI",
          "birth.date": "1998-03-14",
          "id.passport.number": "C1234567",
        }),
      ),
    ).toBe(true);
  });

  it("keeps two people apart when the birth date conflicts, even if a number is shared", () => {
    expect(
      isSamePerson(
        map({ "name.full": "山田 太郎", "birth.date": "1980-01-02", "id.mynumber": "123456789012" }),
        map({ "name.full": "山田 太郎", "birth.date": "1981-01-02", "id.mynumber": "123456789012" }),
      ),
    ).toBe(false);
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

  it("detects semantic duplicates across re-saved copies, routes nameless back-of-card captures to profile choice unless forced, and copies documents non-destructively", async () => {
    const stored = new Map<string, CipherView>();
    const storedAtt = new Map<string, Uint8Array>();
    localVault.list.mockImplementation(async () => [...stored.values()]);
    localVault.save.mockImplementation(async (view, attachments) => {
      stored.set(view.id, view);
      for (const att of attachments ?? []) {
        storedAtt.set(att.id, att.bytes);
      }
      return view;
    });
    localVault.attachment.mockImplementation(async (attId) =>
      storedAtt.get(attId) ?? new Uint8Array(),
    );
    (sdk.profile_stored_details as jest.Mock).mockImplementation(actualSdk.profile_stored_details);

    const first = await service.addCaptured(
      captured({
        "name.full": "TRAN MINH KHOA",
        "id.residence_card.number": "VK12040417AA",
        "birth.date": "1989-04-17",
      }),
      { name: "residence-front.jpg" } as File,
      new Uint8Array([10, 20, 30]),
    );
    expect(first?.created).toBe(true);
    expect(first?.duplicate).toBeUndefined();

    // Re-saved copy with different bytes/filename but identical extracted fields -> semantic duplicate!
    const resaved = await service.addCaptured(
      captured({
        "name.full": "TRAN MINH KHOA",
        "id.residence_card.number": "VK12040417AA",
        "birth.date": "1989-04-17",
      }),
      { name: "IMG_9001.JPG" } as File,
      new Uint8Array([99, 88, 77, 66]),
    );
    expect(resaved?.duplicate).toBe(true);
    expect(resaved?.profile.id).toBe(first!.profile.id);
    expect(readEnvelope(stored.get(first!.profile.id)!)?.sources.length).toBe(1);

    // Nameless back-of-card capture asks which profile it belongs to unless forceNewProfile is set
    await expect(
      service.addCaptured(
        captured({ "address.full": "東京都江東区大島3-14-8" }),
        { name: "card-back.jpg" } as File,
        new Uint8Array([5, 6, 7]),
      ),
    ).rejects.toThrow(CaptureProfileChoiceRequiredError);

    const spouse = await service.addCaptured(
      captured({ "name.full": "NGUYEN THI LAN ANH", "birth.date": "1991-09-03" }),
      { name: "spouse.jpg" } as File,
      new Uint8Array([4, 5, 6]),
      { forceNewProfile: true },
    );
    expect(spouse?.created).toBe(true);
    expect(spouse?.profile.id).not.toBe(first!.profile.id);

    // Non-destructive copyDocumentToProfile keeps the document in origin AND adds it to destination
    const copied = await service.copyDocumentToProfile(
      first!.profile.id,
      first!.sourceId!,
      spouse!.profile.id,
    );
    expect(readEnvelope(stored.get(first!.profile.id)!)?.sources.filter((s) => s.status !== "deleted")).toHaveLength(1);
    expect(readEnvelope(copied)?.sources.filter((s) => s.status !== "deleted")).toHaveLength(2);
    expect(readEnvelope(copied)?.details.some((d) => d.attribute === "id.residence_card.number")).toBe(true);
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

  it("narrows boxes via sub-piece glyph spans, preserves distinct boxes on repeated dates, and falls back to relay when local askDecision fails", async () => {
    capture.decisionSettings.mockResolvedValue({
      endpoint: "https://api.typesafe.ai",
      apiKey: "exhausted-key",
    });
    capture.askDecision.mockRejectedValue(new Error("Jev HTTP 402"));
    inference.decide.mockResolvedValue({ answers: {} });

    const lineText = "生年月日 1989年04月17日 性別 男";
    capture.readPieces.mockResolvedValue(
      JSON.stringify({
        pages: [
          {
            index: 0,
            unsure: 0.02,
            lineHeight: 22,
            pieces: [
              {
                text: lineText,
                x: 0.12,
                y: 0.28,
                w: 0.56,
                h: 0.045,
                confidence: 0.99,
                spans: [
                  { s: 0, e: 4, x: 0.12, y: 0.28, w: 0.1, h: 0.045 },
                  { s: 5, e: 16, x: 0.24, y: 0.28, w: 0.22, h: 0.045 },
                  { s: 17, e: 19, x: 0.49, y: 0.28, w: 0.06, h: 0.045 },
                  { s: 20, e: 21, x: 0.58, y: 0.28, w: 0.03, h: 0.045 },
                ],
              },
              {
                text: "在留期間 2030年04月30日",
                x: 0.12,
                y: 0.58,
                w: 0.44,
                h: 0.045,
                confidence: 0.99,
              },
              {
                text: "有効期間 2030年04月30日",
                x: 0.12,
                y: 0.77,
                w: 0.44,
                h: 0.045,
                confidence: 0.99,
              },
            ],
          },
        ],
      }),
    );
    (sdk.decision_finish as jest.Mock).mockReturnValue({
      details: new Map([
        ["birth.date", "1989-04-17"],
        ["visa.expiry", "2030-04-30"],
        ["id.card.expiry", "2030-04-30"],
      ]),
      sources: new Map([
        [
          "birth.date",
          {
            kind: "decision",
            verified: false,
            locator: { kind: "page", page: 0, x: 0.12, y: 0.28, w: 0.56, h: 0.045 },
          },
        ],
        [
          "visa.expiry",
          {
            kind: "decision",
            verified: false,
            locator: { kind: "page", page: 0, x: 0.12, y: 0.58, w: 0.44, h: 0.045 },
          },
        ],
        [
          "id.card.expiry",
          {
            kind: "decision",
            verified: false,
            locator: { kind: "page", page: 0, x: 0.12, y: 0.77, w: 0.44, h: 0.045 },
          },
        ],
      ]),
    });

    const result = await service.read(file, bytes);
    expect(capture.askDecision).toHaveBeenCalled();
    expect(inference.decide).toHaveBeenCalled();

    const birthLoc = result.captured.sources.get("birth.date")?.locator;
    const visaLoc = result.captured.sources.get("visa.expiry")?.locator;
    const cardLoc = result.captured.sources.get("id.card.expiry")?.locator;

    expect(birthLoc?.kind).toBe("page");
    if (birthLoc?.kind === "page") {
      expect(birthLoc.page).toBe(0);
      expect(birthLoc.x).toBeCloseTo(0.24, 5);
      expect(birthLoc.y).toBeCloseTo(0.28, 5);
      expect(birthLoc.w).toBeCloseTo(0.22, 5);
      expect(birthLoc.h).toBeCloseTo(0.045, 5);
    }
    expect(visaLoc?.kind === "page" && visaLoc.y).toBeCloseTo(0.58, 3);
    expect(cardLoc?.kind === "page" && cardLoc.y).toBeCloseTo(0.77, 3);
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

  it("resolves prepared PDF bindings from current allowed data without guessing missing people or facts", async () => {
    service.setAiFillMode(true);
    const names = [
      "vowkey:applicant:name.full#patient",
      "vowkey:applicant:contact.phone",
      "vowkey:spouse:name.full",
      "vowkey:applicant:id.mynumber",
    ];
    capture.readPdfForm.mockResolvedValue(names.map((name, index) => ({
      key: `widget_${index}`,
      name,
      tooltip: "",
      label: index === 0 ? "Telephone" : "Full name",
      type: "text",
      maxLength: 0,
      options: [],
    })));
    const profile = profileWith({
      "name.full": "Monika Sojli",
      "contact.phone": "080-2222-3333",
    });
    await service.fillPdfForm(
      { name: "prepared.pdf" } as File, new Uint8Array([1, 2, 3]), profile,
    );
    expect(capture.fillPdfForm.mock.calls.at(-1)[0].values).toEqual({
      widget_0: "Monika Sojli",
      widget_1: "080-2222-3333",
    });

    profile.fields.find((field) => field.name === "name.full").value = "Monika Hoxha";
    writeEnvelope(profile, {
      v: 1,
      profileId: profile.id,
      kind: "person",
      relationship: null,
      status: "confirmed",
      sources: [],
      details: [{
        id: "phone",
        attribute: "contact.phone",
        label: "Phone",
        valueType: "text",
        agentRule: "never",
        chosenVariantId: null,
        variants: [],
        history: [],
        conflicts: [],
      }],
    });
    await service.fillPdfForm(
      { name: "prepared.pdf" } as File, new Uint8Array([1, 2, 3]), profile,
    );
    expect(capture.fillPdfForm.mock.calls.at(-1)[0].values).toEqual({
      widget_0: "Monika Hoxha",
    });
    expect(capture.decisionSettings).not.toHaveBeenCalled();
    expect(inference.describe).not.toHaveBeenCalled();
    expect(inference.decide).not.toHaveBeenCalled();
  });

  it("fills household rows from their own profiles and leaves denied or absent relatives blank", async () => {
    const applicant = profileWith({ "name.full": "Applicant", "id.national.number": "111111111111" });
    const spouse = profileWith({ "name.full": "Spouse", "id.national.number": "222222222222" });
    spouse.id = "profile-spouse";
    writeEnvelope(spouse, {
      v: 1, profileId: spouse.id, kind: "person", relationship: "spouse",
      status: "confirmed", sources: [],
      details: [{
        id: "spouse-id", attribute: "id.national.number", label: "National ID",
        valueType: "text", agentRule: "never", chosenVariantId: null,
        variants: [], history: [], conflicts: [],
      }],
    });
    const dependent = profileWith({ "name.full": "Dependent" });
    dependent.id = "profile-dependent";
    writeEnvelope(dependent, {
      v: 1, profileId: dependent.id, kind: "person", relationship: "child",
      status: "confirmed", sources: [], details: [],
    });
    jest.spyOn(service, "profiles").mockResolvedValue([applicant, spouse, dependent]);
    const names = [
      "vowkey:applicant:name.full",
      "vowkey:spouse:name.full",
      "vowkey:dependent:name.full",
      "vowkey:spouse:id.national.number",
      "vowkey:guardian:name.full",
    ];
    capture.readPdfForm.mockResolvedValue(names.map((name, index) => ({
      key: `row_${index}`, name, tooltip: "",
      label: index === 3 ? "National ID" : "Full name",
      type: "text", maxLength: 0, options: [],
    })));
    await service.fillPdfForm(
      { name: "household.pdf" } as File, new Uint8Array([1, 2, 3]), applicant,
    );
    expect(capture.fillPdfForm.mock.calls.at(-1)[0].values).toEqual({
      row_0: "Applicant",
      row_1: "Spouse",
      row_2: "Dependent",
    });
  });

  it.each(["pdf", "docx"])(
    "fills an unfamiliar field after four local matches in a %s form",
    async (extension) => {
      const labels = ["Full name", "Date of birth", "Email", "Phone", "Commune d'origine déclarée"];
      const fields = labels.map((label, index) => ({
        key: `field_${index}`,
        name: "",
        tooltip: "",
        label,
        type: "text",
        maxLength: 0,
        options: [],
      }));
      let bytes = new Uint8Array([1, 2]);
      if (extension === "pdf") {
        capture.readPdfForm.mockResolvedValue(fields);
      } else {
        const zip = new JSZip();
        zip.file(
          "word/document.xml",
          `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>` +
            labels.map((label) =>
              `<w:tr><w:tc><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>`,
            ).join("") +
            `</w:tbl></w:body></w:document>`,
        );
        bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
      }
      inference.describe.mockImplementation(async (target: AgentTarget) => ({
        fields: target.fields
          .filter((field) => field.label === labels[4])
          .map((field) => ({ id: field.id, what: "birth.place", whose: "applicant" })),
      }));
      const fill = extension === "pdf"
        ? service.fillPdfForm.bind(service)
        : service.fillForm.bind(service);
      const result = await fill(
        { name: `application.${extension}` } as File,
        bytes,
        profileWith({
          "name.full": "Amara Okafor",
          "birth.date": "1991-06-12",
          "contact.email": "amara@example.com",
          "contact.phone": "+234 803 123 4567",
          "birth.place": "Enugu",
        }),
      );
      expect(result.filled).toBe(5);
      if (extension === "pdf") {
        expect(capture.fillPdfForm).toHaveBeenLastCalledWith(
          expect.objectContaining({ values: expect.objectContaining({ field_4: "Enugu" }) }),
        );
      } else {
        const saved = capture.saveCopy.mock.calls.at(-1)![0];
        const savedZip = await new JSZip().loadAsync(saved.bytes);
        expect(await savedZip.file("word/document.xml")!.async("string")).toContain("Enugu");
      }
    },
  );

  it("resolves Word labels before committing a misleading passport or personal-phone keyword match", async () => {
    const zip = new JSZip();
    const labels = ["お名前（ローマ字表記）在留カード・旅券の記載", "学校電話番号", "Research programme membership ID"];
    zip.file("word/document.xml",
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>` +
      labels.map((label) => `<w:tr><w:tc><w:p><w:r><w:t>${label}</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr>`).join("") +
      `</w:tbl></w:body></w:document>`);
    inference.describe.mockResolvedValue({ fields: [
      { id: "f_0", what: "name.full", whose: "applicant" },
      { id: "f_1", what: "education.school.phone", whose: "applicant" },
      { id: "f_2", what: "none", whose: "applicant" },
    ] });
    inference.decide.mockResolvedValue({ answers: {
      f_2: { choice: "custom.membership.code", probabilities: { "custom.membership.code": 0.94, none: 0.06 } },
    } });
    await service.fillForm(
      { name: "account.docx" } as File,
      new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
      profileWith({
        "name.full": "Amara Okafor",
        "id.passport.number": "P0094123",
        "contact.phone.mobile": "+234 803 123 4567",
        "education.school.phone": "+234 1 555 0100",
        "custom.membership.code": "RP-72419",
      }),
    );
    const saved = capture.saveCopy.mock.calls.at(-1)![0];
    const output = await new JSZip().loadAsync(saved.bytes);
    const xml = await output.file("word/document.xml")!.async("string");
    expect(xml).toContain("Amara Okafor");
    expect(xml).toContain("+234 1 555 0100");
    expect(xml).toContain("RP-72419");
    const decisionInput = JSON.stringify(inference.decide.mock.calls);
    expect(decisionInput).not.toContain("RP-72419");
    expect(decisionInput).not.toContain("Amara Okafor");
    expect(xml).not.toContain("P0094123");
    expect(xml).not.toContain("+234 803 123 4567");
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

  it("fills linked details and never lets AI mode override on-device-only or Don't fill", async () => {
    const cipherSvc = TestBed.inject(CipherService) as MockProxy<CipherService>;
    const card = new CipherView();
    card.id = "card-1";
    card.type = CipherType.Card;
    card.card = Object.assign(new CardView(), {
      cardholderName: "MONIKA SOJLI",
      number: "4111222233334444",
    });
    setProfileRef(card, "profile-1");

    const login = new CipherView();
    login.id = "login-1";
    login.type = CipherType.Login;
    login.login = Object.assign(new LoginView(), {
      username: "monika@vowkey.app",
    });
    setProfileRef(login, "profile-1");
    cipherSvc.getAllDecrypted.mockResolvedValue([card, login]);

    // 1. Linked Login email fills contact.email on a PDF form when profile lacks email
    inference.describe.mockRejectedValue(new ReadingServiceUnavailableError(503));
    capture.readPdfForm.mockResolvedValue([
      {
        key: "email_field",
        name: "email",
        tooltip: "",
        label: "Email address",
        type: "text",
        maxLength: 0,
        options: [],
      },
    ]);
    const baseProfile = profileWith({ "name.full": "Monika Sojli" });
    const pdfRes = await service.fillPdfForm(
      { name: "application.pdf" } as File,
      new Uint8Array([1, 2, 3]),
      baseProfile,
    );
    expect(pdfRes.filled).toBe(1);
    expect(capture.fillPdfForm).toHaveBeenLastCalledWith(
      expect.objectContaining({ values: { email_field: "monika@vowkey.app" } }),
    );

    privacyMode = "local";
    service.setAiFillMode(true);
    capture.readPdfForm.mockResolvedValue([
      {
        key: "box:0:0.2500:0.6500:0.3000:0.0300", name: "", tooltip: "",
        label: "Full name", type: "text", maxLength: 0, options: [],
      },
      {
        key: "box:0:0.2500:0.7500:0.3000:0.0300", name: "", tooltip: "",
        label: "Passport number", type: "text", maxLength: 0, options: [],
      },
    ]);
    const imagePlanner = jest.fn();
    Object.assign(inference, { planImageFill: imagePlanner });

    const guardedProfile = new CipherView();
    guardedProfile.id = "profile-1";
    guardedProfile.name = "Monika Sojli";
    guardedProfile.type = CipherType.Identity;
    guardedProfile.identity = new IdentityView();
    writeEnvelope(guardedProfile, {
      v: 1,
      profileId: "profile-1",
      kind: "person",
      relationship: null,
      status: "confirmed",
      sources: [],
      details: [
        {
          id: "d-name",
          attribute: "name.full",
          label: "Full name",
          valueType: "text",
          chosenVariantId: "v-name",
          agentRule: "ask",
          history: [],
          conflicts: [],
          variants: [
            {
              id: "v-name",
              script: null,
              tag: null,
              value: "Monika Sojli",
              current: true,
              sourceId: null,
              locator: null,
              verified: false,
              origin: "typed",
            },
          ],
        },
        {
          id: "d-pass",
          attribute: "id.passport.number",
          label: "Passport number",
          valueType: "text",
          chosenVariantId: "v-pass",
          agentRule: "never",
          history: [],
          conflicts: [],
          variants: [
            {
              id: "v-pass",
              script: null,
              tag: null,
              value: "C9999999",
              current: true,
              sourceId: null,
              locator: null,
              verified: false,
              origin: "typed",
            },
          ],
        },
      ],
    });
    // Also populate fields so profile_details sees the values alongside envelope rules
    guardedProfile.fields!.push(
      Object.assign(new FieldView(), { name: "name.full", value: "Monika Sojli", type: FieldType.Text }),
      Object.assign(new FieldView(), { name: "id.passport.number", value: "C9999999", type: FieldType.Text }),
    );

    const imgRes = await service.fillPdfForm(
      { name: "desk-photo.jpg" } as File,
      new Uint8Array([0xff, 0xd8, 0xff]),
      guardedProfile,
    );
    expect(imgRes.filled).toBe(1);
    expect(capture.fillPdfForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        values: { "box:0:0.2500:0.6500:0.3000:0.0300": "Monika Sojli" },
      }),
    );
    expect(imagePlanner).not.toHaveBeenCalled();
  });

  it("supplements partial local boxes with planImageFill in default Smart mode and keeps person-scoped spouse/custom attributes", async () => {
    privacyMode = "masked";
    service.setAiFillMode(false);
    capture.readPdfForm.mockResolvedValue([
      {
        key: "box:0:0.2000:0.8000:0.3000:0.0300",
        name: "",
        tooltip: "",
        label: "Full name",
        type: "text",
        maxLength: 0,
        options: [],
      },
      {
        key: "spouse_occ",
        name: "spouse_occ",
        tooltip: "",
        label: "Spouse occupation",
        type: "text",
        maxLength: 0,
        options: [],
      },
    ]);
    (inference as any).describe = jest.fn(async () => ({
      fields: [
        {
          id: "f_1",
          attribute: "work.occupation",
          owner: "spouse",
        },
      ],
    }));
    (inference as any).planImageFill = jest.fn(async () => ({
      fields: [
        {
          sourceKey: "name.full",
          label: "Full name",
          value: "TRAN MINH KHOA",
          box: [0.2, 0.17, 0.3, 0.03],
          comb: null,
          action: "text",
        },
        {
          sourceKey: "id.residence_card.number",
          label: "Residence card No.",
          value: "AB12345678CD",
          box: [0.45, 0.42, 0.42, 0.035],
          comb: 12,
          action: "text",
        },
        {
          sourceKey: "person.gender",
          label: "Sex (Male)",
          value: "男",
          box: [0.72, 0.28, 0.03, 0.025],
          comb: null,
          action: "circle",
        },
      ],
    }));
    capture.fillPdfForm.mockImplementation(async ({ values }: any) => ({
      path: "/tmp/hybrid-filled.png",
      filled: Object.keys(values).length,
      bytes: new Uint8Array([1, 2, 3]),
    }));

    const householdProfile = profileWith({
      "name.full": "TRAN MINH KHOA",
      "id.residence_card.number": "AB12345678CD",
      "person.gender": "M",
      "spouse.work.occupation": "Pharmacist",
    });

    const res = await service.fillPdfForm(
      { name: "camera-form.png" } as File,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      householdProfile,
    );

    expect(res.filled).toBe(4);
    expect(capture.fillPdfForm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        values: {
          "box:0:0.2000:0.8000:0.3000:0.0300": "TRAN MINH KHOA",
          spouse_occ: "Pharmacist",
          "box:0:0.4500:0.5450:0.4200:0.0350:comb:12": "AB12345678CD",
          "box:0:0.7200:0.6950:0.0300:0.0250:circle": "男",
        },
      }),
    );
  });

  it("does not retain a guessed paper cell in another section after a full image plan succeeds", async () => {
    const guessedCell = "box:0:0.1000:0.3000:0.5000:0.0300:cell";
    capture.readPdfForm.mockResolvedValue([{
      key: guessedCell, name: "", tooltip: "", label: "Mobile phone",
      type: "text", maxLength: 0, options: [],
    }]);
    const details = {
      "name.full": "Amara Okafor", "birth.date": "1991-06-12",
      "contact.phone.mobile": "+234 803 123 4567", "contact.email": "amara@example.test",
      "address.full": "14 Market Street",
    };
    const imagePlanner = jest.fn(async () => ({
      fields: Object.entries(details).map(([sourceKey, value], index) => ({
        sourceKey, value, label: sourceKey, box: [0.2, 0.05 + index * 0.1, 0.5, 0.04],
        comb: null, action: "text",
      })),
    }));
    Object.assign(inference, { planImageFill: imagePlanner });
    await service.fillPdfForm({ name: "clinic.png" } as File, new Uint8Array([1, 2, 3]), profileWith(details));
    const written = capture.fillPdfForm.mock.calls.at(-1)![0].values as Record<string, string>;
    expect(written).not.toHaveProperty(guessedCell);
    expect(Object.values(written).filter((value) => value === details["contact.phone.mobile"])).toEqual([
      details["contact.phone.mobile"],
    ]);
  });

  it("runs local Decision in 'On this device only' mode when a local model is active while blocking every outbound cloud call", async () => {
    privacyMode = "local";
    (inference as any).describe = jest.fn();
    (inference as any).planImageFill = jest.fn();
    (inference as any).readDocumentVision = jest.fn();
    inference.decide.mockClear();

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
    const profile = profileWith({ "address.full": "14 Rue de Rivoli, Paris" });

    // Without local: true (e.g. remote API key), 'local' privacy mode blocks askDecision completely
    capture.decisionSettings.mockResolvedValue({ perRequest: 20 });
    capture.askDecision.mockClear();
    const blocked = await service.fillForm(
      { name: "demande.docx" } as File,
      docxBytes,
      profile,
    );
    expect(blocked).toEqual({ path: null, filled: 0 });
    expect(capture.askDecision).not.toHaveBeenCalled();

    // With local: true (downloaded on-device GGUF running via local llama-server), askDecision runs locally
    capture.decisionSettings.mockResolvedValue({ perRequest: 20, local: true });
    capture.askDecision.mockImplementation(async (req: any) => {
      const answers: Record<string, { choice: string }> = {};
      for (const [qId, spec] of Object.entries<any>(req.questions ?? {})) {
        const keys = Object.keys(spec?.criteria ?? {});
        const choice = keys.includes("address.full")
          ? "address.full"
          : keys.includes("address")
            ? "address"
            : keys.includes("applicant")
              ? "applicant"
              : keys[0];
        answers[qId] = { choice };
      }
      return { answers };
    });
    let savedBytes: Uint8Array | null = null;
    capture.saveCopy.mockImplementation(async ({ bytes }) => {
      savedBytes = bytes;
      return "/tmp/demande (filled).docx";
    });

    const localFilled = await service.fillForm(
      { name: "demande.docx" } as File,
      docxBytes,
      profile,
    );
    expect(localFilled).toEqual({ path: "/tmp/demande (filled).docx", filled: 1 });
    expect(capture.askDecision).toHaveBeenCalledTimes(2);
    expect(inference.decide).not.toHaveBeenCalled();
    expect((inference as any).describe).not.toHaveBeenCalled();
    expect((inference as any).planImageFill).not.toHaveBeenCalled();
    expect((inference as any).readDocumentVision).not.toHaveBeenCalled();

    const outZip = await new JSZip().loadAsync(savedBytes!);
    const outXml = await outZip.file("word/document.xml")!.async("string");
    expect(outXml).toContain("14 Rue de Rivoli, Paris");
  });

});
