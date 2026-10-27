import { TestBed } from "@angular/core/testing";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { UserId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import * as sdk from "@vowkey/sdk-internal";

import { DocumentCaptureService, isSamePerson } from "./document-capture.service";

jest.mock("@vowkey/sdk-internal", () => ({
  ...jest.requireActual("@vowkey/sdk-internal"),
  capture_document_text: jest.fn(),
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

describe("DocumentCaptureService.add", () => {
  let service: DocumentCaptureService;
  let cipherService: MockProxy<CipherService>;
  const userId = "user-1" as UserId;
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
    view.identity = new IdentityView();
    return view;
  }

  beforeEach(() => {
    cipherService = mock<CipherService>();
    cipherService.getAllDecrypted.mockResolvedValue([]);
    cipherService.createWithServer.mockImplementation(async (view) => view);
    cipherService.updateWithServer.mockImplementation(async (view) => view);
    cipherService.encrypt.mockResolvedValue({ cipher: {} } as any);
    (sdk.update_profile as jest.Mock).mockImplementation((profile, { details }) => ({
      identity: { ...profile.identity, first_name: details.get("name.given.latin") ?? "" },
      custom: new Map([...profile.custom, ...details]),
    }));
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({ details: map({}) }));

    TestBed.configureTestingModule({
      providers: [
        DocumentCaptureService,
        { provide: CipherService, useValue: cipherService },
        {
          provide: AccountService,
          useValue: { activeAccount$: of({ id: userId, email: "linh@example.com" }) },
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
    expect(cipherService.createWithServer).toHaveBeenCalledTimes(1);
    expect(cipherService.updateWithServer).not.toHaveBeenCalled();
    // What follows from a detail is worked out when it is needed, so it is not saved.
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
    expect(cipherService.saveAttachmentRawWithServer).toHaveBeenCalledWith(
      expect.anything(),
      "passport.png",
      bytes,
      userId,
    );
    expect(result?.attached).toBe(true);
  });

  it("adds to the profile of the same person and shows only what is new", async () => {
    const linh = identity("p1", "Linh Nguyen");
    cipherService.getAllDecrypted.mockResolvedValue([linh]);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({
      details: map({ "id.passport.number": "C9481023", "contact.email": "linh@example.com" }),
    }));
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023", "id.passport.expiry": "2032-04-10" }),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.created).toBe(false);
    expect(result?.added.map((d) => d.key)).toEqual(["id.passport.expiry"]);
    expect(cipherService.updateWithServer).toHaveBeenCalledTimes(1);
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("saves nothing when the profile already has every detail", async () => {
    cipherService.getAllDecrypted.mockResolvedValue([identity("p1", "Linh Nguyen")]);
    (sdk.profile_stored_details as jest.Mock).mockImplementation(() => ({
      details: map({ "id.passport.number": "C9481023" }),
    }));
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );

    const result = await service.add("text", file, bytes);

    expect(result?.added).toEqual([]);
    expect(cipherService.updateWithServer).not.toHaveBeenCalled();
    expect(cipherService.saveAttachmentRawWithServer).not.toHaveBeenCalled();
  });

  it("returns nothing when the document says nothing", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(captured({}));

    expect(await service.add("a letter", file, bytes)).toBeNull();
    expect(cipherService.createWithServer).not.toHaveBeenCalled();
  });

  it("keeps the details when the file cannot be attached", async () => {
    (sdk.capture_document_text as jest.Mock).mockReturnValue(
      captured({ "id.passport.number": "C9481023" }),
    );
    cipherService.saveAttachmentRawWithServer.mockRejectedValue(new Error("no attachments"));

    const result = await service.add("text", file, bytes);

    expect(cipherService.createWithServer).toHaveBeenCalledTimes(1);
    expect(result?.attached).toBe(false);
    expect(result?.added).toHaveLength(1);
  });
});
