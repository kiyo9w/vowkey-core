import { A11yModule } from "@angular/cdk/a11y";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  NgZone,
  OnDestroy,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { filter, firstValueFrom, map, startWith, Subscription } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ClearClipboardDelay } from "@vowkey/common/autofill/constants";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { ClearClipboardDelaySetting } from "@vowkey/common/autofill/types";
import { EntitlementService, planNameKey } from "@vowkey/common/billing/services/entitlement.service";
import { DeviceType } from "@vowkey/common/enums";
import { VaultTimeoutSettingsService } from "@vowkey/common/key-management/vault-timeout";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { syncServerAnswers } from "@vowkey/common/platform/misc/sync-server";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { Theme, ThemeTypes } from "@vowkey/common/platform/enums/theme-type.enum";
import { ThemeStateService } from "@vowkey/common/platform/theming/theme-state.service";
import { PrivacySettingsService } from "@vowkey/common/platform/services/privacy-settings.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { PrivacyMode, ProductInference } from "@vowkey/common/vault/local/product-inference";
import { DialogService, MenuModule } from "@vowkey/components";
import { BiometricStateService, BiometricsStatus, KeyService } from "@vowkey/key-management";
import { I18nPipe } from "@vowkey/ui-common";
import { AutoUnlockService } from "@vowkey/unlock";

import {
  DesktopAutofillService,
  PasskeyProviderState,
} from "../../autofill/services/desktop-autofill.service";
import type {
  DecisionModelsState,
  DecisionPreparationState,
} from "../../capture/types/capture";
import { DesktopBiometricsService } from "../../key-management/biometrics/desktop.biometrics.service";
import type {
  AppPresenceMode,
  DesktopShellPreferences,
  QuickBarWindowMode,
} from "../../quick-bar/types";
import { NativeMessagingManifestService } from "../services/native-messaging-manifest.service";

import {
  formatModelBytes,
  VowkeyDecisionPickerComponent,
} from "./vowkey-decision-picker.component";
import { GlyphName, VowkeyGlyphComponent } from "./vowkey-glyph.component";
import { HubSettingsTab, VowkeyHub } from "./vowkey-hub.service";
import { LibraryShow, VowkeyLibrary } from "./vowkey-library.service";
import {
  readOnboarding,
  VowkeyOnboardingComponent,
  writeOnboarding,
} from "./vowkey-onboarding.component";

interface NavEntry {
  show: LibraryShow;
  glyph: GlyphName;
  label: string;
  /** Picks the item's colour, the same one its rows and tiles use in the vault. */
  kind?: string;
}

interface PrivacyChoice {
  mode: PrivacyMode;
  titleKey: string;
  bodyKey: string;
}

interface LanguageOption {
  code: string;
  label: string;
}

const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
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

const PRIVACY_CHOICES: PrivacyChoice[] = [
  {
    mode: "masked",
    titleKey: "vkPrivacySmartTitle",
    bodyKey: "vkPrivacySmartBody",
  },
  {
    mode: "local",
    titleKey: "vkPrivacyLocalTitle",
    bodyKey: "vkPrivacyLocalModelBody",
  },
  {
    mode: "cloud_vision",
    titleKey: "vkPrivacyCloudTitle",
    bodyKey: "vkPrivacyCloudBody",
  },
];

function initials(name: string): string {
  const cleaned = name.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").trim();
  const parts = (cleaned || name)
    .split(/\s+/)
    .map((part) => Array.from(part).find((ch) => /[\p{L}\p{N}]/u.test(ch)) ?? "")
    .filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? "?"];
  return letters.join("").toLocaleUpperCase();
}

