import { NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  output,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { firstValueFrom, of } from "rxjs";

import { DeviceType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import {
  localizeSampleScenario,
  SAMPLE_SCENARIO_LIST,
  SAMPLE_SCENARIOS,
  SampleScenarioId,
  SampleScenarioSpec,
} from "@vowkey/common/vault/profile/sample-walkthrough";
import { I18nPipe } from "@vowkey/ui-common";

import { NativeMessagingManifestService } from "../services/native-messaging-manifest.service";

import { VowkeyGlyphComponent } from "./vowkey-glyph.component";

export type OnboardingStep = "welcome" | "demo" | "permissions" | "practice" | "ready";

const STEPS: readonly OnboardingStep[] = ["welcome", "demo", "permissions", "practice", "ready"];
const STORAGE_KEY = "vk.onboarding";
/** Focus back from System Settings, still off after this long: an older entry may hold the switch. */
const STALE_RETURN_MS = 2_000;
/** System Settings open beside Vowkey without a focus change, still off after this long. */
const STALE_SIDE_BY_SIDE_MS = 6_000;

interface StoredOnboarding {
  step: OnboardingStep;
  done: boolean;
}

/** The saved onboarding progress, or `null` on a first launch. */
export function readOnboarding(): StoredOnboarding | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && STEPS.includes(raw.step)) {
      return { step: raw.step, done: raw.done === true };
    }
  } catch {
    // A corrupt record starts setup again.
  }
  return null;
}

export function writeOnboarding(value: StoredOnboarding): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

type QuickBarIpc = {
  accessibilityStatus?: () => Promise<boolean>;
  showAccessibilityGuide?: (template: string) => Promise<boolean>;
  resetAccessibility?: () => Promise<boolean>;
  relaunch?: () => Promise<void>;
};

function quickBarIpc(): QuickBarIpc | undefined {
  return (globalThis as { ipc?: { quickBar?: QuickBarIpc } }).ipc?.quickBar;
}

/** Keystrokes for typing `value` by hand, with one swapped-letter typo fixed by two backspaces. */
export function typingFrames(value: string, typo: boolean): string[] {
  const chars = Array.from(value);
  const frames: string[] = [];
  const at = typo && chars.length > 4 ? Math.min(3, chars.length - 2) : -1;
  for (let i = 0; i < chars.length; i++) {
    if (i === at) {
      const base = chars.slice(0, i).join("");
      frames.push(base + chars[i + 1], base + chars[i + 1] + chars[i], base + chars[i + 1], base);
    }
    frames.push(chars.slice(0, i + 1).join(""));
  }
  return frames;
}

/**
 * The by-hand half of the demo: the first three fields typed key by key, the first and third with
 * a typo fixed on the spot. The demo's verdict ("two typos") counts on exactly two.
 */
export function handTypingPlan(values: readonly string[]): string[][] {
  return values.slice(0, 3).map((value, i) => typingFrames(value, i !== 1));
}

export type DesktopOs = "mac" | "win" | "linux";

export function platformOf(device: DeviceType): DesktopOs {
  return device === DeviceType.MacOsDesktop
    ? "mac"
    : device === DeviceType.LinuxDesktop
      ? "linux"
      : "win";
}

type DemoPhase = "hand" | "fill" | "verdict";
type AxState = "off" | "waiting" | "stale" | "restart" | "on";

