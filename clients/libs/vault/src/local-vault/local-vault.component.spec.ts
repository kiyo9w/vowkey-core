jest.mock("pdfjs-dist", () => ({
  getDocument: jest.fn(),
}));
jest.mock("pdfjs-dist/webpack.mjs", () => ({}));

const mockFillDocx = jest.fn();
const mockFillXlsx = jest.fn();
const mockFillHwpx = jest.fn();
const mockCaptureText = jest.fn();
const mockDecodeBarcode = jest.fn();
const mockProfileDetails = jest.fn();

jest.mock("@vowkey/sdk-internal", () => {
  const actual = jest.requireActual("@vowkey/sdk-internal");
  return {
    ...actual,
    capture_document_text: (...args: unknown[]) => mockCaptureText(...args),
    decode_document_barcode: (...args: unknown[]) => mockDecodeBarcode(...args),
    detail_label: (key: string) => key,
    fill_docx_with_profile: (...args: unknown[]) => mockFillDocx(...args),
    fill_xlsx_with_profile: (...args: unknown[]) => mockFillXlsx(...args),
    fill_hwpx_with_profile: (...args: unknown[]) => mockFillHwpx(...args),
    profile_details: (...args: unknown[]) => mockProfileDetails(...args),
  };
});

import { Component, Input } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { BehaviorSubject } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ClientType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { LocalVaultService, LocalVaultState } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { buildSampleProfileCipher } from "@vowkey/common/vault/profile/sample-walkthrough";

import { CipherViewComponent } from "../cipher-view/cipher-view.component";
import { ProfileComponent } from "../cipher-view/profile/profile.component";

import { LocalVaultComponent } from "./local-vault.component";

@Component({ selector: "app-profile", standalone: true, template: "" })
class StubProfileComponent {
  @Input() cipher: unknown;
}

@Component({ selector: "app-cipher-view", standalone: true, template: "" })
class StubCipherViewComponent {
  @Input() cipher: unknown;
  @Input() hideChangePasswordLink = false;
}

