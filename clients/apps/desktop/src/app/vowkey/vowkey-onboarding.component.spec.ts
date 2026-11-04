import { TestBed } from "@angular/core/testing";
import { mock } from "jest-mock-extended";
import { BehaviorSubject } from "rxjs";

import { DeviceType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SAMPLE_SCENARIO_LIST } from "@vowkey/common/vault/profile/sample-walkthrough";

import { NativeMessagingManifestService } from "../services/native-messaging-manifest.service";

import {
  handTypingPlan,
  readOnboarding,
  typingFrames,
  VowkeyOnboardingComponent,
  writeOnboarding,
} from "./vowkey-onboarding.component";

/** A frame shorter than the one before it is a backspace. */
function backspaces(frames: string[]): number {
  return frames.filter((frame, i) => i > 0 && frame.length < frames[i - 1].length).length;
}

describe("onboarding progress", () => {
  beforeEach(() => localStorage.clear());

  it("is absent on a first launch and round-trips the step it stopped on", () => {
    expect(readOnboarding()).toBeNull();
    writeOnboarding({ step: "permissions", done: false });
    expect(readOnboarding()).toEqual({ step: "permissions", done: false });
  });

  it("starts again when the saved record is unreadable or names an unknown step", () => {
    localStorage.setItem("vk.onboarding", "{not json");
    expect(readOnboarding()).toBeNull();
    localStorage.setItem("vk.onboarding", JSON.stringify({ step: "billing", done: true }));
    expect(readOnboarding()).toBeNull();
  });
});

describe("hand typing in the demo", () => {
  it("ends every field on its exact value and fixes a typo with two backspaces", () => {
    const frames = typingFrames("23/04/1956", true);
    expect(frames.at(-1)).toBe("23/04/1956");
    expect(backspaces(frames)).toBe(2);
    expect(frames).toContain("23/40");
    expect(backspaces(typingFrames("23/04/1956", false))).toBe(0);
  });

  it.each(SAMPLE_SCENARIO_LIST.map((spec) => [spec.id, spec] as const))(
    "makes exactly the two typos the %s verdict promises",
    (_id, spec) => {
      const plan = handTypingPlan(spec.fields.map((f) => f.practiceFillValue));
      expect(plan.map((frames) => frames.at(-1))).toEqual(
        spec.fields.slice(0, 3).map((f) => f.practiceFillValue),
      );
      expect(plan.reduce((sum, frames) => sum + backspaces(frames) / 2, 0)).toBe(2);
    },
  );
});

describe("VowkeyOnboardingComponent on each desktop", () => {
  beforeEach(() => localStorage.clear());

  function create(
    device: DeviceType,
    opts: { trusted?: boolean; bridgeError?: Error | null; words?: Record<string, string> } = {},
  ) {
    (globalThis as unknown as { ipc: unknown }).ipc = {
      quickBar: { accessibilityStatus: jest.fn(async () => opts.trusted ?? true) },
    };
    const i18n = mock<I18nService>();
    i18n.t.mockImplementation((key: string) => opts.words?.[key] ?? key);
    i18n.userSetLocale$ = new BehaviorSubject<string | undefined>(undefined);
    i18n.locale$ = new BehaviorSubject<string>("en");
    const platform = mock<PlatformUtilsService>();
    platform.getDevice.mockReturnValue(device);
    const manifests = { generate: jest.fn(async () => opts.bridgeError ?? null) };
    TestBed.configureTestingModule({
      imports: [VowkeyOnboardingComponent],
      providers: [
        { provide: I18nService, useValue: i18n },
        { provide: PlatformUtilsService, useValue: platform },
        { provide: NativeMessagingManifestService, useValue: manifests },
      ],
    });
    const fixture = TestBed.createComponent(VowkeyOnboardingComponent);
    fixture.detectChanges();
    return fixture;
  }

  async function continueFromDemo(fixture: ReturnType<typeof create>) {
    writeOnboarding({ step: "demo", done: false });
    const c = fixture.componentInstance as unknown as {
      go(s: string): void;
      next(): Promise<void>;
    };
    c.go("demo");
    await c.next();
    fixture.detectChanges();
    return readOnboarding()?.step;
  }

  it("goes straight from the demo to the practice on Windows, which asks for nothing", async () => {
    const fixture = create(DeviceType.WindowsDesktop);
    expect(await continueFromDemo(fixture)).toBe("practice");
  });

  it("shows only the browser row on Windows when the connection could not set itself up", async () => {
    const fixture = create(DeviceType.WindowsDesktop, {
      bridgeError: new Error("no manifest dir"),
    });
    expect(await continueFromDemo(fixture)).toBe("permissions");
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector("[data-testid=vk-ob-perm-browser]")).not.toBeNull();
    expect(el.querySelector("[data-testid=vk-ob-perm-accessibility]")).toBeNull();
    expect(el.querySelector("h1")?.textContent).toContain("vkObPermBrowserOnlyTitle");
  });

  it("asks for Accessibility on a Mac that has not granted it, and skips the page once it has", async () => {
    const untrusted = create(DeviceType.MacOsDesktop, { trusted: false });
    expect(await continueFromDemo(untrusted)).toBe("permissions");
    expect(
      untrusted.nativeElement.querySelector("[data-testid=vk-ob-perm-accessibility]"),
    ).not.toBeNull();
    TestBed.resetTestingModule();
    localStorage.clear();
    expect(await continueFromDemo(create(DeviceType.MacOsDesktop, { trusted: true }))).toBe(
      "practice",
    );
  });

  it("names the shortcut keys in the interface language and where Vowkey lives per desktop", () => {
    const words = { vkObKeyCtrl: "Strg", vkObKeyShift: "Umschalt", vkObKeySpace: "Leertaste" };
    const win = create(DeviceType.WindowsDesktop, { words }).componentInstance as unknown as {
      openKeys(): string[];
      livesKey: string;
    };
    expect(win.openKeys()).toEqual(["Strg", "Umschalt", "Leertaste"]);
    expect(win.livesKey).toBe("vkObLivesTray");
    TestBed.resetTestingModule();
    const linux = create(DeviceType.LinuxDesktop).componentInstance as unknown as {
      livesKey: string;
    };
    expect(linux.livesKey).toBe("vkObLivesLauncher");
    TestBed.resetTestingModule();
    const mac = create(DeviceType.MacOsDesktop, { words }).componentInstance as unknown as {
      openKeys(): string[];
      livesKey: string;
    };
    expect(mac.openKeys()).toEqual(["⌃", "⇧", "Leertaste"]);
    expect(mac.livesKey).toBe("vkObLivesMenuBar");
  });
});
