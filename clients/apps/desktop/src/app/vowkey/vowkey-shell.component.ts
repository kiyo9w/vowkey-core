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
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { filter, firstValueFrom, map, startWith } from "rxjs";

import { DeviceType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { PrivacyMode, ProductInference } from "@vowkey/common/vault/local/product-inference";
import { MenuModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import type {
  AppPresenceMode,
  DesktopShellPreferences,
  QuickBarWindowMode,
} from "../../quick-bar/types";

import { GlyphName, VowkeyGlyphComponent } from "./vowkey-glyph.component";
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
  imports: [RouterLink, RouterOutlet, I18nPipe, MenuModule, VowkeyGlyphComponent],
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
              <p>{{ "vkBrowserAutofillChrome" | i18n }}</p>
              <p>
                {{ (mac ? "vkBrowserAutofillSafari" : "vkBrowserAutofillWindows") | i18n }}
              </p>
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
          @if (isGuest()) {
            <a class="vk-item vk-sync-cta" routerLink="/login" data-testid="vowkey-sign-in-sync">
              <vk-glyph name="person" />{{ "vkSignInToSync" | i18n }}
            </a>
          } @else {
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{ show: 'trash', person: null, item: null, source: null }"
              [class.on]="isOn('trash', null)"
            >
              <vk-glyph name="trash" />{{ "vkRecentlyDeleted" | i18n }}
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

          <section class="vk-settings-section">
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
                  {{ "defaultSystem" | i18n }}
                </option>
                @for (option of languageOptions; track option.code) {
                  <option [value]="option.code" [selected]="selectedLocale() === option.code">
                    {{ option.label }}
                  </option>
                }
              </select>
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

          <section class="vk-settings-section">
            <h3>{{ "vkBrowserAutofill" | i18n }}</h3>
            <div class="vk-autofill-settings">
              <p>{{ "vkBrowserAutofillChrome" | i18n }}</p>
              <p>{{ (mac ? "vkBrowserAutofillSafari" : "vkBrowserAutofillWindows") | i18n }}</p>
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

          <section class="vk-settings-section">
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
  private readonly inference = inject(ProductInference, { optional: true });
  protected readonly mac = this.platformUtils.getDevice() === DeviceType.MacOsDesktop;

  protected readonly languageOptions = LANGUAGE_OPTIONS;
  protected readonly privacyChoices = PRIVACY_CHOICES;
  protected readonly settingsOpen = signal(false);
  protected readonly autofillHelpOpen = signal(false);
  protected readonly selectedLocale = signal("");
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
    { show: "cards", glyph: "card", label: "vkCards" },
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

  constructor() {
    document.documentElement.classList.add("vk-shell");
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.online);
    void this.loadShellPreferences();
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
    this.autofillHelpOpen.update((open) => !open);
  }

  protected openQuickBar(): void {
    this.autofillHelpOpen.set(false);
    this.settingsOpen.set(false);
    const qbIpc = (globalThis as { ipc?: typeof ipc }).ipc?.quickBar;
    void qbIpc?.show?.();
  }

  protected openSettings(): void {
    this.privacyMode.set(this.inference?.getPrivacyMode() ?? "masked");
    void this.syncSelectedLocale();
    void this.loadShellPreferences();
    this.settingsOpen.set(true);
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
    this.messaging.send("openSettings");
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
