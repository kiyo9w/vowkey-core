import { ChangeDetectionStrategy, Component, computed, HostListener, inject, OnDestroy, signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { filter, map, startWith } from "rxjs";

import { DeviceType } from "@vowkey/common/enums";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { I18nPipe } from "@vowkey/ui-common";

import { GlyphName, VowkeyGlyphComponent } from "./vowkey-glyph.component";
import { LibraryShow, VowkeyLibrary } from "./vowkey-library.service";

interface NavEntry {
  show: LibraryShow;
  glyph: GlyphName;
  label: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? "?"];
  return letters.map((part) => Array.from(part)[0]).join("").toLocaleUpperCase();
}

/** The Vowkey window: a translucent sidebar beside the page, one place for every destination. */
@Component({
  selector: "vk-shell",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, I18nPipe, VowkeyGlyphComponent],
  template: `
    <div class="vk-window" [class.mac]="mac" [class.win]="!mac">
      <aside class="vk-side" [attr.aria-label]="'vkLibrary' | i18n">
        <div class="vk-side-top"></div>
        <button
          type="button"
          class="vk-account"
          aria-haspopup="menu"
          [attr.aria-expanded]="menuOpen()"
          (click)="menuOpen.set(!menuOpen())"
        >
          <span class="vk-avatar" aria-hidden="true">{{ initials() }}</span>
          <span class="vk-account-text">
            <b>{{ name() }}</b>
            <small>{{ (library.online() ? "vkSynced" : "vkOffline") | i18n }}</small>
          </span>
          <vk-glyph name="chevrons" [size]="14" />
        </button>
        @if (menuOpen()) {
          <div class="vk-menu" role="menu" (click)="menuOpen.set(false)">
            <button type="button" role="menuitem" (click)="lock()">
              <vk-glyph name="lock" [size]="16" />{{ "vkLockVowkey" | i18n }}<kbd>{{ mac ? "⌘L" : "Ctrl+L" }}</kbd>
            </button>
            <button type="button" role="menuitem" (click)="openSettings()">
              <vk-glyph name="gear" [size]="16" />{{ "vkSettings" | i18n }}<kbd>{{ mac ? "⌘," : "Ctrl+," }}</kbd>
            </button>
            <hr />
            <button type="button" role="menuitem" (click)="logOut()">{{ "vkLogOut" | i18n }}</button>
          </div>
        }

        <nav class="vk-nav" aria-label="Vowkey">
          @for (entry of top; track entry.show) {
            <a
              class="vk-item"
              routerLink="/vault"
              [queryParams]="{ show: entry.show === 'all' ? null : entry.show, person: null, item: null, source: null }"
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
                <span class="vk-dot" aria-hidden="true">{{ initials_(profile.name) }}</span>{{ profile.name }}
              </a>
            }
          }

          <h2 class="vk-label">{{ "vkReminders" | i18n }}</h2>
          <a
            class="vk-item"
            routerLink="/vault"
            [queryParams]="{ show: 'expiring', person: null, item: null, source: null }"
            [class.on]="isOn('expiring', null)"
          >
            <vk-glyph name="clock" />{{ "vkExpiring" | i18n }}
            @if (library.expiringCount() > 0) {
              <span class="vk-count">{{ library.expiringCount() }}</span>
            }
          </a>

          <h2 class="vk-label">{{ "vkConnected" | i18n }}</h2>
          <a class="vk-item" routerLink="/agents" [class.on]="url().startsWith('/agents')">
            <vk-glyph name="bot" />{{ "vkAiAgents" | i18n }}
          </a>
        </nav>

        <div class="vk-foot">
          <a
            class="vk-item"
            routerLink="/vault"
            [queryParams]="{ show: 'trash', person: null, item: null, source: null }"
            [class.on]="isOn('trash', null)"
          >
            <vk-glyph name="trash" />{{ "vkRecentlyDeleted" | i18n }}
          </a>
          <button type="button" class="vk-item" (click)="openSettings()">
            <vk-glyph name="gear" />{{ "vkSettings" | i18n }}
          </button>
        </div>
      </aside>

      <main class="vk-main">
        <router-outlet />
      </main>
    </div>
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
        position: absolute;
        z-index: 20;
        top: 96px;
        left: 12px;
        width: 230px;
        padding: 6px;
        border: 1px solid var(--vk-line);
        border-radius: var(--vk-radius-panel);
        background: var(--vk-glass);
        backdrop-filter: blur(24px);
        box-shadow: var(--vk-shadow-panel);
      }
      .vk-menu button {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 10px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: inherit;
        font: inherit;
        font-size: 14px;
        text-align: left;
        cursor: pointer;
      }
      .vk-menu button:hover {
        background: var(--vk-hover);
      }
      .vk-menu kbd {
        margin-left: auto;
        color: var(--vk-faint);
        font: inherit;
        font-size: 12px;
      }
      .vk-menu hr {
        margin: 4px 6px;
        border: 0;
        border-top: 1px solid var(--vk-line);
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
      .vk-item:focus-visible,
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
        overflow: hidden;
        text-overflow: ellipsis;
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
      .vk-main {
        position: relative;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        background: var(--vk-window);
      }
    `,
  ],
})
export class VowkeyShellComponent implements OnDestroy {
  protected readonly library = inject(VowkeyLibrary);
  private readonly router = inject(Router);
  private readonly messaging = inject(MessagingService);
  protected readonly mac = inject(PlatformUtilsService).getDevice() === DeviceType.MacOsDesktop;

  protected readonly menuOpen = signal(false);
  protected readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );
  private readonly query = computed(() => new URLSearchParams(this.url().split("?")[1] ?? ""));

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
    { show: "profiles", glyph: "person", label: "vkProfiles" },
    { show: "documents", glyph: "document", label: "vkDocuments" },
    { show: "logins", glyph: "globe", label: "vkLogins" },
    { show: "cards", glyph: "card", label: "vkCards" },
    { show: "keys", glyph: "key", label: "vkKeys" },
    { show: "environments", glyph: "layers", label: "vkEnvironments" },
  ];

  private readonly online = () => this.library.online.set(navigator.onLine);

  constructor() {
    document.documentElement.classList.add("vk-shell");
    window.addEventListener("online", this.online);
    window.addEventListener("offline", this.online);
  }

  ngOnDestroy(): void {
    document.documentElement.classList.remove("vk-shell");
    window.removeEventListener("online", this.online);
    window.removeEventListener("offline", this.online);
  }

  protected isOn(show: LibraryShow | null, person: string | null): boolean {
    if (!this.url().startsWith("/vault")) {
      return false;
    }
    const current = (this.query().get("show") ?? "all") as LibraryShow;
    const currentPerson = this.query().get("person");
    return person != null ? currentPerson === person : currentPerson == null && show === current;
  }

  @HostListener("window:keydown", ["$event"])
  protected onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && this.menuOpen()) {
      this.menuOpen.set(false);
    }
  }

  protected lock(): void {
    this.messaging.send("lockVault");
  }

  protected openSettings(): void {
    this.messaging.send("openSettings");
  }

  protected logOut(): void {
    this.messaging.send("logout", { userInitiated: true });
  }
}
