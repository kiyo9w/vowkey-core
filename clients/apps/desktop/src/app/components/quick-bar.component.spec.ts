import { NgZone } from "@angular/core";
import { Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";

import { DocumentCaptureService } from "../services/document-capture.service";

import { QuickBarComponent } from "./quick-bar.component";

jest.mock("@vowkey/sdk-internal", () => ({
  ...jest.requireActual("@vowkey/sdk-internal"),
  detail_label: (key: string) => `label:${key}`,
}));

function profile(id: string, name: string): CipherView {
  const view = new CipherView();
  view.id = id;
  view.name = name;
  return view;
}

function fileOf(name: string): File {
  const bytes = new Uint8Array([1, 2, 3]);
  return { name, arrayBuffer: async () => bytes.buffer } as unknown as File;
}

describe("QuickBarComponent", () => {
  let component: QuickBarComponent;
  let authService: MockProxy<AuthService>;
  let documents: MockProxy<DocumentCaptureService>;
  let platformUtilsService: MockProxy<PlatformUtilsService>;
  let router: MockProxy<Router>;

  const linh = profile("p1", "Linh Nguyen");
  let quickBarIpc: { onRequest: jest.Mock; respond: jest.Mock };

  beforeEach(() => {
    quickBarIpc = { onRequest: jest.fn(), respond: jest.fn() };
    (globalThis as any).ipc = { quickBar: quickBarIpc };
    authService = mock<AuthService>();
    authService.activeAccountStatus$ = of(AuthenticationStatus.Unlocked);
    documents = mock<DocumentCaptureService>();
    documents.profiles.mockResolvedValue([linh]);
    documents.detailsOf.mockReturnValue(
      new Map([
        ["id.passport.number", "C9481023"],
        ["contact.email", "linh@example.com"],
      ]),
    );
    platformUtilsService = mock<PlatformUtilsService>();
    router = mock<Router>();

    const zone = { run: (fn: () => unknown) => fn() } as unknown as NgZone;
    component = new QuickBarComponent(authService, documents, platformUtilsService, router, zone);
    component.ngOnInit();
  });

  it("lists the details of every profile and narrows them by what is typed", async () => {
    await component.openBar();

    expect(component.allHits().map((h) => h.value)).toEqual(["C9481023", "linh@example.com"]);
    expect(component.allHits()[0]).toMatchObject({
      label: "label:id.passport.number",
      profile: "Linh Nguyen",
    });

    component.onQueryChange("C9481");
    expect(component.filteredHits().map((h) => h.value)).toEqual(["C9481023"]);
  });

  it("copies a detail and says so", async () => {
    await component.openBar();
    component.copyHit(component.allHits()[0]);

    expect(platformUtilsService.copyToClipboard).toHaveBeenCalledWith("C9481023");
    expect(component.slot()).toBe("notice");
    expect(component.statusTitle()).toBe("label:id.passport.number copied");
  });

  describe("the pill in the menu bar", () => {
    it("reads the details of the vault through this window", async () => {
      linh.identity = Object.assign(new (jest.requireActual("@vowkey/common/vault/models/view/identity.view").IdentityView)(), { firstName: "Linh" });
      const [[handle]] = quickBarIpc.onRequest.mock.calls;
      handle(7, { kind: "details" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(quickBarIpc.respond).toHaveBeenCalledWith(7, {
        firstName: "Linh",
        details: [
          { label: "label:id.passport.number", value: "C9481023" },
          { label: "label:contact.email", value: "linh@example.com" },
        ],
      });
    });

    it("adds a dropped document and says what it added", async () => {
      documents.readText.mockResolvedValue("text");
      documents.add.mockResolvedValue({
        profile: linh,
        created: false,
        added: [{ key: "id.passport.number", label: "Passport number", value: "C9481023", verified: true }],
        attached: true,
      });

      const result = await component.answerPill({
        kind: "process",
        name: "passport.jpg",
        path: "/Users/linh/Downloads/passport.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      });

      expect(documents.rememberPath).toHaveBeenCalledWith(expect.any(File), "/Users/linh/Downloads/passport.jpg");
      expect(result).toEqual({ good: true, title: "Added 1 detail", subtitle: "to Linh Nguyen" });
    });

    it("says the vault is locked while it is", async () => {
      authService.activeAccountStatus$ = of(AuthenticationStatus.Locked);
      component.ngOnInit();

      expect(await component.answerPill({ kind: "details" })).toEqual({ locked: true });
    });
  });

  describe("a document", () => {
    it("is read, saved to a profile, and the details it added are shown", async () => {
      documents.readText.mockResolvedValue("text of the passport");
      documents.add.mockResolvedValue({
        profile: linh,
        created: false,
        added: [
          {
            key: "id.passport.number",
            label: "Passport number",
            value: "C9481023",
            verified: true,
          },
          { key: "birth.date", label: "Date of birth", value: "1998-03-14", verified: true },
        ],
        attached: true,
      });

      await component.processFile(fileOf("passport.pdf"));

      expect(documents.add).toHaveBeenCalledWith(
        "text of the passport",
        expect.objectContaining({ name: "passport.pdf" }),
        expect.any(Uint8Array),
      );
      expect(component.slot()).toBe("added");
      expect(component.addedFrom()).toBe("passport.pdf");
      expect(component.statusTitle()).toBe("Added 2 details");
      expect(component.statusSubtitle()).toBe("to Linh Nguyen");
      expect(component.added().map((d) => d.label)).toEqual(["Passport number", "Date of birth"]);
    });

    it("says when it started a new profile", async () => {
      documents.readText.mockResolvedValue("text");
      documents.add.mockResolvedValue({
        profile: profile("p2", "THI LINH NGUYEN"),
        created: true,
        added: [
          { key: "birth.date", label: "Date of birth", value: "1998-03-14", verified: false },
        ],
        attached: false,
      });

      await component.processFile(fileOf("card.png"));

      expect(component.statusSubtitle()).toBe("to a new profile, THI LINH NGUYEN");
      expect(component.attached()).toBe(false);
    });

    it("says so when nothing in it can be added", async () => {
      documents.readText.mockResolvedValue("a letter");
      documents.add.mockResolvedValue(null);
      documents.isPdfForm.mockReturnValue(false);

      await component.processFile(fileOf("letter.pdf"));

      expect(component.slot()).toBe("notice");
      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Nothing to add from letter.pdf");
      expect(component.statusSubtitle()).toBe("No details were found in it.");
    });


    it("says what went wrong when it cannot be read", async () => {
      documents.readText.mockRejectedValue(
        new Error("Reading documents is not available on this computer yet."),
      );

      await component.processFile(fileOf("passport.jpg"));

      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Couldn't use passport.jpg");
      expect(component.statusSubtitle()).toContain("not available on this computer");
    });
  });

  describe("a form", () => {
    it("is filled from the only profile and saved beside the original", async () => {
      documents.fillForm.mockResolvedValue({ path: "/forms/ward (filled).xlsx", filled: 12 });

      await component.processFile(fileOf("ward.xlsx"));

      expect(documents.fillForm).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ward.xlsx" }),
        expect.any(Uint8Array),
        linh,
      );
      expect(component.noticeGood()).toBe(true);
      expect(component.statusTitle()).toBe("Filled 12 fields");
      expect(component.statusSubtitle()).toBe("saved as ward (filled).xlsx");
    });

    it("is a PDF with form fields, filled the way Preview fills it", async () => {
      documents.isPdfForm.mockReturnValue(true);
      documents.fillPdfForm.mockResolvedValue({ path: "/forms/anmeldung (filled).pdf", filled: 9 });

      await component.processFile(fileOf("anmeldung.pdf"));

      expect(documents.readText).not.toHaveBeenCalled();
      expect(documents.fillPdfForm).toHaveBeenCalledWith(
        expect.objectContaining({ name: "anmeldung.pdf" }),
        expect.any(Uint8Array),
        linh,
      );
      expect(component.statusTitle()).toBe("Filled 9 fields");
      expect(component.statusSubtitle()).toBe("saved as anmeldung (filled).pdf");
    });

    it("asks whose details to use when there are several profiles", async () => {
      const mai = profile("p2", "Mai Tran");
      documents.profiles.mockResolvedValue([linh, mai]);
      documents.fillForm.mockResolvedValue({ path: "/forms/a (filled).docx", filled: 3 });

      await component.processFile(fileOf("a.docx"));
      expect(component.slot()).toBe("choose");
      expect(component.choices()).toEqual([linh, mai]);
      expect(documents.fillForm).not.toHaveBeenCalled();

      await component.fillFrom(mai);
      expect(documents.fillForm).toHaveBeenCalledWith(expect.anything(), expect.anything(), mai);
      expect(component.statusTitle()).toBe("Filled 3 fields");
    });

    it("says so when the vault has no profile to fill it from", async () => {
      documents.profiles.mockResolvedValue([]);

      await component.processFile(fileOf("a.docx"));

      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("No profile to fill from");
    });

    it("says so when no field matched, and keeps no copy", async () => {
      documents.fillForm.mockResolvedValue({ path: null, filled: 0 });

      await component.processFile(fileOf("blank.docx"));

      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Nothing in blank.docx matched");
    });
  });
});