/** The Vowkey window: a translucent sidebar beside the page, one place for every destination. */
@Component({
  selector: "vk-shell",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    A11yModule,
    FormsModule,
    RouterLink,
    RouterOutlet,
    I18nPipe,
    MenuModule,
    VowkeyDecisionPickerComponent,
    VowkeyGlyphComponent,
    VowkeyOnboardingComponent,
  ],
  template: `
    <div
      class="vk-window"
      [class.mac]="mac"
      [class.win]="!mac"
      [class.side-collapsed]="sidebarCollapsed()"
      [style.--vk-side-w.px]="sidebarWidth()"
    >
      <aside class="vk-side" [attr.aria-label]="'vkLibrary' | i18n">
        <div class="vk-side-top">
          <button
            type="button"
            class="vk-side-collapse-btn"
            (click)="toggleSidebar()"
            aria-label="Hide sidebar"
            title="Hide sidebar"
            data-testid="vowkey-hide-sidebar"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="1.75" y="2.5" width="12.5" height="11" rx="2.2" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" />
            </svg>
          </button>
        </div>
        <button type="button" class="vk-account" [bitMenuTriggerFor]="accountMenu" [attr.title]="fullAccountName()">
          <span class="vk-avatar" aria-hidden="true">{{ initials() }}</span>
          <span class="vk-account-text">
            <b>{{ name() }}</b>
            @if (isGuest()) {
              <small>{{ "vowkeyLocalVault" | i18n }}</small>
            } @else {
              <small>
                @if (!library.online()) {
                  <span class="vk-sync-dot offline"></span>
                }
                {{ (library.online() ? "vkSynced" : "vkOffline") | i18n }}
              </small>
            }
          </span>
          <vk-glyph name="chevrons" [size]="13" />
        </button>
        <bit-menu #accountMenu>
          <div class="vk-menu">
            @if (isGuest()) {
              @if (syncAvailable()) {
                <button type="button" bitMenuItem (click)="signIn()">
                  <vk-glyph slot="start" name="person" [size]="16" />{{ "vkSignInToSync" | i18n }}
                </button>
              }
              @if (guestHasPassword()) {
                <button type="button" bitMenuItem (click)="lock()">
                  <vk-glyph slot="start" name="lock" [size]="16" />{{ "vkLockVowkey" | i18n
                  }}<kbd slot="end">{{ mac ? "⌘L" : "Ctrl+L" }}</kbd>
                </button>
              }
            } @else {
              <button type="button" bitMenuItem (click)="lock()">
                <vk-glyph slot="start" name="lock" [size]="16" />{{ "vkLockVowkey" | i18n
                }}<kbd slot="end">{{ mac ? "⌘L" : "Ctrl+L" }}</kbd>
              </button>
            }
            <button type="button" bitMenuItem (click)="openSettings()">
              <vk-glyph slot="start" name="gear" [size]="16" />{{ "vkSettings" | i18n
              }}<kbd slot="end">{{ mac ? "⌘," : "Ctrl+," }}</kbd>
            </button>
            <bit-menu-divider />
            <button type="button" bitMenuItem (click)="tool('openGenerator')">
              <vk-glyph slot="start" name="spark" [size]="16" />{{ "generator" | i18n
              }}<kbd slot="end">{{ mac ? "⌘G" : "Ctrl+G" }}</kbd>
            </button>
            <button type="button" bitMenuItem (click)="tool('importVault')">
              <vk-glyph slot="start" name="import" [size]="16" />{{ "importData" | i18n }}
            </button>
            <button type="button" bitMenuItem (click)="tool('exportVault')">
              <vk-glyph slot="start" name="export" [size]="16" />{{ "exportNoun" | i18n }}
            </button>
            @if (!isGuest()) {
              <bit-menu-divider />
              <button type="button" bitMenuItem (click)="logOut()">{{ "vkLogOut" | i18n }}</button>
            }
          </div>
        </bit-menu>

        <nav class="vk-nav" aria-label="Vowkey">
          @for (entry of top; track entry.show) {
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{
                show: entry.show === 'all' ? null : entry.show,
                person: null,
                item: null,
                source: null,
              }"
              [class.on]="isOn(entry.show, null)"
              [attr.data-kind]="entry.kind ?? null"
              [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
            >
              <span class="vk-nav-ico" [attr.data-kind]="entry.kind ?? 'all'" aria-hidden="true">
                <vk-glyph [name]="entry.glyph" [size]="13.5" />
              </span>
              <span class="vk-item-label">{{ entry.label | i18n }}</span>
              @if (entry.show === "profiles" && library.profiles().length > 0) {
                <span class="vk-muted-count">{{ library.profiles().length }}</span>
              }
            </a>
          }

          <h2 class="vk-label">{{ "vkLibrary" | i18n }}</h2>
          @for (entry of library_; track entry.show) {
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{
                show: entry.show === 'all' ? null : entry.show,
                person: null,
                item: null,
                source: null,
              }"
              [class.on]="isOn(entry.show, null)"
              [attr.data-kind]="entry.kind ?? null"
              [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
            >
              <span class="vk-nav-ico" [attr.data-kind]="entry.kind ?? 'all'" aria-hidden="true">
                <vk-glyph [name]="entry.glyph" [size]="13.5" />
              </span>
              <span class="vk-item-label">{{ entry.label | i18n }}</span>
              @if (entry.show === "profiles" && library.profiles().length > 0) {
                <span class="vk-muted-count">{{ library.profiles().length }}</span>
              }
            </a>
          }

          <button
            type="button"
            class="vk-dev-toggle"
            data-testid="vowkey-nav-developer-toggle"
            [attr.aria-expanded]="developerExpanded()"
            (click)="toggleDeveloper()"
          >
            <span>{{ "vkDeveloper" | i18n }}</span>
            @if (developerCount() > 0 && !developerExpanded()) {
              <span class="vk-dev-count">{{ developerCount() }}</span>
            }
            <span class="vk-dev-chevron" [class.open]="developerExpanded()">
              <vk-glyph name="chevron-down" [size]="12" />
            </span>
          </button>
          @if (developerExpanded()) {
            @for (entry of developer_; track entry.show) {
              <a
                class="vk-item"
                routerLink="/vault"
                [queryParams]="{ show: entry.show, person: null, item: null, source: null }"
                [class.on]="isOn(entry.show, null)"
                [attr.data-kind]="entry.kind ?? null"
                [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
              >
                <span class="vk-nav-ico" [attr.data-kind]="entry.kind ?? 'key'" aria-hidden="true">
                  <vk-glyph [name]="entry.glyph" [size]="13.5" />
                </span>
                <span class="vk-item-label">{{ entry.label | i18n }}</span>
              </a>
            }
          }

          @if (library.expiringCount() > 0) {
            <h2 class="vk-label">{{ "vkReminders" | i18n }}</h2>
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{ show: 'expiring', person: null, item: null, source: null }"
              [class.on]="isOn('expiring', null)"
            >
              <span class="vk-nav-ico" data-kind="expiring" aria-hidden="true">
                <vk-glyph name="clock" [size]="13.5" />
              </span>
              <span class="vk-item-label">{{ "vkExpiring" | i18n }}</span>
              <span class="vk-count">{{ library.expiringCount() }}</span>
            </a>
          }

          <h2 class="vk-label">{{ "vkConnected" | i18n }}</h2>
          <a
            class="vk-item"
            routerLink="/agents"
            data-kind="agent"
            [class.on]="url().startsWith('/agents')"
          >
            <span class="vk-nav-ico" data-kind="agent" aria-hidden="true">
              <vk-glyph name="bot" [size]="13.5" />
            </span>
            <span class="vk-item-label">{{ "vkAiAgents" | i18n }}</span>
          </a>
        </nav>

        <div class="vk-foot">
          <a
            class="vk-item"
            routerLink="/vault"
            [queryParams]="{ show: 'trash', person: null, item: null, source: null }"
            [class.on]="isOn('trash', null)"
            data-testid="vowkey-nav-trash"
          >
            <span class="vk-nav-ico" data-kind="trash" aria-hidden="true">
              <vk-glyph name="trash" [size]="13.5" />
            </span>
            <span class="vk-item-label">{{ "vkRecentlyDeleted" | i18n }}</span>
          </a>
          @if (isGuest() && syncAvailable()) {
            <a class="vk-item vk-sync-cta" routerLink="/login" data-testid="vowkey-sign-in-sync">
              <span class="vk-nav-ico" data-kind="sync" aria-hidden="true">
                <vk-glyph name="person" [size]="13.5" />
              </span>
              <span class="vk-item-label">{{ "vkSignInToSync" | i18n }}</span>
            </a>
          }
          <button
            type="button"
            class="vk-item"
            data-testid="vowkey-open-settings"
            (click)="openSettings()"
          >
            <span class="vk-nav-ico" data-kind="settings" aria-hidden="true">
              <vk-glyph name="gear" [size]="13.5" />
            </span>
            <span class="vk-item-label">{{ "vkSettings" | i18n }}</span>
          </button>
        </div>
      </aside>

      <div
        class="vk-side-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        (mousedown)="startSidebarResize($event)"
        (dblclick)="resetSidebarWidth()"
      ></div>

      <main class="vk-main">
        <router-outlet />
      </main>
    </div>

    @if (settingsOpen()) {
      <div class="vk-settings-backdrop" (click)="closeSettings()">
        <div
          class="vk-settings-sheet"
          [cdkTrapFocus]="!decisionPickerOpen()"
          [cdkTrapFocusAutoCapture]="true"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vk-settings-title"
          (click)="$event.stopPropagation()"
        >
          <header class="vk-settings-head">
            <h2 id="vk-settings-title">{{ "vkSettings" | i18n }}</h2>
            <button
              type="button"
              class="vk-settings-close-icon"
              (click)="closeSettings()"
              [attr.aria-label]="'close' | i18n"
            >
              <vk-glyph name="close" [size]="15" />
            </button>
          </header>

          <div class="vk-settings-body">
            @if (mac && !accessibilityTrusted()) {
              <div class="vk-perm-needed" role="alert" data-testid="vowkey-permissions-needed">
                <div class="vk-perm-main">
                  <div>
                    <b>{{ "vkObPermNeededTitle" | i18n }}</b>
                    <small>{{ "vkObPermNeededBody" | i18n }}</small>
                  </div>
                  <button
                    type="button"
                    class="vk-settings-btn primary"
                    (click)="requestAccessibilityPermission()"
                  >
                    {{ "vkObAllow" | i18n }}
                  </button>
                </div>
                <div class="vk-perm-fix">
                  @if (accessibilityFixTried()) {
                    <span>{{ "vkObRestartHint" | i18n }}</span>
                    <button type="button" class="vk-link-btn" (click)="relaunch()">
                      {{ "vkObRestart" | i18n }}
                    </button>
                  } @else {
                    <span>{{ "vkObStaleHint" | i18n }}</span>
                    <button type="button" class="vk-link-btn" (click)="fixAccessibility()">
                      {{ "vkObStaleFix" | i18n }}
                    </button>
                  }
                </div>
              </div>
            }

            <section class="vk-settings-section" id="vk-sec-general">
              <div id="vk-sec-appearance"></div>
              <div class="vk-pref-card">
                <div class="vk-pref-row">
                  <span class="vk-row-title">{{ "theme" | i18n }}</span>
                  <div class="vk-seg" role="radiogroup" [attr.aria-label]="'theme' | i18n">
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="selectedTheme() === themeSystem"
                      [class.on]="selectedTheme() === themeSystem"
                      (click)="onThemeChange(themeSystem)"
                    >
                      {{ systemDefaultLabel() }}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="selectedTheme() === themeLight"
                      [class.on]="selectedTheme() === themeLight"
                      (click)="onThemeChange(themeLight)"
                    >
                      {{ "light" | i18n }}
                    </button>
                    <button
                      type="button"
                      role="radio"
                      [attr.aria-checked]="selectedTheme() === themeDark"
                      [class.on]="selectedTheme() === themeDark"
                      (click)="onThemeChange(themeDark)"
                    >
                      {{ "dark" | i18n }}
                    </button>
                  </div>
                </div>

                <div class="vk-pref-row">
                  <span class="vk-row-title">{{ "vkLanguage" | i18n }}</span>
                  <select
                    class="vk-row-select"
                    data-testid="vowkey-language-select"
                    [attr.aria-label]="'vkLanguage' | i18n"
                    [value]="selectedLocale()"
                    (change)="onLanguageChange($any($event.target).value)"
                  >
                    <option value="" [selected]="selectedLocale() === ''">
                      {{ systemDefaultLabel() }}
                    </option>
                    @for (option of languageOptions; track option.code) {
                      <option [value]="option.code" [selected]="selectedLocale() === option.code">
                        {{ option.label }}
                      </option>
                    }
                  </select>
                </div>
              </div>
            </section>

            <section class="vk-settings-section">
              <h3>{{ (mac ? "vkSettingsQuickBarMac" : "vkSettingsQuickBarWin") | i18n }}</h3>
              <div class="vk-pref-card">
                <div class="vk-pref-row">
                  <div class="vk-row-copy">
                    <span class="vk-row-title">{{ "vkQuickBarWindow" | i18n }}</span>
                  </div>
                  <div
                    class="vk-seg vk-seg-two"
                    role="radiogroup"
                    [attr.aria-label]="'vkQuickBarWindow' | i18n"
                  >
                    <label
                      class="vk-seg-radio"
                      [class.on]="shellPrefs().quickBarMode === 'floating'"
                    >
                      <input
                        type="radio"
                        class="vk-sr-only"
                        name="vkQuickBarMode"
                        [checked]="shellPrefs().quickBarMode === 'floating'"
                        (change)="setQuickBarMode('floating')"
                      />
                      <span>{{ "vkQuickBarFloating" | i18n }}</span>
                    </label>
                    <label
                      class="vk-seg-radio"
                      [class.on]="shellPrefs().quickBarMode === 'popover'"
                    >
                      <input
                        type="radio"
                        class="vk-sr-only"
                        name="vkQuickBarMode"
                        [checked]="shellPrefs().quickBarMode === 'popover'"
                        (change)="setQuickBarMode('popover')"
                      />
                      <span>{{
                        (mac ? "vkQuickBarPopoverMac" : "vkQuickBarPopoverWin") | i18n
                      }}</span>
                    </label>
                  </div>
                </div>

                <div class="vk-pref-row vk-shortcut-row" [attr.aria-label]="'vkGlobalShortcuts' | i18n">
                  <span class="vk-row-title">{{ "vkGlobalShortcuts" | i18n }}</span>
                  <div class="vk-shortcut-pills">
                    <span class="vk-kbd-pair"
                      ><kbd>{{ mac ? "⌃⇧Space" : "Ctrl+Shift+Space" }}</kbd>
                      {{ "vkQuickBar" | i18n }}</span
                    >
                    <span class="vk-kbd-pair"
                      ><kbd>@if (mac) { ⌘&#92; } @else { Ctrl+&#92; }</kbd>
                      {{ "vkShortcutFillWindow" | i18n }}</span
                    >
                  </div>
                </div>
              </div>
            </section>

            <section class="vk-settings-section" id="vk-sec-reading">
              <h3>{{ "vkReadingAndFilling" | i18n }}</h3>
              <div class="vk-pref-card">
                <div
                  class="vk-privacy-list"
                  role="radiogroup"
                  [attr.aria-label]="'vkReadingAndFilling' | i18n"
                >
                  @for (choice of privacyChoices; track choice.mode) {
                    <label class="vk-privacy-option" [class.on]="privacyMode() === choice.mode">
                      <input
                        type="radio"
                        class="vk-sr-only"
                        name="vkPrivacyMode"
                        [checked]="privacyMode() === choice.mode"
                        (change)="selectPrivacyMode(choice.mode)"
                      />
                      <i class="vk-radio-dot" aria-hidden="true"></i>
                      <span class="vk-privacy-copy">
                        <b>{{ choice.titleKey | i18n }}</b>
                        <small>{{ choice.bodyKey | i18n }}</small>
                      </span>
                    </label>
                  }
                </div>

                @if (decisionModels()) {
                  <details
                    class="vk-model-options"
                    [open]="privacyMode() === 'local' || activePreparation() !== null"
                  >
                    <summary>
                      <span>{{ "vkModelSectionLabel" | i18n }}</span>
                      <vk-glyph name="chevron-down" [size]="12" />
                    </summary>
                  <div class="vk-local-model-card" data-testid="vowkey-local-model-card">
                    <div class="vk-local-model-top">
                      <button
                        type="button"
                        class="vk-local-model-picker-btn"
                        data-testid="vowkey-open-model-picker"
                        (click)="openDecisionPicker()"
                      >
                        <span>{{ selectedDecisionModelName() }}</span>
                        <vk-glyph name="chevron-down" [size]="12" />
                      </button>
                    </div>

                    @if (activePreparation(); as prep) {
                      @if (prep.error) {
                        <div class="vk-local-model-err" data-testid="vowkey-model-error">
                          {{ prep.error }}
                        </div>
                        <div class="vk-local-model-actions">
                          <button
                            type="button"
                            class="vk-settings-btn"
                            [class.primary]="privacyMode() === 'local'"
                            data-testid="vowkey-download-model-btn"
                            (click)="downloadDecisionModel()"
                          >
                            {{ "vkModelDownload" | i18n }}
                          </button>
                          <button
                            type="button"
                            class="vk-settings-btn ghost"
                            data-testid="vowkey-import-model-btn"
                            (click)="importDecisionModelFile()"
                          >
                            {{ "vkModelAddFile" | i18n }}
                          </button>
                        </div>
                      } @else {
                        <div class="vk-local-model-progress" data-testid="vowkey-model-progress">
                          <div
                            class="vk-local-model-bar-track"
                            role="progressbar"
                            [attr.aria-valuenow]="preparationPercent(prep)"
                            aria-valuemin="0"
                            aria-valuemax="100"
                          >
                            <div
                              class="vk-local-model-bar-fill"
                              [style.width.%]="preparationPercent(prep)"
                            ></div>
                          </div>
                          <span class="vk-local-model-pct">{{ preparationStatusText(prep) }}</span>
                          <button
                            type="button"
                            class="vk-local-model-cancel"
                            data-testid="vowkey-cancel-download-btn"
                            [attr.aria-label]="'cancel' | i18n"
                            (click)="cancelDecisionDownload()"
                          >
                            <vk-glyph name="close" [size]="13" />
                          </button>
                        </div>
                      }
                    } @else if (isSelectedModelInUse()) {
                      <div class="vk-local-model-active" data-testid="vowkey-model-in-use">
                        <i class="vk-local-model-dot" aria-hidden="true"></i>
                        <span>{{ "vkModelInUseOnDevice" | i18n }}</span>
                      </div>
                    } @else if (selectedDecisionModelInfo()?.ready) {
                      <div class="vk-local-model-foot">
                        <small class="vk-local-model-note">{{ "vkModelDownloadedNote" | i18n }}</small>
                        <div class="vk-local-model-actions">
                          <button
                            type="button"
                            class="vk-settings-btn"
                            data-testid="vowkey-use-model-btn"
                            (click)="useDecisionModel(selectedDecisionModelId())"
                          >
                            {{ "vkModelUse" | i18n }}
                          </button>
                        </div>
                      </div>
                    } @else {
                      <div class="vk-local-model-foot">
                        <small class="vk-local-model-note">{{ selectedModelOfflineHint() }}</small>
                        <div class="vk-local-model-actions">
                          <button
                            type="button"
                            class="vk-settings-btn"
                            [class.primary]="privacyMode() === 'local'"
                            data-testid="vowkey-download-model-btn"
                            (click)="downloadDecisionModel()"
                          >
                            {{ "vkModelDownload" | i18n }}
                          </button>
                          <button
                            type="button"
                            class="vk-settings-btn ghost"
                            data-testid="vowkey-import-model-btn"
                            (click)="importDecisionModelFile()"
                          >
                            {{ "vkModelAddFile" | i18n }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                  </details>
                }
              </div>
            </section>

            <section class="vk-settings-section" id="vk-sec-security">
              <div id="vk-sec-integrations"></div>
              <h3>{{ "security" | i18n }}</h3>
              <div class="vk-pref-card">
                @if (!isGuest()) {
                  <label class="vk-pref-row vk-clickable-row">
                    <span class="vk-row-title">{{
                      (mac ? "unlockWithTouchId" : "unlockWithWindowsHello") | i18n
                    }}</span>
                    <span class="vk-switch">
                      <input
                        type="checkbox"
                        class="vk-sr-only"
                        data-testid="settings-biometric-checkbox"
                        [checked]="biometricEnabled()"
                        [disabled]="biometricBusy()"
                        (change)="onToggleBiometric($any($event.target).checked)"
                      />
                      <i class="vk-switch-track" aria-hidden="true"></i>
                    </span>
                  </label>
                } @else {
                  <div class="vk-local-pw-box">
                    <div class="vk-pref-row vk-no-border">
                      <div class="vk-row-copy">
                        <span class="vk-row-title">{{ "vkLocalPasswordTitle" | i18n }}</span>
                        <small>{{
                          (guestHasPassword() ? "vkLocalPasswordSetDesc" : "vkLocalPasswordNoneDesc")
                            | i18n
                        }}</small>
                      </div>
                      @if (guestHasPassword()) {
                        <button type="button" class="vk-settings-btn" (click)="lock()">
                          {{ "vkLockVowkey" | i18n }}
                        </button>
                      }
                    </div>
                    <form
                      class="vk-inline-pw-form"
                      (submit)="$event.preventDefault(); saveGuestPassword()"
                    >
                      <input
                        type="password"
                        class="vk-pw-input"
                        name="guestPassword"
                        [ngModel]="guestPasswordDraft()"
                        (ngModelChange)="guestPasswordDraft.set($event)"
                        [placeholder]="
                          (guestHasPassword()
                            ? 'vkChangeLocalPasswordPlaceholder'
                            : 'vkSetLocalPasswordPlaceholder') | i18n
                        "
                        autocomplete="new-password"
                      />
                      <button
                        type="submit"
                        class="vk-settings-btn"
                        [disabled]="guestPasswordDraft().length < 8"
                      >
                        {{ "save" | i18n }}
                      </button>
                    </form>
                  </div>
                }

                <div class="vk-pref-row">
                  <span class="vk-row-title">{{ "clearClipboard" | i18n }}</span>
                  <select
                    class="vk-row-select"
                    [attr.aria-label]="'clearClipboard' | i18n"
                    [value]="clearClipboardValue()"
                    (change)="onClearClipboardChange($any($event.target).value)"
                  >
                    @for (opt of clipboardOptions; track opt.key) {
                      <option [value]="opt.key" [selected]="clearClipboardValue() === opt.key">
                        {{ opt.labelKey | i18n }}
                      </option>
                    }
                  </select>
                </div>

                <div class="vk-pref-row">
                  <div class="vk-int-lead">
                    <span class="vk-nav-ico" data-kind="login" aria-hidden="true">
                      <vk-glyph name="globe" [size]="13.5" />
                    </span>
                    <div class="vk-row-copy">
                      <span class="vk-row-title">{{ "vkIntegrationBrowserBridge" | i18n }}</span>
                      <small>{{ "vkBrowserAutofillChrome" | i18n }}</small>
                    </div>
                  </div>
                  <div class="vk-int-right">
                    <span class="vk-int-badge" [class.ready]="browserBridgeReady()">
                      {{ (browserBridgeReady() ? "vkStatusReady" : "vkStatusNotSetUp") | i18n }}
                    </span>
                    <button type="button" class="vk-settings-btn" (click)="enableBrowserBridge()">
                      {{ (browserBridgeReady() ? "vkActionRefresh" : "vkActionEnable") | i18n }}
                    </button>
                  </div>
                </div>

                @if (mac || passkeyProviderState()?.registered) {
                  <div class="vk-pref-row">
                    <div class="vk-int-lead">
                      <span class="vk-nav-ico" data-kind="key" aria-hidden="true">
                        <vk-glyph name="key" [size]="13.5" />
                      </span>
                      <div class="vk-row-copy">
                        <span class="vk-row-title">{{ "vkIntegrationSystemAutofill" | i18n }}</span>
                        <small>{{
                          (mac ? "vkBrowserAutofillSafari" : "vkBrowserAutofillWindows") | i18n
                        }}</small>
                      </div>
                    </div>
                    <div class="vk-int-right">
                      <span class="vk-int-badge" [class.ready]="passkeyProviderState()?.enabled">
                        {{
                          (passkeyProviderState()?.enabled ? "vkStatusReady" : "vkStatusOff") | i18n
                        }}
                      </span>
                      <button type="button" class="vk-settings-btn" (click)="managePasskeyProvider()">
                        {{ "vkActionOpenSettings" | i18n }}
                      </button>
                    </div>
                  </div>
                }

                @if (mac) {
                  <div class="vk-pref-row">
                    <div class="vk-int-lead">
                      <span class="vk-nav-ico" data-kind="all" aria-hidden="true">
                        <vk-glyph name="access" [size]="13.5" />
                      </span>
                      <div class="vk-row-copy">
                        <span class="vk-row-title">{{ "vkIntegrationAccessibility" | i18n }}</span>
                        <small>{{ "vkIntegrationAccessibilityDesc" | i18n }}</small>
                      </div>
                    </div>
                    <div class="vk-int-right">
                      <span class="vk-int-badge" [class.ready]="accessibilityTrusted()">
                        {{
                          (accessibilityTrusted() ? "vkStatusReady" : "vkStatusNeedsAccess") | i18n
                        }}
                      </span>
                      <button
                        type="button"
                        class="vk-settings-btn"
                        (click)="requestAccessibilityPermission()"
                      >
                        {{ "vkActionOpenSettings" | i18n }}
                      </button>
                    </div>
                  </div>
                }
              </div>
            </section>
          </div>
        </div>
      </div>
    }

    @if (decisionPickerOpen() && decisionModels(); as dm) {
      <vk-decision-picker
        [state]="dm"
        [localModeActive]="privacyMode() === 'local'"
        (closed)="decisionPickerOpen.set(false)"
        (useRequested)="useDecisionModel($event)"
        (downloadRequested)="downloadDecisionModel($event)"
        (cancelRequested)="cancelDecisionDownload()"
        (deleteRequested)="deleteDecisionModel($event)"
        (importRequested)="importDecisionModelFile()"
      />
    }

    @if (onboardingOpen()) {
      <vk-onboarding
        (finished)="onboardingOpen.set(false)"
        (signIn)="signInFromOnboarding()"
      />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .vk-window {
        display: grid;
        grid-template-columns: var(--vk-side-w, 216px) 0px minmax(0, 1fr);
        height: 100%;
        color: var(--vk-ink);
        font-family: var(--font-sans);
        -webkit-font-smoothing: antialiased;
      }
      .vk-window.side-collapsed {
        grid-template-columns: minmax(0, 1fr);
      }
      .vk-window.side-collapsed .vk-side,
      .vk-window.side-collapsed .vk-side-resizer {
        display: none;
      }
      .vk-side-resizer {
        position: relative;
        z-index: 20;
        width: 8px;
        margin-left: -4px;
        cursor: col-resize;
        user-select: none;
        -webkit-app-region: no-drag;
      }
      .vk-side-resizer::after {
        content: "";
        position: absolute;
        inset: 0 auto 0 3.5px;
        width: 1.5px;
        background: transparent;
        transition: background 0.14s ease;
      }
      .vk-side-resizer:hover::after,
      .vk-side-resizer:active::after {
        background: var(--vk-blue);
      }
      .vk-side {
        display: flex;
        flex-direction: column;
        min-height: 0;
        padding: 0 9px 10px;
        background: var(--vk-sidebar);
        backdrop-filter: blur(26px) saturate(1.4);
        -webkit-backdrop-filter: blur(26px) saturate(1.4);
        border-right: 1px solid var(--vk-line);
        user-select: none;
        -webkit-app-region: drag;
      }
      .win .vk-side {
        background: color-mix(in srgb, var(--vk-sidebar) 88%, var(--vk-paper));
      }
      .vk-side button,
      .vk-side a,
      .vk-menu {
        -webkit-app-region: no-drag;
      }
      .vk-side-top {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: flex-end;
        height: 40px;
        padding: 0 2px;
      }
      .win .vk-side-top {
        height: 30px;
      }
      .vk-side-collapse-btn {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted);
        opacity: 0.78;
        cursor: pointer;
        transition:
          background-color 0.12s ease,
          color 0.12s ease,
          opacity 0.12s ease;
      }
      .vk-side-collapse-btn:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
        opacity: 1;
      }
      .vk-account {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 5px 7px;
        border: 0;
        border-radius: 8px;
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-account > vk-glyph {
        color: var(--vk-faint);
      }
      .vk-account:hover,
      .vk-account[aria-expanded="true"] {
        background: var(--vk-hover);
      }
      .vk-avatar {
        display: grid;
        place-items: center;
        flex: none;
        width: 30px;
        height: 30px;
        border-radius: 8px;
        background: var(--vk-amber-soft);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vk-amber) 24%, transparent);
        color: var(--vk-amber);
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .vk-account-text {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        line-height: 1.24;
      }
      .vk-account-text b {
        overflow: hidden;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.008em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-account-text small {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--vk-muted);
        font-size: 11.5px;
      }
      .vk-sync-dot {
        flex: none;
        width: 5.5px;
        height: 5.5px;
        border-radius: 50%;
        background: var(--vk-green);
      }
      .vk-sync-dot.offline {
        background: var(--vk-amber);
      }
      .vk-menu {
        width: 230px;
        -webkit-app-region: no-drag;
      }
      .vk-menu kbd {
        margin-left: auto;
        color: var(--vk-faint);
        font: inherit;
        font-size: 11.5px;
      }
      .vk-nav {
        flex: 1;
        min-height: 0;
        margin-top: 6px;
        overflow-y: auto;
      }
      .vk-label {
        margin: 13px 8px 3px;
        color: var(--vk-faint);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.005em;
        text-transform: none;
      }
      .vk-dev-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        height: 26px;
        margin-top: 9px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-faint);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.005em;
        text-transform: none;
        cursor: pointer;
      }
      .vk-dev-toggle:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-dev-count {
        margin-left: auto;
        color: var(--vk-muted);
        font-size: 11px;
        font-weight: 600;
      }
      .vk-dev-chevron {
        display: inline-flex;
        margin-left: auto;
        transition: transform 0.14s ease;
        transform: rotate(-90deg);
      }
      .vk-dev-count + .vk-dev-chevron {
        margin-left: 2px;
      }
      .vk-dev-chevron.open {
        transform: rotate(0deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .vk-dev-chevron {
          transition: none;
        }
      }
      :host .vk-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        height: 31px;
        padding: 0 7px;
        border: 0;
        border-radius: 7px;
        background: none;
        color: color-mix(in srgb, var(--vk-ink) 90%, transparent);
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: -0.006em;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
        transition: background-color 0.1s ease;
      }
      .vk-item-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-nav-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 21px;
        height: 21px;
        border-radius: 5.5px;
        background: linear-gradient(180deg, #4b8bf5 0%, #2563eb 100%);
        color: #ffffff;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.24),
          0 1px 1.5px rgb(0 0 0 / 0.1);
      }
      :host .vk-nav-ico vk-glyph {
        color: #ffffff;
      }
      .vk-nav-ico[data-kind="all"] {
        background: linear-gradient(180deg, #4b8bf5 0%, #2563eb 100%);
      }
      .vk-nav-ico[data-kind="pinned"] {
        background: linear-gradient(180deg, #fb923c 0%, #ea580c 100%);
      }
      .vk-nav-ico[data-kind="login"] {
        background: linear-gradient(180deg, #38bdf8 0%, #0284c7 100%);
      }
      .vk-nav-ico[data-kind="profile"] {
        background: linear-gradient(180deg, #6366f1 0%, #4338ca 100%);
      }
      .vk-nav-ico[data-kind="document"] {
        background: linear-gradient(180deg, #2dd4bf 0%, #0d9488 100%);
      }
      .vk-nav-ico[data-kind="card"] {
        background: linear-gradient(180deg, #34d399 0%, #16a34a 100%);
      }
      .vk-nav-ico[data-kind="note"] {
        background: linear-gradient(180deg, #fbbf24 0%, #d97706 100%);
      }
      .vk-nav-ico[data-kind="key"] {
        background: linear-gradient(180deg, #a855f7 0%, #7e22ce 100%);
      }
      .vk-nav-ico[data-kind="environment"] {
        background: linear-gradient(180deg, #22d3ee 0%, #0891b2 100%);
      }
      .vk-nav-ico[data-kind="expiring"] {
        background: linear-gradient(180deg, #fb7185 0%, #e11d48 100%);
      }
      .vk-nav-ico[data-kind="agent"] {
        background: linear-gradient(180deg, #8b5cf6 0%, #6d28d9 100%);
      }
      .vk-nav-ico[data-kind="trash"] {
        background: linear-gradient(180deg, #94a3b8 0%, #64748b 100%);
      }
      .vk-nav-ico[data-kind="sync"] {
        background: linear-gradient(180deg, #60a5fa 0%, #2563eb 100%);
      }
      .vk-nav-ico[data-kind="settings"] {
        background: linear-gradient(180deg, #8d8d95 0%, #636369 100%);
      }
      :host .vk-item:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      :host .vk-item.on {
        background: var(--vk-selected);
        color: var(--vk-ink);
        font-weight: 600;
      }
      .vk-sync-cta {
        color: var(--vk-muted);
      }
      .vk-item:focus-visible,
      .vk-dev-toggle:focus-visible,
      .vk-account:focus-visible,
      .vk-side-collapse-btn:focus-visible,
      .vk-menu button:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: -2px;
      }
      .vk-count {
        margin-left: auto;
        color: var(--vk-amber);
        font-size: 12px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .vk-muted-count {
        margin-left: auto;
        color: var(--vk-faint);
        font-size: 11.5px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
      }
      .vk-foot {
        flex: none;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 75%, transparent);
      }
      .vk-main {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--vk-window);
      }
      .vk-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .vk-settings-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(12 14 20 / 38%);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
      .vk-settings-sheet {
        display: flex;
        flex-direction: column;
        width: min(560px, 100%);
        max-height: min(740px, 88vh);
        overflow: hidden;
        border: 1px solid var(--vk-line);
        border-radius: 14px;
        background: var(--vk-canvas, #f7f8fa);
        color: var(--vk-ink);
        box-shadow:
          0 28px 72px rgb(0 0 0 / 24%),
          0 1px 0 rgb(255 255 255 / 0.45) inset;
      }
      .vk-settings-head {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: space-between;
        padding: 15px 20px 13px;
        border-bottom: 1px solid var(--vk-line);
        background: color-mix(in srgb, var(--vk-card, #ffffff) 78%, var(--vk-canvas, #f7f8fa));
      }
      .vk-settings-head h2 {
        margin: 0;
        font-size: 15.5px;
        font-weight: 650;
        letter-spacing: -0.014em;
      }
      .vk-settings-close-icon {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-settings-close-icon:hover {
        background: var(--vk-selected);
        color: var(--vk-ink);
      }
      .vk-settings-body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        scrollbar-gutter: stable;
        padding: 16px 18px 22px 20px;
        display: grid;
        gap: 18px;
      }
      .vk-settings-body::-webkit-scrollbar {
        width: 8px;
      }
      .vk-settings-body::-webkit-scrollbar-track {
        background: transparent;
        margin-block: 6px;
      }
      .vk-settings-body::-webkit-scrollbar-thumb {
        border: 2px solid transparent;
        border-radius: 999px;
        background: color-mix(in srgb, var(--vk-ink) 20%, transparent);
        background-clip: padding-box;
      }
      .vk-settings-section h3 {
        margin: 0 4px 7px;
        color: var(--vk-muted);
        font-size: 11.5px;
        font-weight: 600;
        letter-spacing: 0.01em;
      }
      .vk-pref-card {
        border: 1px solid var(--vk-line);
        border-radius: 11px;
        background: var(--vk-card, #ffffff);
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.025);
        overflow: hidden;
      }
      .vk-pref-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        min-height: 46px;
        padding: 8px 14px;
      }
      .vk-pref-row + .vk-pref-row {
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 82%, transparent);
      }
      .vk-pref-row.vk-no-border {
        border-top: 0;
      }
      .vk-clickable-row {
        cursor: pointer;
      }
      .vk-row-title {
        font-size: 13.5px;
        font-weight: 500;
        color: var(--vk-ink);
        letter-spacing: -0.006em;
      }
      .vk-row-copy {
        display: grid;
        gap: 1px;
        min-width: 0;
      }
      .vk-row-copy small {
        color: var(--vk-muted);
        font-size: 11.5px;
        line-height: 1.35;
      }
      .vk-settings-btn {
        height: 28px;
        padding: 0 11px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-card, #ffffff);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12.5px;
        font-weight: 550;
        cursor: pointer;
        box-shadow: 0 1px 1px rgb(0 0 0 / 0.03);
        white-space: nowrap;
      }
      .vk-settings-btn:hover {
        background: var(--vk-hover);
      }
      .vk-settings-btn:disabled {
        opacity: 0.5;
        cursor: default;
      }
      .vk-seg {
        display: inline-grid;
        grid-template-columns: repeat(3, minmax(64px, auto));
        gap: 2px;
        padding: 2.5px;
        border: 1px solid color-mix(in srgb, var(--vk-line) 75%, transparent);
        border-radius: 8px;
        background: var(--vk-hover);
      }
      .vk-seg.vk-seg-two {
        grid-template-columns: repeat(2, minmax(76px, auto));
      }
      .vk-seg button,
      .vk-seg-radio {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 25px;
        padding: 0 11px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
      }
      .vk-seg button.on,
      .vk-seg-radio.on {
        background: var(--vk-card, #ffffff);
        color: var(--vk-ink);
        font-weight: 600;
        box-shadow:
          0 1px 2.5px rgb(0 0 0 / 0.09),
          0 0 0 0.5px rgb(0 0 0 / 0.04);
      }
      .vk-row-select {
        min-width: 164px;
        max-width: 220px;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-hover);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .vk-row-select:focus-visible {
        outline: 2px solid var(--vk-blue);
        outline-offset: -1px;
      }
      .vk-shortcut-pills {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
      }
      .vk-kbd-pair {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--vk-muted);
        font-size: 12px;
      }
      .vk-kbd-pair kbd {
        display: inline-flex;
        align-items: center;
        height: 21px;
        padding: 0 6px;
        border: 1px solid var(--vk-line);
        border-radius: 5px;
        background: var(--vk-hover);
        color: var(--vk-ink);
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        font-weight: 500;
      }
      .vk-switch {
        position: relative;
        display: inline-flex;
        flex: none;
        width: 36px;
        height: 21px;
      }
      .vk-switch-track {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 999px;
        background: color-mix(in srgb, var(--vk-ink) 18%, transparent);
        transition: background-color 0.16s ease;
      }
      .vk-switch-track::after {
        content: "";
        position: absolute;
        top: 2px;
        left: 2px;
        width: 17px;
        height: 17px;
        border-radius: 999px;
        background: #ffffff;
        box-shadow: 0 1px 2.5px rgb(0 0 0 / 0.22);
        transition: transform 0.16s ease;
      }
      .vk-switch input:checked + .vk-switch-track {
        background: var(--vk-blue);
      }
      .vk-switch input:checked + .vk-switch-track::after {
        transform: translateX(15px);
      }
      .vk-switch input:focus-visible + .vk-switch-track {
        outline: 2px solid var(--vk-blue);
        outline-offset: 2px;
      }
      .vk-privacy-list {
        display: grid;
      }
      .vk-privacy-option {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        padding: 11px 14px;
        cursor: pointer;
        transition: background-color 0.12s ease;
      }
      .vk-privacy-option + .vk-privacy-option {
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 82%, transparent);
      }
      .vk-privacy-option:hover {
        background: color-mix(in srgb, var(--vk-hover) 55%, transparent);
      }
      .vk-privacy-option.on {
        background: color-mix(in srgb, var(--vk-blue-soft) 52%, transparent);
      }
      .vk-radio-dot {
        position: relative;
        flex: none;
        width: 16px;
        height: 16px;
        margin-top: 2px;
        border: 1.5px solid color-mix(in srgb, var(--vk-ink) 28%, transparent);
        border-radius: 999px;
        background: var(--vk-card, #ffffff);
      }
      .vk-privacy-option.on .vk-radio-dot {
        border-color: var(--vk-blue);
        background: var(--vk-blue);
      }
      .vk-privacy-option.on .vk-radio-dot::after {
        content: "";
        position: absolute;
        inset: 4px;
        border-radius: 999px;
        background: #ffffff;
      }
      .vk-privacy-copy {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .vk-privacy-copy b {
        font-size: 13.5px;
        font-weight: 600;
        letter-spacing: -0.006em;
      }
      .vk-privacy-copy small {
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.38;
      }
      .vk-int-lead {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .vk-int-right {
        display: flex;
        flex: none;
        align-items: center;
        gap: 7px;
      }
      .vk-int-badge {
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        font-size: 11px;
        font-weight: 600;
      }
      .vk-int-badge.ready {
        background: var(--vk-green-soft);
        color: var(--vk-green);
      }
      .vk-local-pw-box {
        display: grid;
        gap: 8px;
        padding-bottom: 10px;
        border-bottom: 1px solid color-mix(in srgb, var(--vk-line) 82%, transparent);
      }
      .vk-inline-pw-form {
        display: flex;
        gap: 8px;
        padding: 0 14px;
      }
      .vk-pw-input {
        flex: 1;
        height: 30px;
        padding: 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-hover);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12.5px;
      }
      .vk-perm-needed {
        display: grid;
        gap: 8px;
        padding: 11px 13px;
        border: 1px solid color-mix(in srgb, var(--vk-amber) 35%, var(--vk-line));
        border-radius: 11px;
        background: var(--vk-amber-soft);
      }
      .vk-perm-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .vk-perm-main b {
        display: block;
        font-size: 13px;
        font-weight: 600;
      }
      .vk-perm-main small {
        display: block;
        margin-top: 2px;
        color: var(--vk-muted);
        font-size: 12px;
      }
      .vk-perm-fix {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: var(--vk-amber);
        font-size: 12px;
      }
      .vk-link-btn {
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
      .vk-settings-btn.primary {
        border-color: var(--vk-blue);
        background: var(--vk-blue);
        color: #fff;
        font-weight: 600;
        box-shadow: 0 1px 2px rgb(37 99 235 / 0.22);
      }
      .vk-settings-btn.primary:hover {
        filter: brightness(0.96);
      }
      .vk-settings-btn.ghost {
        background: transparent;
        box-shadow: none;
      }
      .vk-settings-btn.ghost:hover {
        background: var(--vk-hover);
      }
      .vk-model-options {
        border-top: 1px solid color-mix(in srgb, var(--vk-line) 82%, transparent);
      }
      .vk-model-options > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 14px;
        color: var(--vk-ink);
        font-size: 13px;
        font-weight: 600;
        list-style: none;
        cursor: pointer;
      }
      .vk-model-options > summary::-webkit-details-marker {
        display: none;
      }
      .vk-model-options[open] > summary vk-glyph {
        transform: rotate(180deg);
      }
      .vk-local-model-card {
        display: grid;
        gap: 8px;
        padding: 11px 14px;
        background: color-mix(in srgb, var(--vk-canvas, #f7f8fa) 55%, var(--vk-card, #ffffff));
      }
      .vk-local-model-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .vk-local-model-picker-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        justify-content: space-between;
        width: 100%;
        height: 28px;
        padding: 0 9px 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-card, #ffffff);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 1px 1px rgb(0 0 0 / 0.03);
      }
      .vk-local-model-picker-btn span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-local-model-picker-btn vk-glyph {
        color: var(--vk-muted);
      }
      .vk-local-model-picker-btn:hover {
        background: var(--vk-hover);
      }
      .vk-local-model-foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px 12px;
      }
      .vk-local-model-note {
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.38;
      }
      .vk-local-model-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      .vk-local-model-active {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--vk-green, #128a5a);
        font-size: 12px;
        font-weight: 600;
      }
      .vk-local-model-dot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: currentColor;
      }
      .vk-local-model-progress {
        display: flex;
        align-items: center;
        gap: 9px;
      }
      .vk-local-model-bar-track {
        flex: 1;
        min-width: 80px;
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--vk-hover);
      }
      .vk-local-model-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--vk-blue);
        transition: width 0.15s ease;
      }
      .vk-local-model-pct {
        flex: none;
        color: var(--vk-muted);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .vk-local-model-cancel {
        display: grid;
        place-items: center;
        flex: none;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-local-model-cancel:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-local-model-err {
        color: var(--vk-red, #dc2626);
        font-size: 12px;
        line-height: 1.35;
      }
    `,
  ],
})
export class VowkeyShellComponent implements OnDestroy {
  protected readonly library = inject(VowkeyLibrary);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly messaging = inject(MessagingService);
  private readonly platformUtils = inject(PlatformUtilsService);
  private readonly ngZone = inject(NgZone);
  private readonly hub = inject(VowkeyHub, { optional: true });
  private readonly inference = inject(ProductInference, { optional: true });
  private readonly themeState = inject(ThemeStateService, { optional: true });
  private readonly autofillSettings = inject(AutofillSettingsServiceAbstraction, {
    optional: true,
  });
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly desktopAutofill = inject(DesktopAutofillService, { optional: true });
  private readonly manifestService = inject(NativeMessagingManifestService, { optional: true });
  private readonly biometricsService = inject(DesktopBiometricsService, { optional: true });
  private readonly biometricState = inject(BiometricStateService, { optional: true });
  private readonly vaultTimeoutSettings = inject(VaultTimeoutSettingsService, { optional: true });
  private readonly keyService = inject(KeyService, { optional: true });
  private readonly autoUnlock = inject(AutoUnlockService, { optional: true });
  private readonly dialogs = inject(DialogService, { optional: true });
  private readonly privacySettings = inject(PrivacySettingsService, { optional: true });
  private readonly entitlements = inject(EntitlementService, { optional: true });
  private readonly environmentService = inject(EnvironmentService, { optional: true });
  private readonly log = inject(LogService, { optional: true });
  protected readonly planName = signal<string | null>(null);
  protected readonly mac = this.platformUtils.getDevice() === DeviceType.MacOsDesktop;
  private readonly isWinOrLinux = !this.mac;

