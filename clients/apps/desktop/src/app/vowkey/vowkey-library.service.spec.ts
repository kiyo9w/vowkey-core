import { TestBed } from "@angular/core/testing";
import { BehaviorSubject, of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { newEnvelope, writeEnvelope } from "@vowkey/common/vault/profile/vk-meta";

import { VowkeyLibrary } from "./vowkey-library.service";

describe("VowkeyLibrary", () => {
  it("clears decrypted rows on a vault cache reset and resumes after unlock", () => {
    const views = new BehaviorSubject<CipherView[] | null>([]);
    TestBed.configureTestingModule({
      providers: [
        VowkeyLibrary,
        { provide: AccountService, useValue: { activeAccount$: of({ id: "account-1" }) } },
        { provide: CipherService, useValue: { cipherViews$: () => views.asObservable() } },
      ],
    });
    const library = TestBed.inject(VowkeyLibrary);
    const login = (id: string, name: string) => {
      const cipher = new CipherView();
      cipher.id = id;
      cipher.type = CipherType.Login;
      cipher.name = name;
      return cipher;
    };

    views.next([login("work", "Work login")]);
    expect(library.rowsFor("logins", null, "", "name").map((row) => row.title)).toEqual([
      "Work login",
    ]);

    views.next(null);
    expect(library.rowsFor("all", null, "", "name")).toEqual([]);

    views.next([login("personal", "Personal login")]);
    expect(library.rowsFor("logins", null, "", "name").map((row) => row.title)).toEqual([
      "Personal login",
    ]);
  });

  it("formats profile rows with document and detail counts while keeping document names searchable", () => {
    const views = new BehaviorSubject<CipherView[] | null>([]);
    TestBed.configureTestingModule({
      providers: [
        VowkeyLibrary,
        { provide: AccountService, useValue: { activeAccount$: of({ id: "account-1" }) } },
        { provide: CipherService, useValue: { cipherViews$: () => views.asObservable() } },
      ],
    });
    const library = TestBed.inject(VowkeyLibrary);

    const profile = new CipherView();
    profile.id = "profile-1";
    profile.type = CipherType.Identity;
    profile.name = "Lan Anh";
    const env = newEnvelope("profile-1");
    env.sources.push(
      {
        id: "src-1",
        attachmentId: "att-1",
        fileName: "Residence Card – Lan Anh.png",
        mediaType: "image/png",
        kind: "id_card",
        documentDate: null,
        effectiveOn: null,
        capturedAt: "2026-04-01T00:00:00.000Z",
        expiresOn: "2030-04-30",
        status: "current",
      },
      {
        id: "src-2",
        attachmentId: "att-2",
        fileName: "Passport – Lan Anh.png",
        mediaType: "image/png",
        kind: "passport",
        documentDate: null,
        effectiveOn: null,
        capturedAt: "2026-04-01T00:00:00.000Z",
        expiresOn: null,
        status: "current",
      },
    );
    env.details.push({
      id: "det-1",
      attribute: "name.full",
      label: "Full name",
      valueType: "text",
      chosenVariantId: "var-1",
      agentRule: "fill",
      variants: [
        {
          id: "var-1",
          script: "Latn",
          tag: null,
          value: "NGUYEN THI LAN ANH",
          current: true,
          sourceId: "src-1",
          locator: null,
          verified: true,
          origin: "ocr",
        },
      ],
      history: [],
      conflicts: [],
    });
    writeEnvelope(profile, env);

    views.next([profile]);

    const profileRows = library.rowsFor("profiles", null, "", "name");
    expect(profileRows[0]?.subtitle).toBe("2 documents · 1 detail");
    expect(library.rowsFor("profiles", null, "Residence Card", "name").map((r) => r.key)).toEqual([
      "profile-1",
    ]);

    const docRows = library.rowsFor("documents", null, "", "name");
    expect(docRows.map((r) => ({ title: r.title, mediaType: r.mediaType, attachmentId: r.attachmentId }))).toEqual([
      { title: "Passport", mediaType: "image/png", attachmentId: "att-2" },
      { title: "Residence Card", mediaType: "image/png", attachmentId: "att-1" },
    ]);
  });
});
