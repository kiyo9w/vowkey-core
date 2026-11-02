import { NgZone } from "@angular/core";
import { Router } from "@angular/router";
import { mock, MockProxy } from "jest-mock-extended";
import { of } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { KeyService } from "@vowkey/key-management";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { TotpService } from "@vowkey/common/vault/abstractions/totp.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ApiKeyView } from "@vowkey/common/vault/models/view/api-key.view";
import { CardView } from "@vowkey/common/vault/models/view/card.view";
import { LoginUriView } from "@vowkey/common/vault/models/view/login-uri.view";
import { LoginView } from "@vowkey/common/vault/models/view/login.view";
import { writeEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { LocalAgentManagement } from "@vowkey/vault";

import { DocumentCaptureService } from "../services/document-capture.service";
import { VowkeyHub } from "../vowkey/vowkey-hub.service";

import { QuickBarComponent } from "./quick-bar.component";

jest.mock("@vowkey/sdk-internal", () => ({
  ...jest.requireActual("@vowkey/sdk-internal"),
  detail_label: (key: string) => `label:${key}`,
}));

const LINH_DETAILS: [string, string][] = [
  ["id.passport.number", "C9481023"],
  ["contact.email", "linh@example.com"],
];

function profile(id: string, name: string): CipherView {
  const view = new CipherView();
  view.id = id;
  view.name = name;
  view.type = CipherType.Identity;
  writeEnvelope(view, {
    v: 1,
    profileId: id,
    kind: "person",
    relationship: null,
    status: "confirmed",
    sources: [],
    details: LINH_DETAILS.map(([key, value], index) => ({
      id: `d${index}`,
      attribute: key,
      label: `label:${key}`,
      valueType: "text",
      chosenVariantId: `v${index}`,
      agentRule: "ask",
      history: [],
      conflicts: [],
      variants: [
        {
          id: `v${index}`,
          script: null,
          tag: null,
          value,
          current: true,
          sourceId: null,
          locator: null,
          verified: false,
          origin: "typed",
        },
      ],
    })),
  });
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
  let ciphers: MockProxy<CipherService>;
  let totpService: MockProxy<TotpService>;
  let localAgent: MockProxy<LocalAgentManagement>;

  const linh = profile("p1", "Linh Nguyen");
  let quickBarIpc: { onRequest: jest.Mock; respond: jest.Mock; notifyAgentPending: jest.Mock };

  beforeEach(() => {
    quickBarIpc = { onRequest: jest.fn(), respond: jest.fn(), notifyAgentPending: jest.fn() };
    (globalThis as any).ipc = {
      quickBar: quickBarIpc,
      localVault: {
        agent: { onRequest: jest.fn(), respond: jest.fn(), ready: jest.fn(), changed: jest.fn() },
      },
    };
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
    ciphers = mock<CipherService>();
    ciphers.cipherViews$.mockReturnValue(of([linh]));
    ciphers.getAllDecrypted.mockResolvedValue([linh]);
    totpService = mock<TotpService>();
    localAgent = mock<LocalAgentManagement>();
    localAgent.pending.mockResolvedValue({ requests: [], pairs: [] } as never);

    const zone = { run: (fn: () => unknown) => fn() } as unknown as NgZone;
    const localVault = mock<LocalVaultService>();
    localVault.state$ = of("session-unlocked") as unknown as LocalVaultService["state$"];
    localVault.initialize.mockResolvedValue(undefined);
    localVault.list.mockResolvedValue([linh]);
    const accounts = { activeAccount$: of({ id: "user-1" }) } as unknown as AccountService;
    const keys = { userKey$: () => of({}) } as unknown as KeyService;
    component = new QuickBarComponent(
      authService,
      documents,
      platformUtilsService,
      router,
      zone,
      localVault,
      accounts,
      keys,
      ciphers,
      mock(),
      mock(),
      new VowkeyHub(),
      totpService,
      localAgent,
    );
    component.ngOnInit();
  });

  afterEach(() => {
    component.ngOnDestroy();
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
      linh.identity = Object.assign(
        new (jest.requireActual("@vowkey/common/vault/models/view/identity.view").IdentityView)(),
        { firstName: "Linh" },
      );
      const [[handle]] = quickBarIpc.onRequest.mock.calls;
      handle(7, { kind: "details" });
      await new Promise((resolve) => setTimeout(resolve));

      expect(quickBarIpc.respond).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          profiles: [{ id: "p1", name: "Linh Nguyen" }],
          details: expect.arrayContaining([
            expect.objectContaining({ label: "label:id.passport.number", value: "C9481023" }),
            expect.objectContaining({ label: "label:contact.email", value: "linh@example.com" }),
          ]),
        }),
      );
    });

    it("adds a dropped document and says what it added", async () => {
      documents.read.mockResolvedValue({ captured: "text", unclear: null } as never);
      documents.addCaptured.mockResolvedValue({
        profile: linh,
        created: false,
        added: [
          {
            key: "id.passport.number",
            label: "Passport number",
            value: "C9481023",
            verified: true,
          },
        ],
        attached: true,
      });

      const result = await component.answerPill({
        kind: "process",
        name: "passport.jpg",
        path: "/Users/linh/Downloads/passport.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      });

      expect(documents.rememberPath).toHaveBeenCalledWith(
        expect.any(File),
        "/Users/linh/Downloads/passport.jpg",
      );
      expect(result).toMatchObject({
        good: true,
        title: "Added 1 detail",
        subtitle: "to Linh Nguyen",
      });
    });

    it("says the vault is locked while it is", async () => {
      authService.activeAccountStatus$ = of(AuthenticationStatus.Locked);
      component.ngOnInit();

      expect(await component.answerPill({ kind: "details" })).toMatchObject({ locked: true });
    });
  });

  describe("a document", () => {
    it("is read, saved to a profile, and the details it added are shown", async () => {
      documents.read.mockResolvedValue({
        captured: "text of the passport",
        unclear: null,
      } as never);
      documents.addCaptured.mockResolvedValue({
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

      await component.processFile(fileOf("passport.pdf"), undefined, undefined, false);

      expect(documents.addCaptured).toHaveBeenCalledWith(
        "text of the passport",
        expect.objectContaining({ name: "passport.pdf" }),
        expect.any(Uint8Array),
        expect.anything(),
      );
      expect(component.slot()).toBe("added");
      expect(component.addedFrom()).toBe("passport.pdf");
      expect(component.statusTitle()).toBe("Added 2 details");
      expect(component.statusSubtitle()).toBe("to Linh Nguyen");
      expect(component.added().map((d) => d.label)).toEqual(["Passport number", "Date of birth"]);
    });

    it("says when it started a new profile", async () => {
      documents.read.mockResolvedValue({ captured: "text", unclear: null } as never);
      documents.addCaptured.mockResolvedValue({
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
      documents.read.mockResolvedValue({ captured: "a letter", unclear: null } as never);
      documents.addCaptured.mockResolvedValue(null);
      documents.isPdfForm.mockReturnValue(false);

      await component.processFile(fileOf("letter.pdf"));

      expect(component.slot()).toBe("notice");
      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Nothing to add from letter.pdf");
      expect(component.statusSubtitle()).toBe("No details were found in it.");
    });

    it("saves nothing from a photo too small to read, and asks for a closer one", async () => {
      documents.read.mockResolvedValue({ captured: "noise", unclear: "small" } as never);

      await component.processFile(fileOf("payslip.jpg"));

      expect(documents.addCaptured).not.toHaveBeenCalled();
      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Couldn't read payslip.jpg");
      expect(component.statusSubtitle()).toBe(
        "The print is too small in this photo. Retake it closer, or add the original file.",
      );
    });

    it("says what went wrong when it cannot be read", async () => {
      documents.read.mockRejectedValue(
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
      expect(component.statusTitle()).toBe("Add details for this form");
    });

    it("says so when no field matched, and keeps no copy", async () => {
      documents.fillForm.mockResolvedValue({ path: null, filled: 0 });

      await component.processFile(fileOf("blank.docx"));

      expect(component.noticeGood()).toBe(false);
      expect(component.statusTitle()).toBe("Nothing in blank.docx matched");
    });

    it("fills a photographed paper form (IMG_4021.JPG) when invoked with fill intent", async () => {
      documents.isPdfForm.mockReturnValue(false);
      documents.fillPdfForm.mockResolvedValue({
        path: "/Users/linh/Desktop/IMG_4021 (filled).pdf",
        filled: 6,
      });

      const result = await component.answerPill({
        kind: "process",
        name: "IMG_4021.JPG",
        path: "/Users/linh/Desktop/IMG_4021.JPG",
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        intent: "fill",
      });

      expect(documents.read).not.toHaveBeenCalled();
      expect(documents.fillPdfForm).toHaveBeenCalledWith(
        expect.objectContaining({ name: "IMG_4021.JPG" }),
        expect.any(Uint8Array),
        linh,
      );
      expect(result).toMatchObject({
        good: true,
        title: "Filled 6 fields",
        subtitle: "saved as IMG_4021 (filled).pdf",
      });
    });
  });

  describe("universal vault items, paste, agent capsule, and macOS AutoFill", () => {
    function makeLogin(
      id: string,
      name: string,
      username: string,
      password: string,
      uri: string,
      totp?: string,
    ): CipherView {
      const c = new CipherView();
      c.id = id;
      c.name = name;
      c.type = CipherType.Login;
      const login = new LoginView();
      login.username = username;
      login.password = password;
      login.totp = totp ?? null;
      const u = new LoginUriView();
      u.uri = uri;
      login.uris = [u];
      c.login = login;
      return c;
    }

    it("returns all vault item types without an 8-row cap, ranks matched site logins first, and resolves live 6-digit TOTP", async () => {
      totpService.getCode$.mockReturnValue(of({ code: "482910", period: 30 }));

      const githubLogin = makeLogin(
        "l-gh",
        "GitHub",
        "linh@vowkey.com",
        "gh-secret",
        "https://github.com/login",
        "JBSWY3DPEHPK3PXP",
      );
      const otherLogins = Array.from({ length: 8 }, (_, idx) =>
        makeLogin(
          `l-${idx}`,
          `Service ${idx}`,
          `user${idx}@example.com`,
          `pw-${idx}`,
          `https://service-${idx}.example.com`,
        ),
      );

      const cardCipher = new CipherView();
      cardCipher.id = "c-card";
      cardCipher.name = "Visa Platinum";
      cardCipher.type = CipherType.Card;
      const card = new CardView();
      card.number = "4111222233334444";
      card.expMonth = "08";
      card.expYear = "2029";
      card.code = "912";
      cardCipher.card = card;

      const keyCipher = new CipherView();
      keyCipher.id = "c-key";
      keyCipher.name = "OpenAI Production";
      keyCipher.type = CipherType.ApiKey;
      const apiKey = new ApiKeyView();
      apiKey.value = "sk-live-9876543210";
      apiKey.allowedHosts = ["api.openai.com"];
      keyCipher.apiKey = apiKey;

      ciphers.getAllDecrypted.mockResolvedValue([
        linh,
        ...otherLogins,
        cardCipher,
        keyCipher,
        githubLogin,
      ]);

      const response = (await component.answerPill({
        kind: "details",
        front: {
          appName: "Google Chrome",
          bundleId: "com.google.Chrome",
          url: "https://gist.github.com/new",
          host: "gist.github.com",
        },
      })) as { items: Array<Record<string, unknown>> };

      expect(response.items.length).toBe(13);
      expect(response.items[0]).toMatchObject({
        kind: "login",
        label: "GitHub",
        matched: true,
        username: "linh@vowkey.com",
        password: "gh-secret",
        totp: "482910",
      });
      expect(response.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "card",
            label: "Visa Platinum",
            displayValue: "•••• 4444",
          }),
          expect.objectContaining({
            kind: "key",
            label: "OpenAI Production",
            value: "sk-live-9876543210",
            displayValue: "sk-l••••••••10",
          }),
        ]),
      );
    });

    it("reads a ⌘V pasted screenshot into a profile while leaving plain-text paste untouched", async () => {
      documents.read.mockResolvedValue({ captured: "passport mrz", unclear: null } as never);
      documents.addCaptured.mockResolvedValue({
        profile: linh,
        created: false,
        added: [
          {
            key: "id.passport.number",
            label: "Passport number",
            value: "C9481023",
            verified: true,
          },
        ],
        attached: true,
      });

      const textPrevent = jest.fn();
      await component.onWindowPaste({
        clipboardData: { items: [{ kind: "string", type: "text/plain" }], files: [] },
        preventDefault: textPrevent,
      } as unknown as ClipboardEvent);
      expect(textPrevent).not.toHaveBeenCalled();
      expect(documents.read).not.toHaveBeenCalled();

      const rawScreenshot = fileOf("image.png");
      Object.defineProperty(rawScreenshot, "type", { value: "image/png" });
      const imgPrevent = jest.fn();
      await component.onWindowPaste({
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => rawScreenshot,
            },
          ],
          files: [rawScreenshot],
        },
        preventDefault: imgPrevent,
      } as unknown as ClipboardEvent);

      expect(imgPrevent).toHaveBeenCalled();
      expect(documents.read).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Screenshot.png" }),
        expect.any(Uint8Array),
      );
      expect(component.reader()?.profile).toBe(linh);
      expect(component.readerNote()).toBe("Added 1 detail to Linh Nguyen");
    });

    it("surfaces external AI agent approval prompts without raw secrets and forwards decisions", async () => {
      localAgent.pending.mockResolvedValue({
        pairs: [],
        requests: [
          {
            requestId: "req-42",
            displayName: "Claude Code",
            targetDisplay: "portal.immigration.go.jp",
            reason: "Submit residence renewal form",
            entries: [
              {
                entryId: "e-pass",
                label: "Passport number",
                reference: "@vk:p1/id.passport.number",
              },
            ],
          },
        ],
      } as never);

      const state = (await component.answerPill({ kind: "details" })) as {
        agentPrompt: Record<string, unknown>;
      };
      expect(state.agentPrompt).toEqual({
        kind: "request",
        requestId: "req-42",
        agentName: "Claude Code",
        targetDisplay: "portal.immigration.go.jp",
        goal: undefined,
        reason: "Submit residence renewal form",
        entries: [
          {
            entryId: "e-pass",
            label: "Passport number",
            reference: "@vk:p1/id.passport.number",
          },
        ],
      });

      await component.answerPill({
        kind: "agentDecision",
        decision: "allow_once",
        requestId: "req-42",
        entryIds: ["e-pass"],
      });
      expect(localAgent.answer).toHaveBeenCalledWith("req-42", "allow_once", ["e-pass"]);
    });

    it("serves domain-matched metadata on list and full secret + TOTP on get for macOS AutoFill", async () => {
      totpService.getCode$.mockReturnValue(of({ code: "119204", period: 30 }));
      const gh = makeLogin(
        "l-gh",
        "GitHub",
        "linh@vowkey.com",
        "gh-pass",
        "https://github.com",
        "SECRET",
      );
      const bank = makeLogin("l-bank", "Bank", "linh", "bank-pass", "https://mybank.example");
      ciphers.getAllDecrypted.mockResolvedValue([gh, bank]);

      const listRes = (await component.answerPill({
        kind: "passwordCredentials",
        serviceIdentifiers: ["https://gist.github.com"],
      })) as { credentials: Array<Record<string, unknown>> };

      expect(listRes.credentials).toEqual([
        {
          recordIdentifier: "l-gh",
          username: "linh@vowkey.com",
          password: undefined,
          totp: undefined,
          serviceIdentifier: "https://github.com",
          title: "GitHub",
        },
      ]);

      const getRes = (await component.answerPill({
        kind: "passwordCredentials",
        recordIdentifier: "l-gh",
      })) as { credentials: Array<Record<string, unknown>> };

      expect(getRes.credentials).toEqual([
        {
          recordIdentifier: "l-gh",
          username: "linh@vowkey.com",
          password: "gh-pass",
          totp: "119204",
          serviceIdentifier: "https://github.com",
          title: "GitHub",
        },
      ]);
    });
  });
});