/** First-run setup: what Vowkey does, the access it needs, a practice fill, and where it lives. */
@Component({
  selector: "vk-onboarding",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, I18nPipe, VowkeyGlyphComponent],
  template: `
    <div
      class="ob"
      [class.mac]="os === 'mac'"
      [class.win]="os === 'win'"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="'vkObAria' | i18n"
    >
      <header class="ob-top">
        @if (step() === "demo" || step() === "practice") {
          <button type="button" class="ob-skip" data-testid="vk-ob-skip" (click)="next()">
            {{ "vkObSkip" | i18n }}
          </button>
        }
      </header>

      <main class="ob-stage" [attr.data-step]="step()">
        @switch (step()) {
          @case ("welcome") {
            <div class="ob-hero">
              <ng-container *ngTemplateOutlet="mark" />
              <h1>{{ "vkObWelcomeTitle" | i18n }}</h1>
              <p class="ob-sub">{{ "vkObWelcomeBody" | i18n }}</p>
              <label class="ob-lang">
                <vk-glyph name="globe" [size]="15" />
                <select
                  data-testid="vk-ob-language"
                  [attr.aria-label]="'vkLanguage' | i18n"
                  [value]="locale()"
                  (change)="setLocale($any($event.target).value)"
                >
                  <option value="">{{ "defaultSystem" | i18n }}</option>
                  @for (option of languages; track option.code) {
                    <option [value]="option.code" [selected]="locale() === option.code">
                      {{ option.label }}
                    </option>
                  }
                </select>
              </label>
              <div class="ob-actions">
                <button type="button" class="ob-primary" data-testid="vk-ob-start" (click)="next()">
                  {{ "vkObGetStarted" | i18n }}
                </button>
              </div>
              <p class="ob-note">{{ "vkObWelcomeLocal" | i18n }}</p>
            </div>
          }

          @case ("demo") {
            <div class="ob-col">
              <div class="ob-versus" role="tablist" [attr.aria-label]="'vkObCompare' | i18n">
                <button
                  type="button"
                  role="tab"
                  [class.on]="demoPhase() === 'hand'"
                  [attr.aria-selected]="demoPhase() === 'hand'"
                  (click)="playDemo('hand')"
                >
                  {{ "vkObByHand" | i18n }}
                </button>
                <button
                  type="button"
                  role="tab"
                  [class.on]="demoPhase() !== 'hand'"
                  [attr.aria-selected]="demoPhase() !== 'hand'"
                  (click)="playDemo('fill')"
                >
                  {{ "vkObWithVowkey" | i18n }}
                </button>
              </div>
              <h1 aria-live="polite">{{ demoTitleKey() | i18n }}</h1>
              <p class="ob-sub">{{ demoBodyKey() | i18n }}</p>

              <div class="ob-card ob-split">
                <ng-container *ngTemplateOutlet="doc; context: { $implicit: demoSpec() }" />
                <div class="ob-form" [class.acting]="demoPhase() !== 'hand'">
                  <div class="ob-form-head">
                    <b>{{ demoSpec().practiceFormTitle }}</b>
                    @if (demoPhase() === "verdict") {
                      <span class="ob-count">{{
                        "vkObFilledCount" | i18n: demoSpec().fields.length
                      }}</span>
                    }
                  </div>
                  @for (field of demoSpec().fields; track field.key; let i = $index) {
                    <div class="ob-field" [class.filled]="demoFilled()[i]">
                      <span>{{ field.practiceFieldLabel }}</span>
                      <div class="ob-input">
                        {{ demoValues()[i] }}
                        @if (demoCaret() === i) {
                          <i class="ob-caret"></i>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>

              <div class="ob-keys" [class.pressed]="keysPressed()" aria-hidden="true">
                @for (key of openKeys(); track key) {
                  <kbd>{{ key }}</kbd>
                }
              </div>

              <div class="ob-actions">
                <button type="button" class="ob-ghost" (click)="playDemo('hand')">
                  {{ "vkObReplay" | i18n }}
                </button>
                <button
                  type="button"
                  class="ob-primary"
                  data-testid="vk-ob-continue"
                  (click)="next()"
                >
                  {{ "vkObContinue" | i18n }} <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          }

          @case ("permissions") {
            <div class="ob-col narrow">
              <h1>{{ (axRow() ? "vkObPermTitle" : "vkObPermBrowserOnlyTitle") | i18n }}</h1>
              <p class="ob-sub">
                {{ (axRow() ? "vkObPermBody" : "vkObPermBrowserOnlyBody") | i18n }}
              </p>

              <div class="ob-card ob-rows">
                @if (axRow()) {
                  <div class="ob-row" data-testid="vk-ob-perm-accessibility">
                    <span class="ob-row-icon"><vk-glyph name="hand" [size]="18" /></span>
                    <div class="ob-row-text">
                      <b>{{ "vkObPermAxTitle" | i18n }}</b>
                      <small>{{ "vkObPermAxBody" | i18n }}</small>
                    </div>
                    @if (ax() === "on") {
                      <span class="ob-done">✓ {{ "vkObAllowed" | i18n }}</span>
                    } @else if (ax() === "restart") {
                      <button type="button" class="ob-btn contrast" (click)="relaunch()">
                        {{ "vkObRestart" | i18n }}
                      </button>
                    } @else {
                      <button
                        type="button"
                        class="ob-btn"
                        data-testid="vk-ob-allow-accessibility"
                        (click)="allowAccessibility()"
                      >
                        {{ (ax() === "off" ? "vkObAllow" : "vkObOpen") | i18n }}
                      </button>
                    }
                  </div>
                  @if (ax() === "stale") {
                    <div class="ob-row-hint">
                      <span>{{ "vkObStaleHint" | i18n }}</span>
                      <button
                        type="button"
                        class="ob-link"
                        data-testid="vk-ob-fix"
                        (click)="fixAccessibility()"
                      >
                        {{ "vkObStaleFix" | i18n }}
                      </button>
                    </div>
                  }
                  @if (ax() === "restart") {
                    <div class="ob-row-hint">
                      <span>{{ "vkObRestartHint" | i18n }}</span>
                    </div>
                  }
                }

                @if (browserRow()) {
                  <div class="ob-row" data-testid="vk-ob-perm-browser">
                    <span class="ob-row-icon"><vk-glyph name="globe" [size]="18" /></span>
                    <div class="ob-row-text">
                      <b>{{ "vkObPermBrowserTitle" | i18n }}</b>
                      <small>{{ "vkObPermBrowserBody" | i18n }}</small>
                    </div>
                    @if (browserReady()) {
                      <span class="ob-done">✓ {{ "vkObConnected" | i18n }}</span>
                    } @else {
                      <button type="button" class="ob-btn" (click)="connectBrowser()">
                        {{ "vkObConnect" | i18n }}
                      </button>
                    }
                  </div>
                }
              </div>

              <div class="ob-actions">
                @if (axRow() && ax() !== "on") {
                  <button type="button" class="ob-ghost" data-testid="vk-ob-later" (click)="next()">
                    {{ "vkObSetUpLater" | i18n }}
                  </button>
                }
                <button
                  type="button"
                  class="ob-primary"
                  data-testid="vk-ob-continue"
                  [disabled]="axRow() && ax() !== 'on'"
                  (click)="next()"
                >
                  {{ "vkObContinue" | i18n }} <span aria-hidden="true">→</span>
                </button>
              </div>
            </div>
          }

          @case ("practice") {
            <div class="ob-col">
              <h1>{{ "vkObTryTitle" | i18n }}</h1>
              <p class="ob-sub">{{ "vkObTryBody" | i18n }}</p>
              <div class="ob-chips" role="radiogroup" [attr.aria-label]="'vkObTryPick' | i18n">
                @for (scenario of scenarios; track scenario.id) {
                  <button
                    type="button"
                    role="radio"
                    [class.on]="practiceId() === scenario.id"
                    [attr.aria-checked]="practiceId() === scenario.id"
                    (click)="pickPractice(scenario.id)"
                  >
                    <vk-glyph name="document" [size]="14" />{{ sampleLabelKey(scenario.id) | i18n }}
                  </button>
                }
              </div>

              <div class="ob-card ob-split">
                <ng-container *ngTemplateOutlet="doc; context: { $implicit: practiceSpec() }" />
                <div class="ob-form" [class.acting]="practiceFilled()">
                  <div class="ob-form-head">
                    <b>{{ practiceSpec().practiceFormTitle }}</b>
                    <button
                      type="button"
                      class="ob-fill"
                      data-testid="vk-ob-practice-fill"
                      (click)="fillPractice()"
                    >
                      {{ "vkObTryFill" | i18n }} <kbd>{{ fillKeyHint() }}</kbd>
                    </button>
                  </div>
                  @for (field of practiceSpec().fields; track field.key; let i = $index) {
                    <div class="ob-field" [class.filled]="practiceShown() > i">
                      <span>{{ field.practiceFieldLabel }}</span>
                      <div class="ob-input">
                        {{ practiceShown() > i ? field.practiceFillValue : "" }}
                      </div>
                    </div>
                  }
                  <div class="ob-field human" [class.ask]="practiceFilled()">
                    <span>
                      {{ practiceSpec().humanFieldLabel }}
                      @if (practiceFilled()) {
                        <em>{{ "vkWtNeedsYou" | i18n }}</em>
                      }
                    </span>
                    <input type="text" [placeholder]="practiceSpec().humanFieldPlaceholder" />
                  </div>
                </div>
              </div>
              <p class="ob-status" aria-live="polite">
                @if (practiceFilled()) {
                  {{ "vkObTryFilled" | i18n: practiceSpec().fields.length }}
                }
              </p>

              <div class="ob-actions">
                <button type="button" class="ob-primary" data-testid="vk-ob-done" (click)="next()">
                  {{ "vkObDone" | i18n }}
                </button>
              </div>
            </div>
          }

          @case ("ready") {
            <div class="ob-hero">
              <ng-container *ngTemplateOutlet="mark; context: { $implicit: true }" />
              <h1>{{ "vkObReadyTitle" | i18n }}</h1>
              <dl class="ob-legend">
                <div>
                  <dt>
                    @for (key of openKeys(); track key) {
                      <kbd>{{ key }}</kbd>
                    }
                  </dt>
                  <dd>{{ "vkObReadyShortcutOpen" | i18n }}</dd>
                </div>
                <div>
                  <dt>
                    @for (key of fillKeys(); track key) {
                      <kbd>{{ key }}</kbd>
                    }
                  </dt>
                  <dd>{{ "vkObReadyShortcutFill" | i18n }}</dd>
                </div>
              </dl>
              <span class="ob-pill">{{ livesKey | i18n }}</span>
              <div class="ob-actions">
                <button type="button" class="ob-ghost" (click)="go('practice')">
                  {{ "vkObTryAgain" | i18n }}
                </button>
                <button
                  type="button"
                  class="ob-primary"
                  data-testid="vk-ob-finish"
                  (click)="finish()"
                >
                  {{ "vkObStart" | i18n }}
                </button>
              </div>
            </div>
          }
        }
      </main>
    </div>

    <ng-template #mark let-glow>
      <svg class="ob-mark" [class.glow]="glow" viewBox="0 0 120 120" aria-hidden="true">
        <path
          d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1"
          fill="none"
          stroke="currentColor"
          stroke-width="7"
          stroke-linecap="round"
        />
        <rect x="31" y="28" width="34" height="23" rx="5" class="blue" />
        <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff" />
        <g fill="currentColor">
          <circle cx="35" cy="65" r="5" />
          <circle cx="51" cy="65" r="5" />
          <circle cx="67" cy="65" r="5" />
        </g>
        <rect x="80" y="54" width="5.5" height="22" rx="2.75" class="blue" />
      </svg>
    </ng-template>

    <ng-template #doc let-spec>
      <figure class="ob-doc" aria-hidden="true">
        <div class="ob-doc-band" [style.background]="spec.headerBandColor">
          <b>{{ spec.headerAuthority }}</b>
          <small>{{ spec.headerSubtitle }}</small>
        </div>
        <dl>
          @for (field of spec.fields; track field.key) {
            <div>
              <dt>{{ field.printedLabel }}</dt>
              <dd>{{ field.value }}</dd>
            </div>
          }
        </dl>
        @if (spec.footerLine1) {
          <code>{{ spec.footerLine1 }}<br />{{ spec.footerLine2 }}</code>
        }
      </figure>
    </ng-template>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 3000;
        display: block;
      }
      .ob {
        display: grid;
        grid-template-rows: 52px 1fr;
        height: 100%;
        background: var(--vk-canvas);
        color: var(--vk-ink);
        font-family: var(--font-sans);
      }
      .ob-top {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        padding: 0 20px;
        -webkit-app-region: drag;
      }
      .ob.win {
        grid-template-rows: 56px 1fr;
      }
      /* Windows draws its caption buttons over a 56px band the colour of the app's toolbar. */
      .ob.win .ob-top {
        padding-right: calc(
          100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)) + 16px
        );
        border-bottom: 1px solid var(--vk-line);
        background: var(--vk-window);
      }
      .ob-top button,
      .ob select,
      .ob button,
      .ob input {
        -webkit-app-region: no-drag;
      }
      .ob-skip {
        padding: 6px 10px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      .ob-skip:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .ob-stage {
        display: grid;
        place-items: center;
        min-height: 0;
        padding: 0 32px 40px;
        overflow-y: auto;
      }
      .ob-hero,
      .ob-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: min(760px, 100%);
        text-align: center;
        animation: ob-in 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
      }
      .ob-col.narrow {
        width: min(500px, 100%);
      }
      @keyframes ob-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
      }
      h1 {
        margin: 0;
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.15;
      }
      .ob-sub {
        max-width: 520px;
        margin: 10px 0 0;
        color: var(--vk-muted);
        font-size: 15px;
        line-height: 1.5;
      }
      .ob-note {
        margin: 18px 0 0;
        color: var(--vk-faint);
        font-size: 12.5px;
      }
      .ob-mark {
        width: 76px;
        height: 76px;
        margin-bottom: 22px;
        padding: 8px;
        border: 1px solid var(--vk-line);
        border-radius: 20px;
        background: var(--vk-card);
        color: var(--vk-ink);
        box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
      }
      .ob-mark .blue {
        fill: var(--vk-blue);
      }
      .ob-mark.glow {
        box-shadow:
          0 0 0 6px var(--vk-blue-soft),
          0 10px 30px -10px var(--vk-blue);
      }
      .ob-lang {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 22px;
        padding: 0 4px 0 12px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-card);
        color: var(--vk-muted);
      }
      .ob-lang select {
        height: 32px;
        border: 0;
        background: transparent;
        color: var(--vk-ink);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      .ob-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 26px;
      }
      .ob-primary,
      .ob-ghost {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 40px;
        padding: 0 20px;
        border-radius: 10px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }
      .ob-primary {
        border: 1px solid var(--vk-ink);
        background: var(--vk-ink);
        color: var(--vk-paper);
      }
      .ob-primary:disabled {
        opacity: 0.35;
        cursor: default;
      }
      .ob-ghost {
        border: 1px solid var(--vk-line);
        background: var(--vk-card);
        color: var(--vk-ink);
      }
      .ob-ghost:hover {
        background: var(--vk-hover);
      }
      .ob button:focus-visible,
      .ob select:focus-visible,
      .ob input:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: 2px;
      }
      .ob-versus {
        display: inline-grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px;
        margin-bottom: 18px;
        padding: 3px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-card);
      }
      .ob-versus button {
        padding: 5px 14px;
        border: 0;
        border-radius: 999px;
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .ob-versus button.on {
        background: var(--vk-selected);
        color: var(--vk-ink);
      }
      .ob-card {
        width: 100%;
        margin-top: 24px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-panel);
        background: var(--vk-card);
        box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
        text-align: left;
      }
      .ob-split {
        display: grid;
        grid-template-columns: 0.9fr 1.1fr;
        gap: 18px;
        padding: 18px;
      }
      .ob-doc {
        margin: 0;
        overflow: hidden;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        background: var(--vk-paper);
      }
      .ob-doc-band {
        display: grid;
        gap: 1px;
        padding: 8px 12px;
        color: #fff;
      }
      .ob-doc-band b {
        font-size: 10px;
        letter-spacing: 0.06em;
      }
      .ob-doc-band small {
        font-size: 8.5px;
        opacity: 0.8;
      }
      .ob-doc dl {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 12px;
        margin: 0;
        padding: 12px;
      }
      .ob-doc dt {
        color: var(--vk-faint);
        font-size: 8.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
      .ob-doc dd {
        margin: 1px 0 0;
        font-size: 12px;
        font-weight: 600;
      }
      .ob-doc code {
        display: block;
        padding: 8px 12px;
        overflow: hidden;
        border-top: 1px solid var(--vk-line);
        color: var(--vk-muted);
        font-family: var(--font-mono, monospace);
        font-size: 9px;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }
      .ob-form {
        display: grid;
        grid-template-columns: 1fr 1fr;
        align-content: start;
        gap: 10px 12px;
      }
      .ob-form-head {
        display: flex;
        grid-column: 1 / -1;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-height: 30px;
        font-size: 13.5px;
      }
      .ob-count {
        color: var(--vk-blue);
        font-size: 12px;
        font-weight: 600;
      }
      .ob-field {
        display: grid;
        gap: 4px;
        min-width: 0;
      }
      .ob-field > span {
        display: flex;
        gap: 6px;
        align-items: center;
        color: var(--vk-muted);
        font-size: 11.5px;
        font-weight: 500;
      }
      .ob-input,
      .ob-field input {
        display: flex;
        align-items: center;
        height: 32px;
        min-width: 0;
        padding: 0 9px;
        overflow: hidden;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-window);
        color: var(--vk-ink);
        font: inherit;
        font-size: 13px;
        white-space: nowrap;
        transition:
          border-color 0.18s ease,
          background-color 0.18s ease;
      }
      .ob-field.filled .ob-input {
        border-color: var(--vk-blue);
        background: var(--vk-blue-soft);
        animation: ob-pop 0.24s ease;
      }
      @keyframes ob-pop {
        from {
          transform: scale(0.98);
        }
      }
      .ob-field.human {
        grid-column: 1 / -1;
      }
      .ob-field.human.ask input {
        border-color: var(--vk-amber);
      }
      .ob-field em {
        color: var(--vk-amber);
        font-style: normal;
        font-weight: 600;
      }
      .ob-caret {
        display: inline-block;
        width: 1.5px;
        height: 15px;
        margin-left: 1px;
        background: var(--vk-ink);
        animation: ob-blink 1s steps(2) infinite;
      }
      @keyframes ob-blink {
        50% {
          opacity: 0;
        }
      }
      .ob-keys {
        display: flex;
        gap: 6px;
        margin-top: 18px;
        opacity: 0.55;
        transition: opacity 0.2s ease;
      }
      .ob-keys.pressed {
        opacity: 1;
      }
      kbd {
        display: inline-grid;
        place-items: center;
        min-width: 30px;
        height: 30px;
        padding: 0 8px;
        border: 1px solid var(--vk-line);
        border-bottom-width: 2px;
        border-radius: 7px;
        background: var(--vk-card);
        color: var(--vk-ink);
        font-family: var(--font-sans);
        font-size: 13px;
        font-weight: 600;
        transition: all 0.12s ease;
      }
      .ob-keys.pressed kbd {
        border-color: var(--vk-blue);
        border-bottom-width: 1px;
        background: var(--vk-blue-soft);
        color: var(--vk-blue-ink);
        transform: translateY(1px);
      }
      .ob-rows {
        padding: 6px 0;
      }
      .ob-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        cursor: default;
      }
      .ob-row + .ob-row,
      .ob-row-hint + .ob-row {
        border-top: 1px solid var(--vk-line-soft);
      }
      .ob-row-icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 9px;
        background: var(--vk-hover);
      }
      .ob-row-text {
        display: grid;
        flex: 1;
        gap: 2px;
        min-width: 0;
      }
      .ob-row-text b {
        font-size: 14px;
        font-weight: 600;
      }
      .ob-row-text small {
        color: var(--vk-muted);
        font-size: 12.5px;
        line-height: 1.4;
      }
      .ob-btn {
        flex: none;
        height: 30px;
        padding: 0 14px;
        border: 1px solid var(--vk-line);
        border-radius: 8px;
        background: var(--vk-card);
        color: var(--vk-ink);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .ob-btn:hover {
        background: var(--vk-hover);
      }
      .ob-btn.contrast {
        border-color: var(--vk-ink);
        background: var(--vk-ink);
        color: var(--vk-paper);
      }
      .ob-done {
        flex: none;
        color: var(--vk-green);
        font-size: 13px;
        font-weight: 600;
      }
      .ob-row-hint {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: -4px 18px 12px 66px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--vk-amber-soft);
        color: var(--vk-amber);
        font-size: 12.5px;
      }
      .ob-link {
        flex: none;
        padding: 0;
        border: 0;
        background: none;
        color: var(--vk-ink);
        font: inherit;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .ob-chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
        margin-top: 18px;
      }
      .ob-chips button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 12px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-card);
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .ob-chips button.on {
        border-color: var(--vk-ink);
        background: var(--vk-selected);
        color: var(--vk-ink);
      }
      .ob-fill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 6px 0 14px;
        border: 0;
        border-radius: 8px;
        background: var(--vk-blue);
        color: #fff;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .ob-fill kbd {
        min-width: 0;
        height: 20px;
        padding: 0 5px;
        border: 0;
        background: rgb(255 255 255 / 20%);
        color: #fff;
        font-size: 11px;
      }
      .ob-status {
        min-height: 20px;
        margin: 12px 0 0;
        color: var(--vk-muted);
        font-size: 13px;
      }
      .ob-legend {
        display: grid;
        grid-template-columns: auto auto;
        align-items: center;
        gap: 10px 14px;
        margin: 22px 0 0;
      }
      .ob-legend div {
        display: contents;
      }
      .ob-legend dt {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
      }
      .ob-legend dd {
        margin: 0;
        color: var(--vk-muted);
        font-size: 14px;
        text-align: left;
      }
      .ob-pill {
        margin-top: 22px;
        padding: 5px 12px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-card);
        color: var(--vk-muted);
        font-size: 12.5px;
        font-weight: 500;
      }
      @media (max-width: 760px) {
        .ob-split {
          grid-template-columns: 1fr;
        }
        .ob-doc dl {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .ob-doc code {
          display: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .ob-hero,
        .ob-col,
        .ob-field.filled .ob-input,
        .ob-caret {
          animation: none;
        }
      }
    `,
  ],
})
export class VowkeyOnboardingComponent implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private readonly ngZone = inject(NgZone);
  private readonly platformUtils = inject(PlatformUtilsService);
  private readonly manifestService = inject(NativeMessagingManifestService, { optional: true });

  readonly finished = output<void>();

  protected readonly os = platformOf(this.platformUtils.getDevice());
  protected readonly mac = this.os === "mac";
  /** Where Vowkey stays between uses: the macOS menu bar, the Windows tray, the Linux app launcher. */
  protected readonly livesKey =
    this.os === "mac"
      ? "vkObLivesMenuBar"
      : this.os === "win"
        ? "vkObLivesTray"
        : "vkObLivesLauncher";
  protected readonly scenarios = SAMPLE_SCENARIO_LIST;
  protected readonly languages = [
    { code: "en", label: "English" },
    { code: "vi", label: "Tiếng Việt" },
    { code: "ja", label: "日本語" },
    { code: "ko", label: "한국어" },
    { code: "zh-CN", label: "简体中文" },
    { code: "zh-TW", label: "繁體中文" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "pt-BR", label: "Português (Brasil)" },
  ];

  protected readonly step = signal<OnboardingStep>(readOnboarding()?.step ?? "welcome");
  protected readonly locale = signal("");
  /** Key names follow the interface language: Strg on a German keyboard, スペース in Japanese. */
  private readonly activeLocale = toSignal(this.i18n.locale$ ?? of(""), { initialValue: "" });
  protected readonly openKeys = computed(() => {
    this.activeLocale();
    const space = this.i18n.t("vkObKeySpace");
    return this.mac
      ? ["⌃", "⇧", space]
      : [this.i18n.t("vkObKeyCtrl"), this.i18n.t("vkObKeyShift"), space];
  });
  protected readonly fillKeys = computed(() => {
    this.activeLocale();
    return this.mac ? ["⌘", "\\"] : [this.i18n.t("vkObKeyCtrl"), "\\"];
  });
  protected readonly fillKeyHint = computed(() => {
    this.activeLocale();
    return this.mac ? "⌘↵" : `${this.i18n.t("vkObKeyCtrl")}+↵`;
  });

  protected readonly demoSpec = signal<SampleScenarioSpec>(this.localized("passport"));
  protected readonly demoPhase = signal<DemoPhase>("hand");
  protected readonly demoValues = signal<string[]>([]);
  protected readonly demoFilled = signal<boolean[]>([]);
  protected readonly demoCaret = signal(-1);
  protected readonly keysPressed = signal(false);
  protected readonly demoTitleKey = computed(() =>
    this.demoPhase() === "hand"
      ? "vkObDemoHandTitle"
      : this.demoPhase() === "fill"
        ? "vkObDemoFillTitle"
        : "vkObDemoVerdictTitle",
  );
  protected readonly demoBodyKey = computed(() =>
    this.demoPhase() === "hand"
      ? "vkObDemoHandBody"
      : this.demoPhase() === "fill"
        ? "vkObDemoFillBody"
        : "vkObDemoVerdictBody",
  );

  protected readonly ax = signal<AxState>("off");
  protected readonly browserReady = signal(false);
  /** A row appears once its access is seen missing and stays, showing ✓, until setup ends. */
  protected readonly axRow = signal(false);
  protected readonly browserRow = signal(false);
  private readonly accessFlow = { openedSettingsAt: 0, fixAttempted: false };

  protected readonly practiceId = signal<SampleScenarioId>("passport");
  protected readonly practiceSpec = computed(() => this.localized(this.practiceId()));
  protected readonly practiceShown = signal(0);
  protected readonly practiceFilled = signal(false);

  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly handles: {
    axPoll: ReturnType<typeof setInterval> | null;
    stale: ReturnType<typeof setTimeout> | null;
  } = { axPoll: null, stale: null };
  private readonly reducedMotion =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  private readonly onFocus = () => {
    void this.refreshAccessibility();
    if (this.accessFlow.openedSettingsAt > 0 && this.ax() === "waiting") {
      this.armStale(STALE_RETURN_MS);
    }
  };

  constructor() {
    window.addEventListener("focus", this.onFocus);
    void this.resume();
    void firstValueFrom(this.i18n.userSetLocale$)
      .then((code) => this.locale.set(code ?? ""))
      .catch(() => this.locale.set(""));
  }

  /** Setup left on the permissions page passes it when nothing there needs the person any more. */
  private async resume(): Promise<void> {
    if (this.step() === "permissions" && (await this.setupReady())) {
      this.go("practice");
      return;
    }
    this.enter(this.step());
  }

  ngOnDestroy(): void {
    window.removeEventListener("focus", this.onFocus);
    this.clearTimers();
    this.stopAxPoll();
  }

  @HostListener("window:keydown", ["$event"])
  protected onKey(event: KeyboardEvent): void {
    if (this.step() === "practice" && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.fillPractice();
    }
  }

  protected async next(): Promise<void> {
    const index = STEPS.indexOf(this.step());
    const target = STEPS[Math.min(index + 1, STEPS.length - 1)];
    if (target === "permissions" && (await this.setupReady())) {
      this.go("practice");
      return;
    }
    this.go(target);
  }

  protected go(step: OnboardingStep): void {
    this.clearTimers();
    this.step.set(step);
    writeOnboarding({ step, done: false });
    this.enter(step);
  }

  protected finish(): void {
    writeOnboarding({ step: "ready", done: true });
    this.finished.emit();
  }

  private enter(step: OnboardingStep): void {
    if (step !== "permissions") {
      this.stopAxPoll();
    }
    if (step === "demo") {
      this.demoSpec.set(this.localized("passport"));
      this.playDemo("hand");
    } else if (step === "permissions") {
      void this.setupReady();
      this.handles.axPoll = setInterval(() => void this.refreshAccessibility(), 1_000);
    } else if (step === "practice") {
      this.practiceShown.set(0);
      this.practiceFilled.set(false);
    }
  }

  // Welcome

  protected async setLocale(code: string): Promise<void> {
    this.locale.set(code);
    await this.i18n.setLocale(code || null);
    this.demoSpec.set(this.localized("passport"));
  }

  // Demo: typed by hand, then filled by Vowkey.

  protected playDemo(from: "hand" | "fill"): void {
    this.clearTimers();
    const fields = this.demoSpec().fields;
    this.demoValues.set(fields.map(() => ""));
    this.demoFilled.set(fields.map(() => false));
    this.keysPressed.set(false);
    this.demoCaret.set(-1);

    if (this.reducedMotion) {
      this.demoPhase.set("verdict");
      this.demoValues.set(fields.map((f) => f.practiceFillValue));
      this.demoFilled.set(fields.map(() => true));
      return;
    }

    let at = 0;
    const later = (ms: number, fn: () => void) => {
      at += ms;
      this.timers.push(setTimeout(() => this.ngZone.run(fn), at));
    };

    if (from === "hand") {
      this.demoPhase.set("hand");
      // Three fields by hand, two of them with a typo to fix, then the rest is left to Vowkey.
      handTypingPlan(fields.map((f) => f.practiceFillValue)).forEach((frames, i) => {
        later(380, () => this.demoCaret.set(i));
        for (const frame of frames) {
          later(85, () => this.demoValues.update((v) => v.map((x, j) => (j === i ? frame : x))));
        }
      });
      later(900, () => {
        this.demoCaret.set(-1);
        this.demoValues.set(fields.map(() => ""));
      });
    }

    later(from === "hand" ? 250 : 120, () => {
      this.demoPhase.set("fill");
      this.keysPressed.set(true);
    });
    later(260, () => this.keysPressed.set(false));
    fields.forEach((field, i) =>
      later(70, () => {
        this.demoValues.update((v) => v.map((x, j) => (j === i ? field.practiceFillValue : x)));
        this.demoFilled.update((v) => v.map((x, j) => (j === i ? true : x)));
      }),
    );
    later(700, () => this.demoPhase.set("verdict"));
  }

  // Permissions

  /**
   * Whether the permissions page has nothing for the person to do. macOS needs Accessibility to type
   * into other apps; Windows and Linux ask for nothing, so only a browser connection that failed to
   * set itself up brings the page up there.
   */
  private async setupReady(): Promise<boolean> {
    let axReady = true;
    if (this.mac) {
      const status = quickBarIpc()?.accessibilityStatus;
      axReady = status ? await status().catch(() => false) : true;
    }
    let browserReady = true;
    try {
      browserReady = this.manifestService
        ? (await this.manifestService.generate(true)) == null
        : true;
    } catch {
      browserReady = false;
    }
    this.ngZone.run(() => {
      if (axReady) {
        this.ax.set("on");
      } else {
        this.axRow.set(true);
        if (this.ax() === "on") {
          this.ax.set("off");
        }
      }
      this.browserReady.set(browserReady);
      if (!browserReady) {
        this.browserRow.set(true);
      }
    });
    return axReady && browserReady;
  }

  private async refreshAccessibility(): Promise<void> {
    if (!this.mac) {
      this.ax.set("on");
      return;
    }
    const status = quickBarIpc()?.accessibilityStatus;
    if (!status) {
      return;
    }
    const trusted = await status().catch(() => false);
    this.ngZone.run(() => {
      if (trusted) {
        this.ax.set("on");
        this.clearStale();
      }
    });
  }

  protected async allowAccessibility(): Promise<void> {
    const ipc = quickBarIpc();
    if (!ipc?.showAccessibilityGuide) {
      return;
    }
    const template = this.i18n.t("vkObGuideDrag");
    const granted = await ipc.showAccessibilityGuide(template).catch(() => false);
    this.ngZone.run(() => {
      if (granted) {
        this.ax.set("on");
        return;
      }
      if (this.ax() === "off") {
        this.ax.set("waiting");
      }
      this.accessFlow.openedSettingsAt = Date.now();
      this.armStale(STALE_SIDE_BY_SIDE_MS);
    });
  }

  protected async fixAccessibility(): Promise<void> {
    const ipc = quickBarIpc();
    const trusted = await ipc?.resetAccessibility?.().catch(() => false);
    this.ngZone.run(() => {
      if (trusted) {
        this.ax.set("on");
        return;
      }
      this.accessFlow.fixAttempted = true;
      this.ax.set("waiting");
      void this.allowAccessibility();
    });
  }

  protected relaunch(): void {
    writeOnboarding({ step: "permissions", done: false });
    void quickBarIpc()?.relaunch?.();
  }

  private armStale(ms: number): void {
    this.clearStale();
    this.handles.stale = setTimeout(() => {
      void (async () => {
        await this.refreshAccessibility();
        this.ngZone.run(() => {
          if (this.ax() !== "on") {
            this.ax.set(this.accessFlow.fixAttempted ? "restart" : "stale");
          }
        });
      })();
    }, ms);
  }

  private clearStale(): void {
    if (this.handles.stale != null) {
      clearTimeout(this.handles.stale);
      this.handles.stale = null;
    }
  }

  protected async connectBrowser(): Promise<void> {
    try {
      const err = await this.manifestService?.generate(true);
      if (err) {
        throw err;
      }
      this.browserReady.set(true);
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  // Practice

  protected pickPractice(id: SampleScenarioId): void {
    this.clearTimers();
    this.practiceId.set(id);
    this.practiceShown.set(0);
    this.practiceFilled.set(false);
  }

  protected fillPractice(): void {
    this.clearTimers();
    const count = this.practiceSpec().fields.length;
    if (this.reducedMotion) {
      this.practiceShown.set(count);
      this.practiceFilled.set(true);
      return;
    }
    this.practiceShown.set(0);
    this.practiceFilled.set(false);
    for (let i = 1; i <= count; i++) {
      this.timers.push(setTimeout(() => this.ngZone.run(() => this.practiceShown.set(i)), i * 70));
    }
    this.timers.push(
      setTimeout(() => this.ngZone.run(() => this.practiceFilled.set(true)), count * 70 + 120),
    );
  }

  protected sampleLabelKey(id: SampleScenarioId): string {
    return id === "idcard"
      ? "vkSampleIdCard"
      : id === "residence"
        ? "vkSampleResidence"
        : "vkSamplePassport";
  }

  private localized(id: SampleScenarioId): SampleScenarioSpec {
    return (
      localizeSampleScenario(SAMPLE_SCENARIOS[id], (key) => this.i18n.t(key)) ??
      SAMPLE_SCENARIOS[id]
    );
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers.length = 0;
  }

  private stopAxPoll(): void {
    if (this.handles.axPoll != null) {
      clearInterval(this.handles.axPoll);
      this.handles.axPoll = null;
    }
    this.clearStale();
  }
}