  protected readonly themeSystem = ThemeTypes.System;
  protected readonly themeLight = ThemeTypes.Light;
  protected readonly themeDark = ThemeTypes.Dark;
  protected readonly clipboardOptions: readonly { key: string; delay: ClearClipboardDelaySetting; labelKey: string }[] = [
    { key: "never", delay: ClearClipboardDelay.Never, labelKey: "never" },
    { key: "10", delay: ClearClipboardDelay.TenSeconds, labelKey: "tenSeconds" },
    { key: "20", delay: ClearClipboardDelay.TwentySeconds, labelKey: "twentySeconds" },
    { key: "30", delay: ClearClipboardDelay.ThirtySeconds, labelKey: "thirtySeconds" },
    { key: "60", delay: ClearClipboardDelay.OneMinute, labelKey: "oneMinute" },
    { key: "120", delay: ClearClipboardDelay.TwoMinutes, labelKey: "twoMinutes" },
    { key: "300", delay: ClearClipboardDelay.FiveMinutes, labelKey: "fiveMinutes" },
  ];

  protected readonly languageOptions = LANGUAGE_OPTIONS;
  protected readonly privacyChoices = PRIVACY_CHOICES;
  protected readonly settingsOpen = signal(false);
  protected readonly activeSettingsTab = signal<HubSettingsTab>("general");
  protected readonly selectedLocale = signal("");
  protected readonly selectedTheme = signal<Theme>(ThemeTypes.System);
  protected readonly clearClipboardValue = signal<string>("never");
  protected readonly biometricEnabled = signal(false);
  protected readonly biometricBusy = signal(false);
  protected readonly guestHasPassword = signal(false);
  protected readonly guestPasswordDraft = signal("");
  protected readonly shareUsageCounts = signal(false);
  protected readonly sendCrashReports = signal(false);