describe("LocalVaultComponent", () => {
  let fixture: ComponentFixture<LocalVaultComponent>;
  let component: LocalVaultComponent;
  let storedItems: CipherView[];
  let state$: BehaviorSubject<LocalVaultState>;
  let mockVault: {
    state$: BehaviorSubject<LocalVaultState>;
    initialize: jest.Mock;
    ensureUnlocked: jest.Mock;
    isAttachedToAccount: jest.Mock;
    startOverIfEmpty: jest.Mock;
    protectionMetadata: jest.Mock;
    list: jest.Mock;
    afterFillOffer: jest.Mock;
    save: jest.Mock;
    store: { list: jest.Mock; commit: jest.Mock; get: jest.Mock };
  };

  beforeEach(async () => {
    Object.defineProperty(SdkLoadService, "Ready", {
      configurable: true,
      get: () => Promise.resolve(),
    });
    mockFillDocx.mockReset();
    mockFillXlsx.mockReset();
    mockFillHwpx.mockReset();
    mockCaptureText.mockReset();
    mockDecodeBarcode.mockReset();
    mockProfileDetails.mockReset().mockReturnValue({
      details: new Map([["name.family", "Mustermann"]]),
    });

    storedItems = [];
    state$ = new BehaviorSubject<LocalVaultState>("session-unlocked");
    mockVault = {
      state$,
      initialize: jest.fn().mockResolvedValue(undefined),
      ensureUnlocked: jest.fn().mockResolvedValue(undefined),
      isAttachedToAccount: jest.fn().mockResolvedValue(false),
      startOverIfEmpty: jest.fn().mockResolvedValue(true),
      protectionMetadata: jest.fn().mockResolvedValue(null),
      list: jest.fn(async () => [...storedItems]),
      afterFillOffer: jest.fn().mockResolvedValue({ show: false }),
      save: jest.fn(async (cipher: CipherView) => {
        cipher.id ||= "saved-profile-1";
        const idx = storedItems.findIndex((i) => i.id === cipher.id);
        if (idx >= 0) {
          storedItems[idx] = cipher;
        } else {
          storedItems.push(cipher);
        }
        return cipher;
      }),
      store: {
        list: jest.fn().mockResolvedValue([]),
        commit: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
      },
    };

    await TestBed.configureTestingModule({
      imports: [LocalVaultComponent],
      providers: [
        provideRouter([]),
        { provide: LocalVaultService, useValue: mockVault },
        {
          provide: AccountService,
          useValue: { activeAccount$: new BehaviorSubject(null) },
        },
        {
          provide: I18nService,
          useValue: {
            t: (key: string, ...args: string[]) => {
              const table: Record<string, string> = {
                all: "All",
                allItems: "All items",
                notes: "Notes",
                vkWtStepForm: "2. Practice fill",
                vkSamplePassport: "Passport",
              };
              if (key === "vkWtFilledSummary") {
                return `Filled ${args[0]} fields from ${args[1]}. 1 field left for you (${args[2]}).`;
              }
              return table[key] ?? key;
            },
          },
        },
        {
          provide: PlatformUtilsService,
          useValue: { getClientType: () => ClientType.Web },
        },
      ],
    })
      .overrideComponent(LocalVaultComponent, {
        remove: { imports: [ProfileComponent, CipherViewComponent] },
        add: { imports: [StubProfileComponent, StubCipherViewComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(LocalVaultComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("renders concise plural filter chips without Secure note or Identity overflow", () => {
    const pills = Array.from(
      fixture.nativeElement.querySelectorAll(".compact-pills button"),
    ).map((btn) => (btn as HTMLElement).textContent?.trim());

    expect(pills).toEqual(["All", "Profiles", "Logins", "Cards", "Notes"]);
  });

  it("fills a .docx form from a saved profile via WASM and triggers download", async () => {
    storedItems.push(buildSampleProfileCipher("idcard"));
    await component.startSample("idcard");
    fixture.detectChanges();

    const filledBytes = new Uint8Array([80, 75, 3, 4]);
    mockFillDocx.mockReturnValue({
      bytes: filledBytes,
      report: { format: "docx", filled_count: 5, entries: [] },
    });
    const downloadSpy = jest
      .spyOn(component as unknown as { downloadBytes: () => void }, "downloadBytes")
      .mockImplementation(() => undefined);

    const file = new File([new Uint8Array([1, 2, 3])], "Registration.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const fakeInput = { files: [file], value: "Registration.docx" } as unknown as HTMLInputElement;
    await component.onFormFileSelected({ target: fakeInput } as unknown as Event);
    fixture.detectChanges();

    expect(mockFillDocx).toHaveBeenCalledTimes(1);
    expect(downloadSpy).toHaveBeenCalledWith(
      "Registration-filled.docx",
      filledBytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const statusEl = fixture.nativeElement.querySelector('[data-testid="local-fill-status"]');
    expect(statusEl?.textContent).toContain(
      "Filled 5 fields in Registration-filled.docx from Erika Mustermann (Sample).",
    );
  });

  it("guides .pdf form selections in browser mode to Desktop and opens Practice fill", async () => {
    const pdfFile = new File([new Uint8Array([37, 80, 68, 70])], "Visa-Form.pdf", {
      type: "application/pdf",
    });
    const fakeInput = { files: [pdfFile], value: "Visa-Form.pdf" } as unknown as HTMLInputElement;
    await component.onFormFileSelected({ target: fakeInput } as unknown as Event);
    fixture.detectChanges();

    const statusEl = fixture.nativeElement.querySelector('[data-testid="local-fill-status"]');
    expect(statusEl?.textContent).toContain("Vowkey for Desktop");
    const practiceBtn = fixture.nativeElement.querySelector(
      '[data-testid="local-fill-open-practice"]',
    ) as HTMLButtonElement | null;
    expect(practiceBtn).not.toBeNull();

    await component.openOrCreatePractice();
    fixture.detectChanges();
    expect(component.practiceOpen()).toBe(true);
  });

  it("captures text documents into a saved profile with attached source bytes", async () => {
    mockCaptureText.mockReturnValue({
      details: new Map([
        ["name.given", "Erika"],
        ["name.family", "Mustermann"],
        ["birth.date", "1983-08-12"],
      ]),
      sources: new Map([
        ["name.given", { kind: "ocr", verified: false }],
        ["name.family", { kind: "ocr", verified: false }],
        ["birth.date", { kind: "ocr", verified: false }],
      ]),
    });

    const txtFile = new File(["Name: Erika Mustermann\nDOB: 1983-08-12"], "id-extract.txt", {
      type: "text/plain",
    });
    const fakeInput = { files: [txtFile], value: "id-extract.txt" } as unknown as HTMLInputElement;
    await component.onDocumentFileSelected({ target: fakeInput } as unknown as Event);
    fixture.detectChanges();

    expect(mockCaptureText).toHaveBeenCalledTimes(1);
    expect(mockVault.save).toHaveBeenCalledTimes(1);
    const [savedProfile, attachments] = mockVault.save.mock.calls[0];
    expect(savedProfile.name).toBe("Erika Mustermann");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].fileName).toBe("id-extract.txt");
    expect(component.fillStatus()?.text).toContain("Read 3 details from id-extract.txt into Erika Mustermann.");
  });

  it("fills the active browser tab via fillCipherForPopup when running in Browser Extension mode", async () => {
    const sample = buildSampleProfileCipher("passport");
    sample.id = "guest-passport-1";
    storedItems.push(sample);

    const sendMessageMock = jest.fn(
      (_msg: Record<string, unknown>, cb: (res: unknown) => void) => {
        cb({ result: { outcome: "filled" } });
      },
    );
    (globalThis as unknown as { chrome?: unknown }).chrome = {
      tabs: {
        query: (_q: unknown, cb: (tabs: unknown[]) => void) =>
          cb([{ id: 42, url: "https://forms.test/apply", active: true }]),
      },
      runtime: { sendMessage: sendMessageMock },
    };

    try {
      await (component as unknown as { refresh: () => Promise<void> }).refresh();
      Object.defineProperty(component, "browserExtension", { value: true });
      fixture.detectChanges();

      const fillBtn = fixture.nativeElement.querySelector(
        '[data-testid="local-fill-page"]',
      ) as HTMLButtonElement | null;
      expect(fillBtn).not.toBeNull();

      await component.fillActivePage();
      expect(sendMessageMock).toHaveBeenCalledWith(
        {
          command: "fillCipherForPopup",
          tabId: 42,
          tabUrl: "https://forms.test/apply",
          cipherId: "guest-passport-1",
        },
        expect.any(Function),
      );
      expect(component.fillStatus()?.text).toContain("Filled active tab from");
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it("offers to start over on this device when a vault is linked to an account nobody can reach and holds nothing", async () => {
    state$.next("persisted-locked");
    mockVault.isAttachedToAccount.mockResolvedValue(true);
    const fixture = TestBed.createComponent(LocalVaultComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[data-testid="local-start-over"]');
    expect(button).not.toBeNull();
    button.click();
    await fixture.whenStable();
    expect(mockVault.startOverIfEmpty).toHaveBeenCalledTimes(1);
  });
});

