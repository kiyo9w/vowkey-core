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

  function create(device = DeviceType.MacOsDesktop) {
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string) => key);
    const platform = mock<PlatformUtilsService>();
    platform.getDevice.mockReturnValue(device);
    const library = {
      account: signal({ name: "Linh Nguyen", email: "linh@example.test" }),
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
});
