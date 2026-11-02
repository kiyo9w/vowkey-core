import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { mock } from "jest-mock-extended";

import { DeviceType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";

import { VowkeyLibrary } from "./vowkey-library.service";
import { VowkeyShellComponent } from "./vowkey-shell.component";

describe("VowkeyShellComponent", () => {
  const messaging = mock<MessagingService>();
  let updateShellPreferences: jest.Mock;

  beforeEach(() => {
    updateShellPreferences = jest.fn(async (patch) => ({
      appPresence: "both",
      quickBarMode: "floating",
      floatAboveWindows: true,
      openAtLogin: false,
      ...patch,
    }));
    (globalThis as unknown as { ipc: unknown }).ipc = {
      quickBar: {
        show: jest.fn(async () => undefined),
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
  ) {
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string) => key);
    const platform = mock<PlatformUtilsService>();
    platform.getDevice.mockReturnValue(device);
    const library = {
      account: signal(account),
      online: signal(true),
      profiles: signal([]),
      expiringCount: signal(0),
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

  it("keeps the guest sidebar calm and houses Quick Bar, privacy, and diagnostics inside Settings", async () => {
    const fixture = create(DeviceType.MacOsDesktop, null);
    await fixture.whenStable();
    fixture.detectChanges();

    const sidebarText = fixture.nativeElement.querySelector(".vk-side")!.textContent as string;
    expect(sidebarText).toContain("On this Mac");
    expect(sidebarText).toContain("Sign in to sync");
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
    expect(modal.textContent).toContain("Quick Bar & menu bar");
    expect(modal.textContent).toContain("Floating window");
    expect(modal.textContent).toContain("Smart assist");
    expect(modal.textContent).toContain("Local only");
    expect(modal.textContent).toContain("0 cloud requests sent");

    const radios = modal.querySelectorAll<HTMLInputElement>('input[name="vkQuickBarMode"]');
    expect(radios.length).toBe(2);
    expect(radios[0].checked).toBe(true);
    radios[1].click();
    radios[1].dispatchEvent(new Event("change"));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(updateShellPreferences).toHaveBeenCalledWith({ quickBarMode: "popover" });
  });
});