  protected readonly browserBridgeReady = signal(false);
  protected readonly passkeyProviderState = signal<PasskeyProviderState | undefined>(undefined);
  protected readonly accessibilityTrusted = signal(true);
  protected readonly accessibilityFixTried = signal(false);
  protected readonly onboardingOpen = signal(false);
  private readonly accountService = inject(AccountService, { optional: true });
  protected readonly decisionUrl = signal("");
  protected readonly decisionApiKey = signal("");
  protected readonly decisionHasStoredKey = signal(false);
  protected readonly decisionModels = signal<DecisionModelsState | null>(null);
  protected readonly decisionPickerOpen = signal(false);
  private readonly developerManual = signal<boolean | null>(null);
  protected readonly shellPrefs = signal<DesktopShellPreferences>({
    appPresence: "both",
    quickBarMode: "floating",
    floatAboveWindows: true,
    openAtLogin: false,
  });
  protected readonly privacyMode = signal<PrivacyMode>(
    this.inference?.getPrivacyMode() ?? "masked",
  );
  protected readonly selectedDecisionModelId = computed(() => {
    const dm = this.decisionModels();
    if (!dm) {
      return "";
    }
    if (this.privacyMode() === "local" && dm.activeModelId) {
      return dm.activeModelId;
    }
    return dm.selectedModelId;
  });
  protected readonly selectedDecisionModelInfo = computed(() => {
    const dm = this.decisionModels();
    if (!dm) {
      return null;
    }
    const id = this.selectedDecisionModelId();
    const cat = dm.catalog.find((m) => m.id === id);
    if (cat) {
      return {
        id: cat.id,
        name: cat.name,
        bytes: cat.bytes,
        ready: cat.installed || Boolean(cat.foundPath),
      };
    }
    const custom = dm.customModels.find((m) => m.id === id);
    if (custom) {
      return {
        id: custom.id,
        name: custom.name,
        bytes: custom.bytes,
        ready: !custom.missing,
      };
    }
    const fallback = dm.catalog[0];
    return fallback
      ? {
          id: fallback.id,
          name: fallback.name,
          bytes: fallback.bytes,
          ready: fallback.installed || Boolean(fallback.foundPath),
        }
      : null;
  });
  protected readonly activePreparation = computed<DecisionPreparationState | null>(
    () => this.decisionModels()?.preparation ?? null,
  );
  protected readonly isSelectedModelInUse = computed(() => {
    const dm = this.decisionModels();
    const info = this.selectedDecisionModelInfo();
    if (!dm || !info) {
      return false;
    }
    return this.privacyMode() === "local" && dm.activeModelId === info.id && info.ready;
  });
  private removeOpenSettingsListener: (() => void) | null = null;
  private readonly decisionModelCleanups: (() => void)[] = [];
  private hubSettingsSub?: Subscription;
  private localStateSub?: Subscription;

