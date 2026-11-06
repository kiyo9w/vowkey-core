import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { DeviceType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";

import { VowkeyLibrary } from "./vowkey-library.service";
import { VowkeyShellComponent } from "./vowkey-shell.component";

describe("VowkeyShellComponent", () => {
  const messaging = mock<MessagingService>();
  let showQuickBar: jest.Mock;
  let updateShellPreferences: jest.Mock;

  beforeEach(() => {
    showQuickBar = jest.fn(async () => undefined);
    updateShellPreferences = jest.fn(async (patch) => ({
      appPresence: "both",
      quickBarMode: "floating",
      floatAboveWindows: true,
      openAtLogin: false,
      ...patch,
    }));
    (globalThis as unknown as { ipc: unknown }).ipc = {
      quickBar: {
        show: showQuickBar,
        getShellPreferences: jest.fn(async () => ({
          appPresence: "both",
          quickBarMode: "floating",
          floatAboveWindows: true,
          openAtLogin: false,
        })),
        updateShellPreferences,
        onOpenSettings: jest.fn(() => () => undefined),
      },
    };
  });

  function create(
    device = DeviceType.MacOsDesktop,
    account: { name: string; email: string } | null = {
      name: "Linh Nguyen",
      email: "linh@example.test",
    },
    initialRows: { kind: string }[] = [],
  ) {
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string) => key);
    i18n.setLocale.mockResolvedValue(undefined);
    i18n.userSetLocale$ = new BehaviorSubject<string | undefined>(undefined);
    i18n.locale$ = new BehaviorSubject<string>("en");
    const platform = mock<PlatformUtilsService>();
    platform.getDevice.mockReturnValue(device);
    const rows = signal(initialRows);
    const library = {
      account: signal(account),
      online: signal(true),
      profiles: signal([]),
      expiringCount: signal(0),
      rows,
    };
    TestBed.configureTestingModule({
      imports: [VowkeyShellComponent],
      providers: [
        provideRouter([]),
        { provide: I18nService, useValue: i18n },
        { provide: MessagingService, useValue: messaging },
        { provide: PlatformUtilsService, useValue: platform },
        { provide: VowkeyLibrary, useValue: library },
      ],
    });
    const fixture = TestBed.createComponent(VowkeyShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  it("closes the account menu with Escape and returns focus to its trigger", async () => {
    const fixture = create();
    const trigger = fixture.nativeElement.querySelector<HTMLButtonElement>(".vk-account")!;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    fixture.detectChanges();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the guest sidebar calm, omits telemetry posture chrome, and switches language inside Settings", async () => {
    const fixture = create(DeviceType.MacOsDesktop, null);
    const i18n = TestBed.inject(I18nService) as jest.Mocked<I18nService>;
    await fixture.whenStable();
    fixture.detectChanges();

    const sidebarText = fixture.nativeElement.querySelector(".vk-side")!.textContent as string;
    expect(sidebarText).toContain("vowkeyLocalVault");
    expect(sidebarText).toContain("vkSignInToSync");
    expect(sidebarText).not.toContain("On this Mac");
    expect(sidebarText).not.toContain("Outbound AI log");
    expect(sidebarText).not.toContain("Mask names & IDs");

    const settingsBtn = fixture.nativeElement.querySelector<HTMLButtonElement>(
      ".vk-foot button.vk-item",
    )!;
    settingsBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const modal = fixture.nativeElement.querySelector('[aria-labelledby="vk-settings-title"]')!;
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain("vkLanguage");
    expect(modal.textContent).toContain("vkSettingsQuickBarMac");
    expect(modal.textContent).toContain("vkQuickBarFloating");
    expect(modal.textContent).toContain("vkPrivacySmartTitle");
    expect(modal.textContent).toContain("vkPrivacyLocalTitle");
    expect(modal.textContent).not.toContain("0 cloud requests sent");
    expect(modal.textContent).not.toContain("Outbound AI log");

    const langSelect = modal.querySelector<HTMLSelectElement>(
      '[data-testid="vowkey-language-select"]',
    )!;
    expect(langSelect).not.toBeNull();
    langSelect.value = "ja";
    langSelect.dispatchEvent(new Event("change"));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(i18n.setLocale).toHaveBeenCalledWith("ja");

    const radios = modal.querySelectorAll<HTMLInputElement>('input[name="vkQuickBarMode"]');
    expect(radios.length).toBe(2);
    expect(radios[0].checked).toBe(true);
    radios[1].click();
    radios[1].dispatchEvent(new Event("change"));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(updateShellPreferences).toHaveBeenCalledWith({ quickBarMode: "popover" });
  });

  it("collapses Developer categories when empty, expands when keys exist, and opens Quick Bar from Browser autofill help", async () => {
    const fixture = create(DeviceType.MacOsDesktop, null, []);
    await fixture.whenStable();
    fixture.detectChanges();

    const devToggle = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[data-testid="vowkey-nav-developer-toggle"]',
    )!;
    expect(devToggle.getAttribute("aria-expanded")).toBe("false");
    expect(fixture.nativeElement.querySelector(".vk-nav")!.textContent).not.toContain("vkKeys");

    devToggle.click();
    fixture.detectChanges();
    expect(devToggle.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.nativeElement.querySelector(".vk-nav")!.textContent).toContain("vkKeys");
    expect(fixture.nativeElement.querySelector(".vk-nav")!.textContent).toContain(
      "vkEnvironments",
    );
  });

  it("auto-expands the Developer sidebar group when developer items exist", async () => {
    const fixture = create(DeviceType.MacOsDesktop, null, [{ kind: "key" }]);
    await fixture.whenStable();
    fixture.detectChanges();

    const devToggle = fixture.nativeElement.querySelector<HTMLButtonElement>(
      '[data-testid="vowkey-nav-developer-toggle"]',
    )!;
    expect(devToggle.getAttribute("aria-expanded")).toBe("true");
    expect(fixture.nativeElement.querySelector(".vk-nav")!.textContent).toContain("vkKeys");
  });
});
