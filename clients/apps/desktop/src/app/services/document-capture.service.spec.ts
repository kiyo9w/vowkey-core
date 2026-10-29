import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference, ReadingServiceUnavailableError } from "@vowkey/common/vault/local/product-inference";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import * as sdk from "@vowkey/sdk-internal";

import { DocumentCaptureService, isSamePerson, unclearReading } from "./document-capture.service";

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
    expect(localVault.save).toHaveBeenCalledWith(
      expect.anything(),
      [{ id: expect.any(String), fileName: "passport.png", bytes }],
    );
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
    localVault.list.mockResolvedValue([identity("b4aef1fa-ae61-49f9-b72b-086e118660e7", "Linh Nguyen")]);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({
      details: map({ "id.passport.number": "C9481023" }),
    }));
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.added).toEqual([]);
    expect(localVault.save).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ bytes })]);
    expect(result?.attached).toBe(true);
  });

  it("returns nothing when the document says nothing", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(captured({}));

    expect(await service.add("a letter", file, bytes)).toBeNull();
    expect(localVault.save).not.toHaveBeenCalled();
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("reports a failed local transaction instead of claiming the document was saved", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );
    localVault.save.mockRejectedValue(new Error("disk full"));
    await expect(service.add("text", file, bytes)).rejects.toThrow("disk full");
  });
});

describe("DocumentCaptureService.read", () => {
  let service: DocumentCaptureService;
  const file = { name: "residence-card.jpg" } as File;
  const bytes = new Uint8Array([1, 2, 3]);
  const read = { details: new Map([["name.full", "A"]]), sources: new Map() };
  const capture = {
    readPieces: jest.fn(),
    readDocument: jest.fn(),
  };
  const inference = { decide: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    (globalThis as any).ipc = { capture };
    capture.readPieces.mockResolvedValue('{"pages":[]}');
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
        { provide: AccountService, useValue: { activeAccount$: of({ id: "user-1" }) } },
      ],
    });
    service = TestBed.inject(DocumentCaptureService);
  });

  it("asks Decision about the pieces of the document in two rounds and takes what it placed", async () => {
    const result = await service.read(file, bytes);

    expect(result).toEqual({ captured: read, unclear: null });
    expect(capture.readPieces).toHaveBeenCalledWith(bytes, "residence-card.jpg");
    expect(inference.decide).toHaveBeenCalledWith({ round: 1 });
    expect(inference.decide).toHaveBeenCalledWith({ round: 2 });
    expect(sdk.decision_begin).toHaveBeenCalledWith('{"pages":[]}', 0);
    expect(sdk.decision_take_first_answers).toHaveBeenCalledWith("plan-1", expect.any(String));
    expect(sdk.decision_finish).toHaveBeenCalledWith("plan-2", expect.any(String), "", expect.any(Number));
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
    (sdk.capture_document_text as jest.Mock).mockReturnValue({ details: new Map(), sources: new Map() });
    await expect(service.read(file, bytes)).rejects.toThrow("reading service is unavailable");
  });

  it("reads only the standard parts when Decision cannot be asked", async () => {
    inference.decide.mockRejectedValue(new ReadingServiceUnavailableError(503));
    capture.readDocument.mockResolvedValue("text of the card");
    (sdk.capture_document_text as jest.Mock).mockReturnValue(read);

    expect((await service.read(file, bytes)).captured).toBe(read);
    expect(sdk.capture_document_text).toHaveBeenCalled();
  });
});

describe("unclearReading", () => {
  it("finds a page whose print was mostly read unsure, and says whether its print was small", () => {
    expect(unclearReading('{"pages":[{"unsure":0.83,"lineHeight":6}]}')).toBe("small");
    expect(unclearReading('{"pages":[{"unsure":0.7,"lineHeight":18}]}')).toBe("unclear");
    expect(unclearReading('{"pages":[{"unsure":0.6}]}')).toBe("unclear");
  });

  it("finds nothing in a page that read clearly, or in a reading without the measure", () => {
    expect(unclearReading('{"pages":[{"unsure":0.12,"lineHeight":18}]}')).toBeNull();
    expect(unclearReading('{"pages":[{"pieces":[]}]}')).toBeNull();
    expect(unclearReading("not json")).toBeNull();
  });
});
