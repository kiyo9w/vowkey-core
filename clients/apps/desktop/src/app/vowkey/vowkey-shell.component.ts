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

import { ClearClipboardDelay } from "@vowkey/common/autofill/constants";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { ClearClipboardDelaySetting } from "@vowkey/common/autofill/types";
import { DeviceType } from "@vowkey/common/enums";
import { VaultTimeoutSettingsService } from "@vowkey/common/key-management/vault-timeout";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { Theme, ThemeTypes } from "@vowkey/common/platform/enums/theme-type.enum";
import { ThemeStateService } from "@vowkey/common/platform/theming/theme-state.service";
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
import { DesktopBiometricsService } from "../../key-management/biometrics/desktop.biometrics.service";
import type {
  AppPresenceMode,
  DesktopShellPreferences,
  QuickBarWindowMode,
} from "../../quick-bar/types";
import { NativeMessagingManifestService } from "../services/native-messaging-manifest.service";

import { GlyphName, VowkeyGlyphComponent } from "./vowkey-glyph.component";
import { HubSettingsTab, VowkeyHub } from "./vowkey-hub.service";
import { LibraryShow, VowkeyLibrary } from "./vowkey-library.service";

interface NavEntry {
  show: LibraryShow;
  glyph: GlyphName;
  label: string;
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
    bodyKey: "vkPrivacyLocalBody",
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
  imports: [FormsModule, RouterLink, RouterOutlet, I18nPipe, MenuModule, VowkeyGlyphComponent],
  template: `
    <div class="vk-window" [class.mac]="mac" [class.win]="!mac">
      <aside class="vk-side" [attr.aria-label]="'vkLibrary' | i18n">
        <div class="vk-side-top"></div>
        <button type="button" class="vk-account" [bitMenuTriggerFor]="accountMenu">
          <span class="vk-avatar" aria-hidden="true">{{ initials() }}</span>
          <span class="vk-account-text">
            <b>{{ name() }}</b>
            @if (isGuest()) {
              <small>{{ "vowkeyLocalVault" | i18n }}</small>
            } @else {
              <small>{{ (library.online() ? "vkSynced" : "vkOffline") | i18n }}</small>
            }
          </span>
          <vk-glyph name="chevrons" [size]="14" />
        </button>
        <bit-menu #accountMenu>
          <div class="vk-menu">
            @if (isGuest()) {
              <button type="button" bitMenuItem (click)="signIn()">
                <vk-glyph slot="start" name="person" [size]="16" />{{ "vkSignInToSync" | i18n }}
              </button>
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
              [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
            >
              <vk-glyph [name]="entry.glyph" />{{ entry.label | i18n }}
            </a>
          }

          <h2 class="vk-label">{{ "vkLibrary" | i18n }}</h2>
          @for (entry of library_; track entry.show) {
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{ show: entry.show, person: null, item: null, source: null }"
              [class.on]="isOn(entry.show, null)"
              [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
            >
              <vk-glyph [name]="entry.glyph" />{{ entry.label | i18n }}
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
              <vk-glyph name="chevron-down" [size]="13" />
            </span>
          </button>
          @if (developerExpanded()) {
            @for (entry of developer_; track entry.show) {
              <a
                class="vk-item"
                routerLink="/vault"
                [queryParams]="{ show: entry.show, person: null, item: null, source: null }"
                [class.on]="isOn(entry.show, null)"
                [attr.aria-current]="isOn(entry.show, null) ? 'page' : null"
              >
                <vk-glyph [name]="entry.glyph" />{{ entry.label | i18n }}
              </a>
            }
          }

          @if (library.profiles().length > 0) {
            <h2 class="vk-label">{{ "vkPeople" | i18n }}</h2>
            @for (profile of library.profiles(); track profile.id) {
              <a
                class="vk-item vk-person"
                routerLink="/vault"
                [queryParams]="{ show: null, person: profile.id, item: profile.id, source: null }"
                [class.on]="isOn(null, profile.id)"
                [attr.aria-current]="isOn(null, profile.id) ? 'page' : null"
              >
                <span class="vk-dot" aria-hidden="true">{{ initials_(profile.name) }}</span>
                <span class="vk-person-name">{{ profile.name }}</span>
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
              <vk-glyph name="clock" />{{ "vkExpiring" | i18n }}
              <span class="vk-count">{{ library.expiringCount() }}</span>
            </a>
          }

          <h2 class="vk-label">{{ "vkConnected" | i18n }}</h2>
          <a class="vk-item" routerLink="/agents" [class.on]="url().startsWith('/agents')">
            <vk-glyph name="bot" />{{ "vkAiAgents" | i18n }}
          </a>
        </nav>

        <div class="vk-foot">
          @if (autofillHelpOpen()) {
            <div
              class="vk-autofill-card"
              role="region"
              [attr.aria-label]="'vkBrowserAutofill' | i18n"
              data-testid="vowkey-browser-autofill-card"
            >
              <div class="vk-int-mini-row">
                <span>{{ "vkIntegrationBrowserBridge" | i18n }}</span>
                <button
                  type="button"
                  class="vk-int-pill"
                  [class.ready]="browserBridgeReady()"
                  (click)="enableBrowserBridge()"
                >
                  {{
                    (browserBridgeReady() ? "vkStatusReady" : "vkActionEnable") | i18n
                  }}
                </button>
              </div>
              @if (mac) {
                <div class="vk-int-mini-row">
                  <span>{{ "vkIntegrationSystemAutofill" | i18n }}</span>
                  <button
                    type="button"
                    class="vk-int-pill"
                    [class.ready]="passkeyProviderState()?.enabled"
                    (click)="managePasskeyProvider()"
                  >
                    {{
                      (passkeyProviderState()?.enabled ? "vkStatusReady" : "vkActionOpenSettings")
                        | i18n
                    }}
                  </button>
                </div>
                <div class="vk-int-mini-row">
                  <span>{{ "vkIntegrationAccessibility" | i18n }}</span>
                  <button
                    type="button"
                    class="vk-int-pill"
                    [class.ready]="accessibilityTrusted()"
                    (click)="requestAccessibilityPermission()"
                  >
                    {{
                      (accessibilityTrusted() ? "vkStatusReady" : "vkActionAllow") | i18n
                    }}
                  </button>
                </div>
              }
              <p>{{ "vkBrowserAutofillChrome" | i18n }}</p>
              @if (mac) {
                <p>{{ "vkBrowserAutofillSafari" | i18n }}</p>
              }
              <button
                type="button"
                class="vk-autofill-open"
                data-testid="vowkey-open-quickbar-help"
                (click)="openQuickBar()"
              >
                {{ "vkWtOpenQuickBar" | i18n }}
                <kbd>{{ mac ? "⌃⇧Space" : "Ctrl+Shift+Space" }}</kbd>
              </button>
            </div>
          }
          <a
            class="vk-item"
            routerLink="/vault"
            [queryParams]="{ show: 'trash', person: null, item: null, source: null }"
            [class.on]="isOn('trash', null)"
            data-testid="vowkey-nav-trash"
          >
            <vk-glyph name="trash" />{{ "vkRecentlyDeleted" | i18n }}
          </a>
          @if (isGuest()) {
            <a class="vk-item vk-sync-cta" routerLink="/login" data-testid="vowkey-sign-in-sync">
              <vk-glyph name="person" />{{ "vkSignInToSync" | i18n }}
            </a>
          }
          <button
            type="button"
            class="vk-autofill-help"
            data-testid="vowkey-browser-autofill-help"
            [class.on]="autofillHelpOpen()"
            [attr.aria-expanded]="autofillHelpOpen()"
            (click)="toggleAutofillHelp()"
          >
            <vk-glyph name="globe" />{{ "vkBrowserAutofill" | i18n }}
          </button>
          <button
            type="button"
            class="vk-item"
            data-testid="vowkey-open-settings"
            (click)="openSettings()"
          >
            <vk-glyph name="gear" />{{ "vkSettings" | i18n }}
          </button>
        </div>
      </aside>

      <main class="vk-main">
        <router-outlet />
      </main>
    </div>

    @if (settingsOpen()) {
      <div class="vk-settings-backdrop" (click)="closeSettings()">
        <div
          class="vk-settings-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vk-settings-title"
          (click)="$event.stopPropagation()"
        >
          <header class="vk-settings-head">
            <h2 id="vk-settings-title">{{ "vkSettings" | i18n }}</h2>
            <button
              type="button"
              class="vk-settings-close"
              (click)="closeSettings()"
              [attr.aria-label]="'close' | i18n"
            >
              {{ "close" | i18n }}
            </button>
          </header>

          <nav class="vk-settings-tabs" [attr.aria-label]="'vkSettings' | i18n">
            <button
              type="button"
              [class.on]="activeSettingsTab() === 'general'"
              (click)="jumpToSettings('general')"
            >
              {{ "vkSettingsTabGeneral" | i18n }}
            </button>
            <button
              type="button"
              [class.on]="activeSettingsTab() === 'appearance'"
              (click)="jumpToSettings('appearance')"
            >
              {{ "vkSettingsTabAppearance" | i18n }}
            </button>
            <button
              type="button"
              [class.on]="activeSettingsTab() === 'security'"
              (click)="jumpToSettings('security')"
            >
              {{ "security" | i18n }}
            </button>
            <button
              type="button"
              [class.on]="activeSettingsTab() === 'integrations'"
              (click)="jumpToSettings('integrations')"
            >
              {{ "vkSettingsTabIntegrations" | i18n }}
            </button>
            <button
              type="button"
              [class.on]="activeSettingsTab() === 'reading'"
              (click)="jumpToSettings('reading')"
            >
              {{ "vkReadingAndFilling" | i18n }}
            </button>
          </nav>

          <section class="vk-settings-section" id="vk-sec-general">
            <h3>{{ "vkLanguage" | i18n }}</h3>
            <div class="vk-pref-group">
              <select
                class="vk-lang-select"
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
          </section>

          <section class="vk-settings-section" id="vk-sec-appearance">
            <h3>{{ "vkSettingsTabAppearance" | i18n }}</h3>
            <div class="vk-pref-group">
              <span class="vk-pref-label">{{ "theme" | i18n }}</span>
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
          </section>

          <section class="vk-settings-section">
            <h3>{{ (mac ? "vkSettingsQuickBarMac" : "vkSettingsQuickBarWin") | i18n }}</h3>
            <div class="vk-shell-prefs">
              <div class="vk-pref-group">
                <span class="vk-pref-label">{{ "vkShowVowkeyIn" | i18n }}</span>
                <div class="vk-seg" role="radiogroup" [attr.aria-label]="'vkShowVowkeyIn' | i18n">
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="shellPrefs().appPresence === 'both'"
                    [class.on]="shellPrefs().appPresence === 'both'"
                    (click)="setAppPresence('both')"
                  >
                    {{ (mac ? "vkPresenceBothMac" : "vkPresenceBothWin") | i18n }}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="shellPrefs().appPresence === 'menubar'"
                    [class.on]="shellPrefs().appPresence === 'menubar'"
                    (click)="setAppPresence('menubar')"
                  >
                    {{ (mac ? "vkPresenceMenuMac" : "vkPresenceMenuWin") | i18n }}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="shellPrefs().appPresence === 'dock'"
                    [class.on]="shellPrefs().appPresence === 'dock'"
                    (click)="setAppPresence('dock')"
                  >
                    {{ (mac ? "vkPresenceDockMac" : "vkPresenceDockWin") | i18n }}
                  </button>
                </div>
              </div>

              <div
                class="vk-privacy-list"
                role="radiogroup"
                [attr.aria-label]="'vkQuickBarWindow' | i18n"
              >
                <label
                  class="vk-privacy-option"
                  [class.on]="shellPrefs().quickBarMode === 'floating'"
                >
                  <input
                    type="radio"
                    name="vkQuickBarMode"
                    [checked]="shellPrefs().quickBarMode === 'floating'"
                    (change)="setQuickBarMode('floating')"
                  />
                  <span>
                    <b>{{ "vkQuickBarFloating" | i18n }}</b>
                    <small>{{
                      (mac ? "vkQuickBarFloatingSubMac" : "vkQuickBarFloatingSubWin") | i18n
                    }}</small>
                  </span>
                </label>
                <label
                  class="vk-privacy-option"
                  [class.on]="shellPrefs().quickBarMode === 'popover'"
                >
                  <input
                    type="radio"
                    name="vkQuickBarMode"
                    [checked]="shellPrefs().quickBarMode === 'popover'"
                    (change)="setQuickBarMode('popover')"
                  />
                  <span>
                    <b>{{ (mac ? "vkQuickBarPopoverMac" : "vkQuickBarPopoverWin") | i18n }}</b>
                    <small>{{ "vkQuickBarPopoverSub" | i18n }}</small>
                  </span>
                </label>
              </div>

              <div class="vk-pref-checks">
                <label class="vk-check-row">
                  <input
                    type="checkbox"
                    [checked]="shellPrefs().floatAboveWindows"
                    (change)="toggleFloatAboveWindows($any($event.target).checked)"
                  />
                  <span>{{ "vkFloatAboveWindows" | i18n }}</span>
                </label>
                <label class="vk-check-row">
                  <input
                    type="checkbox"
                    [checked]="shellPrefs().openAtLogin"
                    (change)="toggleOpenAtLogin($any($event.target).checked)"
                  />
                  <span>{{ "vkOpenAtLogin" | i18n }}</span>
                </label>
              </div>

              <div class="vk-shortcut-bar" [attr.aria-label]="'vkGlobalShortcuts' | i18n">
                <span
                  ><kbd>{{ mac ? "⌃⇧Space" : "Ctrl+Shift+Space" }}</kbd>
                  {{ "vkQuickBar" | i18n }}</span
                >
                <span
                  ><kbd>@if (mac) { ⌘&#92; } @else { Ctrl+&#92; }</kbd>
                  {{ "vkShortcutFillWindow" | i18n }}</span
                >
              </div>
            </div>
          </section>

          <section class="vk-settings-section" id="vk-sec-security">
            <h3>{{ "security" | i18n }}</h3>
            <div class="vk-shell-prefs">
              @if (!isGuest()) {
                <label class="vk-check-row">
                  <input
                    type="checkbox"
                    data-testid="settings-biometric-checkbox"
                    [checked]="biometricEnabled()"
                    [disabled]="biometricBusy()"
                    (change)="onToggleBiometric($any($event.target).checked)"
                  />
                  <span>{{ (mac ? "unlockWithTouchId" : "unlockWithWindowsHello") | i18n }}</span>
                </label>
              } @else {
                <div class="vk-local-pw-box">
                  <div class="vk-int-row">
                    <div>
                      <b>{{ "vkLocalPasswordTitle" | i18n }}</b>
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
                      class="vk-lang-select"
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
              <div class="vk-pref-group">
                <span class="vk-pref-label">{{ "clearClipboard" | i18n }}</span>
                <select
                  class="vk-lang-select"
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
            </div>
          </section>

          <section class="vk-settings-section" id="vk-sec-integrations">
            <h3>{{ "vkSettingsTabIntegrations" | i18n }}</h3>
            <div class="vk-int-list">
              <div class="vk-int-row">
                <div>
                  <b>{{ "vkIntegrationBrowserBridge" | i18n }}</b>
                  <small>{{ "vkBrowserAutofillChrome" | i18n }}</small>
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
                <div class="vk-int-row">
                  <div>
                    <b>{{ "vkIntegrationSystemAutofill" | i18n }}</b>
                    <small>{{
                      (mac ? "vkBrowserAutofillSafari" : "vkBrowserAutofillWindows") | i18n
                    }}</small>
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
                <div class="vk-int-row">
                  <div>
                    <b>{{ "vkIntegrationAccessibility" | i18n }}</b>
                    <small>{{ "vkIntegrationAccessibilityDesc" | i18n }}</small>
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

              <button
                type="button"
                class="vk-settings-btn"
                data-testid="vowkey-settings-open-quickbar"
                (click)="openQuickBar()"
              >
                {{ "vkWtOpenQuickBar" | i18n }}
                <kbd>{{ mac ? "⌃⇧Space" : "Ctrl+Shift+Space" }}</kbd>
              </button>
            </div>
          </section>

          <section class="vk-settings-section" id="vk-sec-reading">
            <h3>{{ "vkReadingAndFilling" | i18n }}</h3>
            <div
              class="vk-privacy-list"
              role="radiogroup"
              [attr.aria-label]="'vkReadingAndFilling' | i18n"
            >
              @for (choice of privacyChoices; track choice.mode) {
                <label class="vk-privacy-option" [class.on]="privacyMode() === choice.mode">
                  <input
                    type="radio"
                    name="vkPrivacyMode"
                    [checked]="privacyMode() === choice.mode"
                    (change)="selectPrivacyMode(choice.mode)"
                  />
                  <span>
                    <b>{{ choice.titleKey | i18n }}</b>
                    <small>{{ choice.bodyKey | i18n }}</small>
                  </span>
                </label>
              }
            </div>
            <details class="vk-decision-config">
              <summary>{{ "vkDecisionCustomEndpoint" | i18n }}</summary>
              <form class="vk-decision-form" (submit)="$event.preventDefault(); saveDecisionConfig()">
                <label class="vk-pref-group">
                  <span class="vk-pref-label">{{ "vkDecisionEndpointLabel" | i18n }}</span>
                  <input
                    type="url"
                    class="vk-lang-select"
                    name="decisionUrl"
                    [ngModel]="decisionUrl()"
                    (ngModelChange)="decisionUrl.set($event)"
                    placeholder="https://api.openai.com/v1"
                    autocomplete="off"
                  />
                </label>
                <label class="vk-pref-group">
                  <span class="vk-pref-label">{{ "vkDecisionApiKeyLabel" | i18n }}</span>
                  <input
                    type="password"
                    class="vk-lang-select"
                    name="decisionApiKey"
                    [ngModel]="decisionApiKey()"
                    (ngModelChange)="decisionApiKey.set($event)"
                    [placeholder]="
                      decisionHasStoredKey()
                        ? ('vkDecisionKeySavedPlaceholder' | i18n)
                        : 'sk-...'
                    "
                    autocomplete="off"
                  />
                </label>
                <div class="vk-decision-actions">
                  <button type="submit" class="vk-settings-btn">
                    {{ "save" | i18n }}
                  </button>
                  @if (decisionHasStoredKey() || decisionUrl()) {
                    <button type="button" class="vk-settings-btn" (click)="clearDecisionConfig()">
                      {{ "clear" | i18n }}
                    </button>
                  }
                </div>
              </form>
            </details>
          </section>

          <footer class="vk-settings-foot">
            <button
              type="button"
              class="vk-settings-btn"
              data-testid="vowkey-settings-walkthrough"
              (click)="startSampleWalkthrough()"
            >
              {{ "vkTryWalkthrough" | i18n }}
            </button>
            @if (isGuest()) {
              <button type="button" class="vk-settings-btn" (click)="signIn()">
                {{ "vkSignInToSync" | i18n }}
              </button>
            } @else {
              <button type="button" class="vk-settings-btn" (click)="openAccountSettings()">
                {{ "vkAccountSecuritySettings" | i18n }}
              </button>
            }
          </footer>
        </div>
      </div>
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
        grid-template-columns: 254px minmax(0, 1fr);
        height: 100%;
        color: var(--vk-ink);
        font-family: var(--font-sans);
      }
      .vk-side {
        display: flex;
        flex-direction: column;
        min-height: 0;
        padding: 0 12px 10px;
        background: var(--vk-sidebar);
        border-right: 1px solid var(--vk-line);
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
        flex: none;
        height: 46px;
      }
      .win .vk-side-top {
        height: 16px;
      }
      .vk-account {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 6px 8px;
        border: 0;
        border-radius: var(--vk-radius-row);
        background: none;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-account:hover,
      .vk-account[aria-expanded="true"] {
        background: var(--vk-hover);
      }
      .vk-avatar {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: var(--vk-ink);
        color: var(--vk-paper);
        font-size: 13px;
        font-weight: 600;
      }
      .vk-account-text {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        line-height: 1.25;
      }
      .vk-account-text b {
        overflow: hidden;
        font-size: 15px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-account-text small {
        color: var(--vk-muted);
        font-size: 13px;
      }
      .vk-menu {
        width: 230px;
        -webkit-app-region: no-drag;
      }
      .vk-menu kbd {
        margin-left: auto;
        color: var(--vk-faint);
        font: inherit;
        font-size: 12px;
      }
      .vk-nav {
        flex: 1;
        min-height: 0;
        margin-top: 8px;
        overflow-y: auto;
      }
      .vk-label {
        margin: 18px 10px 4px;
        color: var(--vk-muted);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .vk-dev-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        height: 28px;
        margin-top: 12px;
        padding: 0 10px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .vk-dev-toggle:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-dev-count {
        margin-left: auto;
        color: var(--vk-muted);
        font-size: 11.5px;
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
        gap: 10px;
        width: 100%;
        height: 34px;
        padding: 0 10px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-ink);
        font: inherit;
        font-size: 15px;
        font-weight: 500;
        text-decoration: none;
        white-space: nowrap;
        cursor: pointer;
      }
      :host .vk-item:hover {
        background: var(--vk-hover);
      }
      :host .vk-item.on {
        background: var(--vk-selected);
        font-weight: 600;
      }
      .vk-sync-cta {
        color: var(--vk-muted);
      }
      .vk-item:focus-visible,
      .vk-dev-toggle:focus-visible,
      .vk-autofill-help:focus-visible,
      .vk-autofill-open:focus-visible,
      .vk-account:focus-visible,
      .vk-menu button:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: -2px;
      }
      .vk-count {
        margin-left: auto;
        color: var(--vk-amber);
        font-size: 13px;
        font-weight: 600;
      }
      .vk-person {
        font-size: 14.5px;
      }
      .vk-person-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-dot {
        display: grid;
        place-items: center;
        flex: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--vk-selected);
        font-size: 9.5px;
        font-weight: 700;
      }
      .vk-foot {
        flex: none;
        padding-top: 6px;
      }
      .vk-autofill-help {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        height: 32px;
        padding: 0 10px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-muted);
        font: inherit;
        font-size: 14px;
        font-weight: 500;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .vk-autofill-help:hover,
      .vk-autofill-help.on {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-autofill-card {
        display: grid;
        gap: 6px;
        margin: 0 2px 8px;
        padding: 10px 11px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        background: var(--vk-surface);
        color: var(--vk-ink);
      }
      .vk-autofill-card p {
        margin: 0;
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.42;
      }
      .vk-autofill-open {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        width: 100%;
        height: 28px;
        margin-top: 2px;
        padding: 0 9px;
        border: 1px solid var(--vk-line);
        border-radius: 7px;
        background: var(--vk-paper);
        color: var(--vk-ink);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-autofill-open:hover {
        background: var(--vk-hover);
      }
      .vk-autofill-open kbd,
      .vk-autofill-settings kbd {
        margin-left: 4px;
        padding: 1px 5px;
        border: 1px solid var(--vk-line);
        border-radius: 4px;
        background: var(--vk-surface);
        color: var(--vk-muted);
        font-family: var(--font-mono, monospace);
        font-size: 10.5px;
        font-weight: 500;
      }
      .vk-autofill-settings {
        display: grid;
        justify-items: start;
        gap: 8px;
      }
      .vk-autofill-settings p {
        margin: 0;
        color: var(--vk-muted);
        font-size: 13px;
        line-height: 1.42;
      }
      .vk-main {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--vk-window);
      }
      .vk-settings-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgb(15 23 42 / 36%);
      }
      .vk-settings-sheet {
        width: min(520px, 100%);
        max-height: 85vh;
        overflow-y: auto;
        padding: 22px 24px;
        border: 1px solid var(--vk-line);
        border-radius: 16px;
        background: var(--vk-paper, #fff);
        color: var(--vk-ink);
        box-shadow: 0 24px 64px rgb(0 0 0 / 24%);
      }
      .vk-settings-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .vk-settings-head h2 {
        margin: 0;
        font-size: 19px;
        font-weight: 700;
      }
      .vk-settings-close,
      .vk-settings-btn {
        padding: 6px 12px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-control, 8px);
        background: var(--vk-hover);
        color: var(--vk-ink);
        font: inherit;
        font-size: 13.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .vk-settings-section + .vk-settings-section {
        margin-top: 18px;
        padding-top: 16px;
        border-top: 1px solid var(--vk-line);
      }
      .vk-settings-section h3 {
        margin: 0 0 10px;
        color: var(--vk-muted);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .vk-shell-prefs {
        display: grid;
        gap: 11px;
      }
      .vk-pref-group {
        display: grid;
        gap: 6px;
      }
      .vk-pref-label {
        font-size: 13px;
        font-weight: 500;
        color: var(--vk-muted);
      }
      .vk-seg {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 4px;
        padding: 3px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        background: var(--vk-hover);
      }
      .vk-seg button {
        padding: 6px 8px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
      }
      .vk-seg button.on {
        background: var(--vk-paper, #fff);
        color: var(--vk-ink);
        font-weight: 600;
        box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
      }
      .vk-pref-checks {
        display: grid;
        gap: 7px;
        padding-top: 2px;
      }
      .vk-check-row {
        display: flex;
        align-items: center;
        gap: 9px;
        font-size: 13.5px;
        cursor: pointer;
      }
      .vk-shortcut-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 11px;
        border-radius: 9px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        font-size: 12.5px;
      }
      .vk-shortcut-bar kbd {
        display: inline-block;
        margin-right: 4px;
        padding: 2px 6px;
        border: 1px solid var(--vk-line);
        border-radius: 5px;
        background: var(--vk-paper, #fff);
        color: var(--vk-ink);
        font-family: var(--font-mono, monospace);
        font-size: 11px;
      }
      .vk-privacy-list {
        display: grid;
        gap: 8px;
      }
      .vk-privacy-option {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 11px 12px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
        cursor: pointer;
      }
      .vk-privacy-option.on {
        border-color: var(--vk-ink);
        background: var(--vk-selected);
      }
      .vk-privacy-option input {
        margin-top: 3px;
      }
      .vk-privacy-option span {
        display: grid;
        gap: 2px;
      }
      .vk-privacy-option b {
        font-size: 14px;
        font-weight: 600;
      }
      .vk-privacy-option small {
        color: var(--vk-muted);
        font-size: 13px;
        line-height: 1.38;
      }
      .vk-lang-select {
        width: 100%;
        height: 36px;
        padding: 0 10px;
        border: 1px solid var(--vk-line);
        border-radius: 9px;
        background: var(--vk-paper, #fff);
        color: var(--vk-ink);
        font: inherit;
        font-size: 13.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .vk-lang-select:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: -1px;
      }
      .vk-settings-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 16px;
        padding-top: 14px;
        border-top: 1px solid var(--vk-line);
      }
      .vk-settings-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 16px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vk-line);
      }
      .vk-settings-tabs button {
        padding: 5px 10px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: transparent;
        color: var(--vk-muted);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .vk-settings-tabs button.on,
      .vk-settings-tabs button:hover {
        background: var(--vk-selected);
        color: var(--vk-ink);
        border-color: var(--vk-ink);
      }
      .vk-int-list {
        display: grid;
        gap: 10px;
      }
      .vk-int-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
      }
      .vk-int-row b {
        display: block;
        font-size: 13.5px;
        font-weight: 600;
      }
      .vk-int-row small {
        display: block;
        margin-top: 2px;
        color: var(--vk-muted);
        font-size: 12px;
        line-height: 1.35;
      }
      .vk-int-right {
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
      }
      .vk-int-badge {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--vk-hover);
        color: var(--vk-muted);
        font-size: 11.5px;
        font-weight: 600;
      }
      .vk-int-badge.ready {
        background: color-mix(in srgb, #16a34a 14%, transparent);
        color: #15803d;
      }
      .vk-int-mini-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
        font-weight: 500;
      }
      .vk-int-pill {
        padding: 2px 8px;
        border: 1px solid var(--vk-line);
        border-radius: 999px;
        background: var(--vk-paper);
        color: var(--vk-ink);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-int-pill.ready {
        border-color: color-mix(in srgb, #16a34a 45%, var(--vk-line));
        color: #15803d;
      }
      .vk-local-pw-box {
        display: grid;
        gap: 8px;
      }
      .vk-inline-pw-form {
        display: flex;
        gap: 8px;
      }
      .vk-decision-config {
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid var(--vk-line);
        border-radius: 10px;
      }
      .vk-decision-config summary {
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-decision-form {
        display: grid;
        gap: 8px;
        margin-top: 10px;
      }
      .vk-decision-actions {
        display: flex;
        gap: 8px;
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
  protected readonly autofillHelpOpen = signal(false);
  protected readonly selectedLocale = signal("");
  protected readonly selectedTheme = signal<Theme>(ThemeTypes.System);
  protected readonly clearClipboardValue = signal<string>("never");
  protected readonly biometricEnabled = signal(false);
  protected readonly biometricBusy = signal(false);
  protected readonly guestHasPassword = signal(false);
  protected readonly guestPasswordDraft = signal("");
  protected readonly browserBridgeReady = signal(false);
  protected readonly passkeyProviderState = signal<PasskeyProviderState | undefined>(undefined);
  protected readonly accessibilityTrusted = signal(true);
  protected readonly decisionUrl = signal("");
  protected readonly decisionApiKey = signal("");
  protected readonly decisionHasStoredKey = signal(false);
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
  private removeOpenSettingsListener: (() => void) | null = null;
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

  protected readonly isGuest = computed(() => this.library.account() == null);
  protected readonly name = computed(() => {
    const account = this.library.account();
    return account?.name?.trim() || account?.email || "Vowkey";
  });
  protected readonly initials = computed(() => initials(this.name()));
  protected readonly initials_ = initials;

  protected readonly top: NavEntry[] = [
    { show: "all", glyph: "grid", label: "vkAllItems" },
    { show: "pinned", glyph: "bookmark", label: "vkPinned" },
  ];
  protected readonly library_: NavEntry[] = [
    { show: "logins", glyph: "globe", label: "vkLogins" },
    { show: "profiles", glyph: "person", label: "vkProfiles" },
    { show: "documents", glyph: "document", label: "vkDocuments" },
    { show: "cards", glyph: "card", label: "vkCards" },
    { show: "notes", glyph: "note", label: "vkNotes" },
  ];
  protected readonly developer_: NavEntry[] = [
    { show: "keys", glyph: "key", label: "vkKeys" },
    { show: "environments", glyph: "layers", label: "vkEnvironments" },
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
    if (this.settingsOpen() || this.autofillHelpOpen()) {
      void this.refreshIntegrationsState();
    }
  };

  constructor() {
    document.documentElement.classList.add("vk-shell");
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.online);
    window.addEventListener("focus", this.onFocusRefresh);
    void this.loadShellPreferences();
    void this.refreshGuestLockState();
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
  }

  @HostListener("window:keydown", ["$event"])
  protected onWindowKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.settingsOpen()) {
      event.preventDefault();
      this.closeSettings();
      return;
    }
    if (event.key === "Escape" && this.autofillHelpOpen()) {
      event.preventDefault();
      this.autofillHelpOpen.set(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      this.openSettings();
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

  protected toggleAutofillHelp(): void {
    const next = !this.autofillHelpOpen();
    this.autofillHelpOpen.set(next);
    if (next) {
      void this.refreshIntegrationsState();
    }
  }

  protected openQuickBar(): void {
    this.autofillHelpOpen.set(false);
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

  protected async requestAccessibilityPermission(): Promise<void> {
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar as
      | (typeof ipc.quickBar & {
          requestAccessibility?: () => Promise<boolean>;
        })
      | undefined;
    if (!qbIpc?.requestAccessibility) {
      return;
    }
    try {
      const trusted = await qbIpc.requestAccessibility();
      this.accessibilityTrusted.set(Boolean(trusted));
    } catch {
      // Ignore outside Electron.
    }
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
    this.settingsOpen.set(false);
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

  protected selectPrivacyMode(mode: PrivacyMode): void {
    this.inference?.setPrivacyMode(mode);
    this.privacyMode.set(mode);
  }

  protected logOut(): void {
    this.messaging.send("logout", { userInitiated: true });
  }
}