  protected readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly query = computed(() => new URLSearchParams(this.url().split("?")[1] ?? ""));

  protected readonly sidebarWidth = signal<number>(readStoredSidebarWidth());
  private readonly localSidebarCollapsed = signal(false);
  protected readonly sidebarCollapsed = computed(
    () => this.hub?.sidebarCollapsed() ?? this.localSidebarCollapsed(),
  );
  protected toggleSidebar(): void {
    if (this.hub) {
      this.hub.toggleSidebar();
    } else {
      this.localSidebarCollapsed.update((collapsed) => !collapsed);
    }
  }
  protected readonly isGuest = computed(() => this.library.account() == null);
  /** Sign-in is offered only when the configured server answers, so it never leads nowhere. */
  protected readonly syncAvailable = signal(false);
  protected readonly fullAccountName = computed(() => {
    const account = this.library.account();
    return account?.name?.trim() || account?.email || "Vowkey";
  });
  protected readonly name = computed(() => {
    const full = this.fullAccountName();
    const cleaned = full.replace(/\s*\([^)]*\)?\s*$/, "").trim();
    return cleaned || full;
  });
  protected readonly initials = computed(() => initials(this.name()));
  protected readonly initials_ = initials;

  protected startSidebarResize(event: MouseEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this.sidebarWidth();
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(340, Math.max(184, Math.round(startWidth + (moveEvent.clientX - startX))));
      this.sidebarWidth.set(next);
      try {
        globalThis.localStorage?.setItem("vk.sidebarWidth", String(next));
      } catch {
        // Ignore storage quota or sandbox errors.
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  protected resetSidebarWidth(): void {
    this.sidebarWidth.set(224);
    try {
      globalThis.localStorage?.removeItem("vk.sidebarWidth");
    } catch {
      // Ignore storage errors.
    }
  }

  protected readonly top: NavEntry[] = [
    { show: "profiles", glyph: "person", label: "vkProfiles", kind: "profile" },
    { show: "pinned", glyph: "bookmark", label: "vkPinned", kind: "pinned" },
  ];
  protected readonly library_: NavEntry[] = [
    { show: "all", glyph: "grid", label: "vkAllItems", kind: "all" },
    { show: "logins", glyph: "globe", label: "vkLogins", kind: "login" },
    { show: "documents", glyph: "document", label: "vkDocuments", kind: "document" },
    { show: "cards", glyph: "card", label: "vkCards", kind: "card" },
    { show: "notes", glyph: "note", label: "vkNotes", kind: "note" },
  ];
  protected readonly developer_: NavEntry[] = [
    { show: "keys", glyph: "key", label: "vkKeys", kind: "key" },
    { show: "environments", glyph: "layers", label: "vkEnvironments", kind: "environment" },
  ];
  protected readonly developerCount = computed(
    () =>
      (this.library.rows?.() ?? []).filter(
        (row) => row.kind === "key" || row.kind === "environment",
      ).length,
  );
  protected readonly developerExpanded = computed(() => {
    if (this.isOn("keys", null) || this.isOn("environments", null)) {
      return true;
    }
    const manual = this.developerManual();
    if (manual != null) {
      return manual;
    }
    return this.developerCount() > 0;
  });

  private readonly online = () => this.library.online.set(navigator.onLine);

  private readonly onFocusRefresh = () => {
    if (this.settingsOpen()) {
      void this.refreshIntegrationsState();
      void this.refreshPlan();
    }
  };

  constructor() {
    document.documentElement.classList.add("vk-shell");
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.online);
    window.addEventListener("focus", this.onFocusRefresh);
    void this.loadShellPreferences();
    if (this.privacySettings) {
      void firstValueFrom(this.privacySettings.shareUsageCounts$).then((enabled) => this.shareUsageCounts.set(enabled));
      void firstValueFrom(this.privacySettings.sendCrashReports$).then((enabled) => this.sendCrashReports.set(enabled));
    }
    void this.refreshGuestLockState();
    void this.decideOnboarding();
    void this.probeSyncServer();
    this.localStateSub = this.localVault?.state$.subscribe(() => {
      void this.refreshGuestLockState();
    });
    this.hubSettingsSub = this.hub?.settingsRequests$.subscribe((tab) => {
      this.ngZone.run(() => this.openSettings(tab));
    });
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    if (qbIpc?.onOpenSettings) {
      this.removeOpenSettingsListener = qbIpc.onOpenSettings(() => {
        this.ngZone.run(() => this.openSettings());
      });
    }
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (capIpc?.onDecisionModelsState) {
      this.decisionModelCleanups.push(
        capIpc.onDecisionModelsState((state) => {
          this.ngZone.run(() => this.decisionModels.set(state));
        }),
      );
    }
    void this.loadDecisionModels();
  }

  ngOnDestroy(): void {
    document.documentElement.classList.remove("vk-shell");
    window.removeEventListener("online", this.online);
    window.removeEventListener("offline", this.online);
    window.removeEventListener("focus", this.onFocusRefresh);
    this.hubSettingsSub?.unsubscribe();
    this.localStateSub?.unsubscribe();
    this.removeOpenSettingsListener?.();
    this.removeOpenSettingsListener = null;
    while (this.decisionModelCleanups.length > 0) {
      this.decisionModelCleanups.pop()?.();
    }
  }

  @HostListener("window:keydown", ["$event"])
  protected onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.decisionPickerOpen()) {
      event.preventDefault();
      this.decisionPickerOpen.set(false);
      return;
    }
    if (event.key === "Escape" && this.settingsOpen()) {
      event.preventDefault();
      this.closeSettings();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      this.openSettings();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
      event.preventDefault();
      this.toggleSidebar();
    }
  }

  protected isOn(show: LibraryShow | null, person: string | null): boolean {
    if (!this.url().startsWith("/vault")) {
      return false;
    }
    const current = (this.query().get("show") ?? "all") as LibraryShow;
    const currentPerson = this.query().get("person");
    return person != null ? currentPerson === person : currentPerson == null && show === current;
  }

  private async probeSyncServer(): Promise<void> {
    if (!this.environmentService) {
      this.syncAvailable.set(true);
      return;
    }
    this.syncAvailable.set(await syncServerAnswers(this.environmentService));
  }

  protected signIn(): void {
    this.settingsOpen.set(false);
    void this.router.navigate(["/login"]);
  }

  protected lock(): void {
    this.messaging.send("lockVault");
  }

  protected tool(message: "openGenerator" | "importVault" | "exportVault"): void {
    this.messaging.send(message);
  }

  protected toggleDeveloper(): void {
    this.developerManual.set(!this.developerExpanded());
  }

  protected openQuickBar(): void {
    this.settingsOpen.set(false);
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    void qbIpc?.show?.();
  }

  protected openSettings(tab?: HubSettingsTab): void {
    this.activeSettingsTab.set(tab ?? "general");
    this.privacyMode.set(this.inference?.getPrivacyMode() ?? "masked");
    void this.syncSelectedLocale();
    void this.syncAppearanceAndSecurity();
    void this.loadShellPreferences();
    void this.refreshIntegrationsState();
    void this.loadDecisionConfig();
    void this.loadDecisionModels();
    void this.refreshPlan();
    this.settingsOpen.set(true);
    if (tab) {
      setTimeout(() => this.jumpToSettings(tab), 0);
    }
  }

  protected jumpToSettings(tab: HubSettingsTab): void {
    this.activeSettingsTab.set(tab);
    const idMap: Record<HubSettingsTab, string> = {
      general: "vk-sec-general",
      appearance: "vk-sec-appearance",
      security: "vk-sec-security",
      integrations: "vk-sec-integrations",
      reading: "vk-sec-reading",
    };
    document.getElementById(idMap[tab])?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  protected systemDefaultLabel(): string {
    this.selectedLocale();
    const sys = this.i18n.t("defaultSystem");
    if (sys && sys !== "defaultSystem") {
      return sys;
    }
    const def = this.i18n.t("default");
    return def && def !== "default" ? def : "System";
  }

  protected async onThemeChange(theme: Theme): Promise<void> {
    this.selectedTheme.set(theme);
    await this.themeState?.setSelectedTheme(theme);
  }

  protected async onClearClipboardChange(rawKey: string): Promise<void> {
    this.clearClipboardValue.set(rawKey);
    const match = this.clipboardOptions.find((opt) => opt.key === rawKey);
    if (match && this.autofillSettings) {
      await this.autofillSettings.setClearClipboardDelay(match.delay);
    }
  }

  protected async onToggleBiometric(enabled: boolean): Promise<void> {
    const account = this.library.account();
    if (
      !account ||
      !this.biometricsService ||
      !this.biometricState ||
      !this.keyService ||
      !this.autoUnlock
    ) {
      this.biometricEnabled.set(false);
      return;
    }
    this.biometricBusy.set(true);
    try {
      const userId = account.id;
      if (!enabled) {
        this.biometricEnabled.set(false);
        await this.biometricState.setBiometricUnlockEnabled(false, userId);
        await this.biometricsService.deleteBiometricUnlockKeyForUser(userId);
        await this.autoUnlock.refreshAutoUnlockKey(userId);
        return;
      }

      const status = await this.biometricsService.getBiometricsStatus();
      if (status === BiometricsStatus.AutoSetupNeeded) {
        await this.biometricsService.setupBiometrics();
      } else if (status === BiometricsStatus.ManualSetupNeeded) {
        const confirmed = await this.dialogs?.openSimpleDialog({
          title: { key: "biometricsManualSetupTitle" },
          content: { key: "biometricsManualSetupDesc" },
          type: "warning",
        });
        if (confirmed) {
          this.platformUtils.launchUri("https://vowkey.com/help/biometrics/");
        }
        this.biometricEnabled.set(false);
        return;
      }

      await this.biometricState.setBiometricUnlockEnabled(true, userId);
      const userKey = await firstValueFrom(this.keyService.userKey$(userId));
      await this.biometricsService.setBiometricProtectedUnlockKeyForUser(userId, userKey);

      if (this.isWinOrLinux) {
        await this.biometricState.setPromptAutomatically(false, userId);
      } else if (this.mac) {
        try {
          await this.biometricsService.enrollPersistent(userId, userKey);
        } catch {
          // Session biometric unlock key stored above remains usable even if persistent enrollment fails.
        }
      }

      await this.autoUnlock.refreshAutoUnlockKey(userId);
      const biometricSet =
        (await this.biometricsService.getBiometricsStatusForUser(userId)) ===
        BiometricsStatus.Available;
      this.biometricEnabled.set(biometricSet);
      if (!biometricSet) {
        await this.biometricState.setBiometricUnlockEnabled(false, userId);
      }
    } catch {
      const accountNow = this.library.account();
      if (accountNow && this.biometricState) {
        await this.biometricState.setBiometricUnlockEnabled(false, accountNow.id);
      }
      this.biometricEnabled.set(false);
    } finally {
      this.biometricBusy.set(false);
      this.messaging.send("redrawMenu");
    }
  }

  protected async saveGuestPassword(): Promise<void> {
    const pw = this.guestPasswordDraft();
    if (!this.localVault || pw.length < 8) {
      return;
    }
    try {
      await this.localVault.initialize();
      await this.localVault.ensureUnlocked();
      await this.localVault.setPassword(pw);
      this.guestPasswordDraft.set("");
      await this.refreshGuestLockState();
      this.messaging.send("redrawMenu");
      this.platformUtils.showToast("success", null, this.i18n.t("vkLocalPasswordSaved"));
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  private async refreshGuestLockState(): Promise<void> {
    if (!this.localVault) {
      this.guestHasPassword.set(false);
      return;
    }
    try {
      const meta = await this.localVault.protectionMetadata();
      this.guestHasPassword.set(Boolean(meta?.wrappedUserKey));
    } catch {
      this.guestHasPassword.set(false);
    }
  }

  private async syncAppearanceAndSecurity(): Promise<void> {
    try {
      if (this.themeState?.selectedTheme$) {
        const theme = await firstValueFrom(this.themeState.selectedTheme$);
        if (theme) {
          this.selectedTheme.set(theme);
        }
      }
    } catch {
      // Keep default theme when mocked.
    }
    try {
      if (this.autofillSettings?.clearClipboardDelay$) {
        const delay = await firstValueFrom(this.autofillSettings.clearClipboardDelay$);
        const match = this.clipboardOptions.find((opt) => opt.delay === delay);
        this.clearClipboardValue.set(match?.key ?? "never");
      }
    } catch {
      // Keep default clipboard delay when mocked.
    }
    await this.refreshGuestLockState();
    const account = this.library.account();
    if (account && this.vaultTimeoutSettings) {
      try {
        this.biometricEnabled.set(await this.vaultTimeoutSettings.isBiometricLockSet(account.id));
      } catch {
        this.biometricEnabled.set(false);
      }
    }
  }

  private async refreshIntegrationsState(): Promise<void> {
    try {
      if (this.manifestService) {
        const err = await this.manifestService.generate(true);
        this.browserBridgeReady.set(err == null);
      }
    } catch {
      // Keep current state when mocked.
    }
    try {
      if (this.desktopAutofill) {
        const state = await this.desktopAutofill.refreshPasskeyProviderState();
        this.passkeyProviderState.set(state);
      }
    } catch {
      // Passkey provider may be unsupported in dev/test builds.
    }
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar as
      | (typeof ipc.quickBar & {
          accessibilityStatus?: () => Promise<boolean>;
        })
      | undefined;
    if (qbIpc?.accessibilityStatus) {
      try {
        this.accessibilityTrusted.set(await qbIpc.accessibilityStatus());
      } catch {
        this.accessibilityTrusted.set(true);
      }
    }
  }

  protected async enableBrowserBridge(): Promise<void> {
    try {
      const err = await this.manifestService?.generate(true);
      if (err) {
        throw err;
      }
      this.browserBridgeReady.set(true);
      this.platformUtils.showToast("success", null, this.i18n.t("vkBrowserBridgeReadyToast"));
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected async managePasskeyProvider(): Promise<void> {
    if (!this.desktopAutofill) {
      return;
    }
    try {
      if (!this.passkeyProviderState()?.enabled) {
        const enabled = await this.desktopAutofill.requestEnableCredentialProvider();
        if (enabled !== undefined) {
          this.passkeyProviderState.set({ registered: true, enabled });
          return;
        }
      }
      await this.desktopAutofill.openCredentialProviderSettings();
    } catch {
      // Ignore if OS settings link is unavailable in environment.
    }
  }

  /**
   * First launch on a new device opens setup; an existing vault or a signed-in account skips it.
   * Setup left part-way resumes where it stopped, including after a restart for permissions.
   */
  private async decideOnboarding(): Promise<void> {
    const stored = readOnboarding();
    if (stored?.done) {
      return;
    }
    if (stored) {
      this.onboardingOpen.set(true);
      return;
    }
    const account = this.accountService
      ? await firstValueFrom(this.accountService.activeAccount$).catch((): null => null)
      : null;
    let fresh = account == null;
    if (fresh && this.localVault) {
      try {
        await this.localVault.initialize();
        fresh = this.localVault.state$.value === "empty";
      } catch {
        fresh = false;
      }
    }
    if (fresh) {
      this.onboardingOpen.set(true);
    } else {
      writeOnboarding({ step: "ready", done: true });
    }
  }

  protected runSetupAgain(): void {
    this.settingsOpen.set(false);
    writeOnboarding({ step: "welcome", done: false });
    this.onboardingOpen.set(true);
  }

  protected signInFromOnboarding(): void {
    this.onboardingOpen.set(false);
    void this.router.navigate(["/login"]);
  }

  /** Opens the Accessibility list with the drag guide docked beside System Settings. */
  protected async requestAccessibilityPermission(): Promise<void> {
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    if (!qbIpc?.showAccessibilityGuide) {
      return;
    }
    try {
      const trusted = await qbIpc.showAccessibilityGuide(this.i18n.t("vkObGuideDrag"));
      this.accessibilityTrusted.set(Boolean(trusted));
    } catch {
      // Ignore outside Electron.
    }
  }

  /** Clears a stale Accessibility entry from an older copy, then opens the guide again. */
  protected async fixAccessibility(): Promise<void> {
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    try {
      const trusted = await qbIpc?.resetAccessibility?.();
      this.accessibilityTrusted.set(Boolean(trusted));
      if (!trusted) {
        this.accessibilityFixTried.set(true);
        await this.requestAccessibilityPermission();
      }
    } catch {
      // Ignore outside Electron.
    }
  }

  protected relaunch(): void {
    void (globalThis as { ipc?: typeof ipc }).ipc?.quickBar?.relaunch?.();
  }

  private async loadDecisionConfig(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture as
      | (typeof ipc.capture & {
          getDecisionConfig?: () => Promise<{ url?: string; hasKey?: boolean }>;
        })
      | undefined;
    if (!capIpc?.getDecisionConfig) {
      return;
    }
    try {
      const cfg = await capIpc.getDecisionConfig();
      this.decisionUrl.set(cfg?.url ?? "");
      this.decisionHasStoredKey.set(Boolean(cfg?.hasKey));
      this.decisionApiKey.set("");
    } catch {
      // Ignore outside Electron.
    }
  }

  protected async saveDecisionConfig(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture as
      | (typeof ipc.capture & {
          setDecisionConfig?: (cfg: { url?: string; apiKey?: string }) => Promise<{
            url?: string;
            hasKey?: boolean;
          }>;
        })
      | undefined;
    if (!capIpc?.setDecisionConfig) {
      return;
    }
    try {
      const res = await capIpc.setDecisionConfig({
        url: this.decisionUrl().trim(),
        apiKey: this.decisionApiKey().trim() || undefined,
      });
      this.decisionUrl.set(res?.url ?? "");
      this.decisionHasStoredKey.set(Boolean(res?.hasKey));
      this.decisionApiKey.set("");
      this.platformUtils.showToast("success", null, this.i18n.t("vkDecisionConfigSaved"));
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected async clearDecisionConfig(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture as
      | (typeof ipc.capture & {
          setDecisionConfig?: (cfg: { url?: string; apiKey?: string; clearKey?: boolean }) => Promise<{
            url?: string;
            hasKey?: boolean;
          }>;
        })
      | undefined;
    if (!capIpc?.setDecisionConfig) {
      return;
    }
    try {
      await capIpc.setDecisionConfig({ url: "", clearKey: true });
      this.decisionUrl.set("");
      this.decisionApiKey.set("");
      this.decisionHasStoredKey.set(false);
    } catch {
      // Ignore outside Electron.
    }
  }

  protected async onLanguageChange(value: string): Promise<void> {
    this.selectedLocale.set(value);
    await this.i18n.setLocale(value || null);
  }

  private async syncSelectedLocale(): Promise<void> {
    if (!this.i18n.userSetLocale$) {
      return;
    }
    try {
      const stored = await firstValueFrom(this.i18n.userSetLocale$);
      this.selectedLocale.set(stored ?? "");
    } catch {
      // Keep current selection when userSetLocale$ is mocked or empty.
    }
  }

  protected closeSettings(): void {
    this.decisionPickerOpen.set(false);
    this.settingsOpen.set(false);
  }

  protected openDecisionPicker(): void {
    void this.loadDecisionModels();
    this.decisionPickerOpen.set(true);
  }

  protected selectedDecisionModelName(): string {
    return this.selectedDecisionModelInfo()?.name ?? "";
  }

  protected selectedModelOfflineHint(): string {
    this.selectedLocale();
    const bytes = this.selectedDecisionModelInfo()?.bytes ?? 0;
    const size = formatModelBytes(bytes);
    return this.trModel("vkModelOfflineHint", `Runs on this computer · ${size}`, size);
  }

  protected preparationPercent(prep: DecisionPreparationState): number {
    if (prep.phase === "verifying" || prep.phase === "loading") {
      return 100;
    }
    if (!prep.totalBytes || prep.totalBytes <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((prep.downloadedBytes / prep.totalBytes) * 100)));
  }

  protected preparationStatusText(prep: DecisionPreparationState): string {
    this.selectedLocale();
    if (prep.phase === "verifying") {
      return this.trModel("vkModelVerifying", "Checking download…");
    }
    if (prep.phase === "loading") {
      return this.trModel("vkModelStarting", "Starting model…");
    }
    const pct = this.preparationPercent(prep);
    const size = formatModelBytes(prep.totalBytes);
    return this.trModel("vkModelProgressOfSize", `${pct}% of ${size}`, String(pct), size);
  }

  private trModel(key: string, fallback: string, ...args: string[]): string {
    const translated = this.i18n.t(key, ...args);
    return translated && translated !== key ? translated : fallback;
  }

  private async loadDecisionModels(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.getDecisionModelsState) {
      return;
    }
    try {
      const state = await capIpc.getDecisionModelsState();
      if (!state) {
        return;
      }
      if (this.privacyMode() !== "local" && state.activeModelId != null && capIpc.setLocalDecisionActive) {
        const synced = await capIpc.setLocalDecisionActive(false);
        this.decisionModels.set(synced ?? state);
        return;
      }
      this.decisionModels.set(state);
    } catch {
      // Ignore outside Electron.
    }
  }

  protected async downloadDecisionModel(modelId?: string): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.downloadDecisionModel) {
      return;
    }
    try {
      const state = await capIpc.downloadDecisionModel(modelId);
      if (state) {
        this.decisionModels.set(state);
        if (state.activeModelId != null) {
          this.selectPrivacyMode("local", false);
        }
      }
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected async useDecisionModel(modelId: string): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.chooseDecisionModel) {
      return;
    }
    try {
      const state = await capIpc.chooseDecisionModel(modelId);
      if (state) {
        this.decisionModels.set(state);
        if (state.activeModelId != null) {
          this.selectPrivacyMode("local", false);
        }
      }
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected async cancelDecisionDownload(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.cancelDecisionDownload) {
      return;
    }
    try {
      const state = await capIpc.cancelDecisionDownload();
      if (state) {
        this.decisionModels.set(state);
      }
    } catch {
      // Ignore outside Electron.
    }
  }

  protected async deleteDecisionModel(modelId: string): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.deleteDecisionModel) {
      return;
    }
    try {
      const state = await capIpc.deleteDecisionModel(modelId);
      if (state) {
        this.decisionModels.set(state);
      }
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected async importDecisionModelFile(): Promise<void> {
    const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
    if (!capIpc?.importDecisionModelFile) {
      return;
    }
    try {
      const state = await capIpc.importDecisionModelFile();
      if (state) {
        this.decisionModels.set(state);
        if (state.activeModelId != null) {
          this.selectPrivacyMode("local", false);
        }
      }
    } catch (e) {
      this.platformUtils.showToast("error", null, e instanceof Error ? e.message : String(e));
    }
  }

  protected setAppPresence(appPresence: AppPresenceMode): void {
    void this.patchShellPreferences({ appPresence });
  }

  protected setQuickBarMode(quickBarMode: QuickBarWindowMode): void {
    void this.patchShellPreferences({ quickBarMode });
  }

  protected toggleFloatAboveWindows(floatAboveWindows: boolean): void {
    void this.patchShellPreferences({ floatAboveWindows });
  }

  protected toggleOpenAtLogin(openAtLogin: boolean): void {
    void this.patchShellPreferences({ openAtLogin });
  }

  private async loadShellPreferences(): Promise<void> {
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    if (!qbIpc?.getShellPreferences) {
      return;
    }
    try {
      const loaded = await qbIpc.getShellPreferences();
      if (loaded) {
        this.shellPrefs.set(loaded);
      }
    } catch {
      // Keep default shell preferences when running outside Electron IPC.
    }
  }

  private async patchShellPreferences(patch: Partial<DesktopShellPreferences>): Promise<void> {
    this.shellPrefs.update((prev) => ({ ...prev, ...patch }));
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    if (!qbIpc?.updateShellPreferences) {
      return;
    }
    try {
      const updated = await qbIpc.updateShellPreferences(patch);
      if (updated) {
        this.shellPrefs.set(updated);
      }
    } catch {
      // Optimistic local state remains if IPC is unavailable.
    }
  }

  protected setShareUsageCounts(enabled: boolean): void {
    this.shareUsageCounts.set(enabled);
    void this.privacySettings?.setShareUsageCounts(enabled);
  }

  protected setSendCrashReports(enabled: boolean): void {
    this.sendCrashReports.set(enabled);
    void this.privacySettings?.setSendCrashReports(enabled);
  }
  private async refreshPlan(): Promise<void> {
    this.planName.set(null);
    const account = this.accountService
      ? await firstValueFrom(this.accountService.activeAccount$)
      : null;
    if (!account || !this.entitlements) {
      return;
    }
    try {
      const response = await this.entitlements.get();
      const current = await firstValueFrom(this.accountService!.activeAccount$);
      if (current?.id === account.id) {
        this.planName.set(planNameKey(response.personal.basePlan));
      }
    } catch (error: unknown) {
      this.log?.error(error);
    }
  }

  protected async openWebPlan(): Promise<void> {
    if (!this.environmentService) {
      return;
    }
    const environment = await firstValueFrom(this.environmentService.environment$);
    this.platformUtils.launchUri(
      `${environment.getWebVaultUrl().replace(/\/$/, "")}/#/settings/subscription`,
    );
  }

  protected openAccountSettings(): void {
    this.settingsOpen.set(false);
    this.messaging.send("openSettings", { legacyDialog: true });
  }

  protected startSampleWalkthrough(): void {
    this.settingsOpen.set(false);
    void this.router.navigate(["/vault"], {
      queryParams: { walkthrough: "passport", show: "all", person: null },
    });
  }

  protected selectPrivacyMode(mode: PrivacyMode, syncLocalModel = true): void {
    this.inference?.setPrivacyMode(mode);
    this.privacyMode.set(mode);
    if (syncLocalModel) {
      const capIpc = (globalThis as { ipc?: typeof ipc }).ipc?.capture;
      if (capIpc?.setLocalDecisionActive) {
        void capIpc.setLocalDecisionActive(mode === "local").then(
          (state) => {
            if (state) {
              this.decisionModels.set(state);
            }
          },
          (): void => undefined,
        );
      }
    }
  }

  protected logOut(): void {
    this.messaging.send("logout", { userInitiated: true });
  }
}

function readStoredSidebarWidth(): number {
  try {
    const raw = Number(globalThis.localStorage?.getItem("vk.sidebarWidth"));
    if (Number.isFinite(raw) && raw >= 184 && raw <= 340) {
      return Math.round(raw);
    }
  } catch {
    // Ignore storage errors.
  }
  return 224;
}
