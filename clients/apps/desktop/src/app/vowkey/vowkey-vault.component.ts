import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { CipherType } from "@vowkey/common/vault/enums";
import { CipherId } from "@vowkey/common/types/guid";
import { DialogService, MenuModule } from "@vowkey/components";
import { Cipher as SdkCipher } from "@vowkey/sdk-internal";
import { I18nPipe } from "@vowkey/ui-common";
import {
  CipherFormConfig,
  CipherFormConfigService,
  CipherFormModule,
  CipherViewComponent,
  DefaultCipherFormConfigService,
  ProfileComponent,
  VaultItemDialogComponent,
} from "@vowkey/vault";

import { VowkeyGlyphComponent } from "./vowkey-glyph.component";
import { VowkeyHub } from "./vowkey-hub.service";
import { LibraryRow, LibraryShow, LibrarySort, VowkeyLibrary } from "./vowkey-library.service";

const TITLES: Record<LibraryShow, string> = {
  all: "vkAllItems",
  pinned: "vkPinned",
  profiles: "vkProfiles",
  documents: "vkDocuments",
  logins: "vkLogins",
  cards: "vkCards",
  keys: "vkKeys",
  environments: "vkEnvironments",
  expiring: "vkExpiring",
  trash: "vkRecentlyDeleted",
};

const NEW_ITEMS: {
  type: CipherType;
  label: string;
  glyph: "person" | "globe" | "card" | "key" | "layers";
}[] = [
  { type: CipherType.Identity, label: "vkProfile", glyph: "person" },
  { type: CipherType.Login, label: "vkLogin", glyph: "globe" },
  { type: CipherType.Card, label: "vkCard", glyph: "card" },
  { type: CipherType.ApiKey, label: "vkKey", glyph: "key" },
  { type: CipherType.Environment, label: "vkEnvironment", glyph: "layers" },
];

/** Search and browse on the left, the chosen item on the right, in one window. */
@Component({
  selector: "vk-vault",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    I18nPipe,
    MenuModule,
    VowkeyGlyphComponent,
    CipherFormModule,
    CipherViewComponent,
    ProfileComponent,
  ],
  providers: [{ provide: CipherFormConfigService, useClass: DefaultCipherFormConfigService }],
  template: `
    <div class="vk-page">
      <header class="vk-toolbar">
        <div class="vk-history">
          <button
            type="button"
            class="vk-icon"
            (click)="history(-1)"
            [attr.aria-label]="'back' | i18n"
          >
            <vk-glyph name="back" />
          </button>
          <button
            type="button"
            class="vk-icon"
            (click)="history(1)"
            [attr.aria-label]="'next' | i18n"
          >
            <vk-glyph name="forward" />
          </button>
        </div>
        <label class="vk-search">
          <vk-glyph name="search" [size]="16" />
          <input
            #search
            type="search"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            [placeholder]="'vkSearchPlaceholder' | i18n"
            [attr.aria-label]="'vkSearchPlaceholder' | i18n"
            autocomplete="off"
            data-testid="vowkey-search"
          />
          <kbd>{{ shortcut }}</kbd>
        </label>
        <div class="vk-new">
          <button
            type="button"
            class="vk-primary"
            [bitMenuTriggerFor]="newMenu"
            data-testid="vowkey-new"
          >
            <vk-glyph name="plus" [size]="16" />{{ "vkNew" | i18n }}
          </button>
          <bit-menu #newMenu>
            <button
              type="button"
              bitMenuItem
              data-testid="vowkey-new-document"
              (click)="addDocument()"
            >
              <vk-glyph slot="start" name="document" [size]="16" />{{ "vkDocument" | i18n }}
            </button>
            @for (entry of newItems; track entry.type) {
              <button type="button" bitMenuItem (click)="add(entry.type)">
                <vk-glyph slot="start" [name]="entry.glyph" [size]="16" />{{ entry.label | i18n }}
              </button>
            }
          </bit-menu>
        </div>
      </header>

      @if (library.rows().length === 0 && show() === "all" && !query() && !localFormConfig()) {
        <section class="vk-empty" aria-live="polite">
          <h1>{{ "vkNothingSavedYet" | i18n }}</h1>
          <p>{{ "vkEmptyBody" | i18n }}</p>
          <div class="vk-empty-actions">
            <button type="button" class="vk-primary" (click)="addDocument()">
              {{ "vkAddDocument" | i18n }}
            </button>
            <button type="button" class="vk-secondary" (click)="add(loginType)">
              {{ "vkLogin" | i18n }}
            </button>
            <button type="button" class="vk-secondary" (click)="add(identity)">
              {{ "vkEnterDetails" | i18n }}
            </button>
          </div>
        </section>
      } @else {
        <div class="vk-body">
          <section class="vk-list" [attr.aria-label]="title()">
            <header class="vk-list-head">
              <h1>{{ title() }}</h1>
              <span class="vk-total">{{ rows().length }}</span>
              <div class="vk-sort">
                <button
                  type="button"
                  class="vk-icon"
                  [attr.aria-label]="'vkSortBy' | i18n"
                  [bitMenuTriggerFor]="sortMenu"
                  menuPosition="below-end"
                >
                  <vk-glyph name="sort" />
                </button>
                <bit-menu #sortMenu>
                  @for (option of sorts; track option.value) {
                    <button
                      type="button"
                      bitMenuItem
                      role="menuitemradio"
                      [attr.aria-checked]="sort() === option.value"
                      (click)="sort.set(option.value)"
                    >
                      {{ option.label | i18n }}
                    </button>
                  }
                </bit-menu>
              </div>
            </header>
            <ul class="vk-rows" role="listbox" [attr.aria-label]="title()">
              @for (row of rows(); track row.key) {
                <li>
                  <button
                    type="button"
                    role="option"
                    class="vk-row"
                    [class.on]="row.key === selected()?.key"
                    [attr.aria-selected]="row.key === selected()?.key"
                    (click)="select(row)"
                    (dblclick)="edit(row)"
                  >
                    <span class="vk-lead" [class.person]="row.kind === 'profile'"
                      ><vk-glyph [name]="row.glyph" [size]="20"
                    /></span>
                    <span class="vk-text">
                      <b>{{ row.title }}</b>
                      <small [class.amber]="row.expired">{{ row.subtitle }}</small>
                    </span>
                    @if (row.pinned) {
                      <vk-glyph name="bookmark" [size]="14" />
                    }
                  </button>
                </li>
              } @empty {
                <li class="vk-none">{{ "vkNoMatches" | i18n }}</li>
              }
            </ul>
          </section>

          <section class="vk-detail" [attr.aria-label]="selected()?.title">
            @if (localFormConfig(); as formConfig) {
              <header class="vk-detail-head">
                <div class="vk-head-text">
                  <h2>
                    {{
                      formConfig.mode === "add"
                        ? ("vkNew" | i18n)
                        : (cipher()?.name ?? ("vkEdit" | i18n))
                    }}
                  </h2>
                </div>
                <div class="vk-head-actions">
                  <button type="button" class="vk-secondary" (click)="cancelLocalForm()">
                    {{ "cancel" | i18n }}
                  </button>
                  <button type="submit" class="vk-primary" form="vk-local-item-form">
                    {{ "save" | i18n }}
                  </button>
                </div>
              </header>
              <div class="vk-detail-body">
                <vault-cipher-form
                  formId="vk-local-item-form"
                  [config]="formConfig"
                  (cipherSaved)="onLocalSaved($event)"
                />
              </div>
            } @else if (cipher(); as current) {
              <header class="vk-detail-head">
                <span class="vk-lead big" [class.person]="selected()?.kind === 'profile'"
                  ><vk-glyph [name]="selected()!.glyph" [size]="28"
                /></span>
                <div class="vk-head-text">
                  <h2>{{ selected()!.title }}</h2>
                  <p>{{ selected()!.subtitle }}</p>
                </div>
                <div class="vk-head-actions">
                  @if (current.isDeleted) {
                    <button type="button" class="vk-secondary" (click)="restore()">
                      {{ "vkRestore" | i18n }}
                    </button>
                    <button type="button" class="vk-secondary danger" (click)="deleteForGood()">
                      {{ "vkDeleteForGood" | i18n }}
                    </button>
                  } @else {
                    @if (canQuickCopy(current)) {
                      <button type="button" class="vk-primary" (click)="quickCopy(current)">
                        {{ quickCopyLabel(current) }}
                      </button>
                    }
                    <button type="button" class="vk-secondary" (click)="edit(selected()!)">
                      <vk-glyph name="pencil" [size]="15" />{{ "vkEdit" | i18n }}
                    </button>
                    @if (library.account() == null) {
                      <button type="button" class="vk-secondary danger" (click)="deleteLocalItem()">
                        {{ "delete" | i18n }}
                      </button>
                    }
                  }
                </div>
              </header>
              <div class="vk-detail-body">
                @if (readsAsProfile()) {
                  <app-profile
                    [cipher]="current"
                    [initialSourceId]="
                      selected()?.kind === 'document' ? selected()!.sourceId : null
                    "
                  />
                } @else {
                  <app-cipher-view
                    [cipher]="current"
                    [hideItemHistory]="library.account() == null"
                  />
                }
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .vk-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        color: var(--vk-ink);
      }
      .vk-toolbar {
        display: flex;
        flex: none;
        align-items: center;
        gap: 12px;
        height: 56px;
        padding: 0 16px;
        border-bottom: 1px solid var(--vk-line);
        -webkit-app-region: drag;
      }
      :host-context(.win .vk-main) .vk-toolbar {
        padding-right: 150px;
      }
      .vk-toolbar button,
      .vk-toolbar label {
        -webkit-app-region: no-drag;
      }
      .vk-history {
        display: flex;
        gap: 2px;
      }
      .vk-icon {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: var(--vk-radius-control);
        background: none;
        color: var(--vk-muted);
        cursor: pointer;
      }
      .vk-icon:hover {
        background: var(--vk-hover);
        color: var(--vk-ink);
      }
      .vk-search {
        display: flex;
        flex: 0 1 360px;
        align-items: center;
        gap: 8px;
        height: 34px;
        padding: 0 10px;
        border-radius: var(--vk-radius-control);
        background: var(--vk-selected);
        color: var(--vk-muted);
      }
      .vk-search:focus-within {
        outline: 2px solid var(--vk-ink);
        outline-offset: 1px;
      }
      .vk-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: none;
        color: var(--vk-ink);
        font: inherit;
        font-size: 15px;
      }
      .vk-search input::placeholder {
        color: var(--vk-muted);
      }
      .vk-search kbd {
        padding: 1px 6px;
        border-radius: 6px;
        background: var(--vk-hover);
        font: inherit;
        font-size: 12px;
      }
      .vk-new {
        position: relative;
        margin-left: auto;
      }
      .vk-primary,
      .vk-secondary {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 16px;
        border: 1px solid transparent;
        border-radius: var(--vk-radius-control);
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
      }
      .vk-primary {
        background: var(--vk-blue);
        color: #fff;
      }
      .vk-primary:hover {
        background: var(--vk-blue-ink);
      }
      .vk-secondary {
        border-color: var(--vk-line);
        background: var(--vk-surface);
        color: var(--vk-ink);
        font-weight: 500;
      }
      .vk-secondary:hover {
        background: var(--vk-hover);
      }
      .vk-secondary.danger {
        color: var(--vk-red);
      }
      .vk-primary:focus-visible,
      .vk-secondary:focus-visible,
      .vk-icon:focus-visible,
      .vk-row:focus-visible {
        outline: 2px solid var(--vk-ink);
        outline-offset: 2px;
      }
      .vk-body {
        display: grid;
        grid-template-columns: minmax(260px, 314px) minmax(0, 1fr);
        flex: 1;
        min-height: 0;
      }
      .vk-list {
        display: flex;
        flex-direction: column;
        min-height: 0;
        border-right: 1px solid var(--vk-line);
      }
      .vk-list-head {
        position: relative;
        display: flex;
        flex: none;
        align-items: center;
        gap: 8px;
        height: 52px;
        padding: 0 8px 0 18px;
      }
      .vk-list-head h1 {
        margin: 0;
        overflow: hidden;
        font-size: 16px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-total {
        color: var(--vk-muted);
        font-size: 15px;
      }
      .vk-sort {
        position: relative;
        margin-left: auto;
      }
      .vk-rows {
        flex: 1;
        min-height: 0;
        margin: 0;
        padding: 0 8px 8px;
        overflow-y: auto;
        list-style: none;
      }
      .vk-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 52px;
        padding: 4px 8px;
        border: 0;
        border-radius: var(--vk-radius-row);
        background: none;
        color: var(--vk-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .vk-row:hover {
        background: var(--vk-hover);
      }
      .vk-row.on {
        background: var(--vk-selected);
      }
      .vk-lead {
        display: grid;
        place-items: center;
        flex: none;
        width: 36px;
        height: 36px;
        border-radius: var(--vk-radius-control);
        color: var(--vk-ink);
      }
      .vk-lead.person {
        border-radius: 50%;
        background: var(--vk-selected);
      }
      .vk-lead.big {
        width: 60px;
        height: 60px;
        border-radius: 14px;
        background: var(--vk-selected);
      }
      .vk-lead.big.person {
        border-radius: 50%;
      }
      .vk-text {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
      }
      .vk-text b {
        overflow: hidden;
        font-size: 15px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-text small {
        overflow: hidden;
        color: var(--vk-muted);
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-text small.amber {
        color: var(--vk-amber);
      }
      .vk-none {
        padding: 24px 12px;
        color: var(--vk-muted);
        font-size: 14px;
        text-align: center;
      }
      .vk-detail {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        background: var(--vk-canvas);
      }
      .vk-detail-head {
        display: flex;
        flex: none;
        align-items: center;
        gap: 16px;
        padding: 24px 32px 16px;
      }
      .vk-head-text {
        flex: 1;
        min-width: 0;
      }
      .vk-head-text h2 {
        margin: 0;
        overflow: hidden;
        font-size: 22px;
        font-weight: 700;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vk-head-text p {
        margin: 2px 0 0;
        color: var(--vk-muted);
        font-size: 15px;
      }
      .vk-head-actions {
        display: flex;
        gap: 8px;
      }
      .vk-detail-body {
        flex: 1;
        min-height: 0;
        padding: 0 32px 32px;
        overflow-y: auto;
      }
      .vk-empty {
        display: flex;
        flex: 1;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        text-align: center;
      }
      .vk-empty h1 {
        margin: 0;
        font-size: 26px;
        font-weight: 700;
      }
      .vk-empty p {
        max-width: 300px;
        margin: 8px 0 20px;
        color: var(--vk-muted);
        font-size: 18px;
        line-height: 1.4;
      }
      .vk-empty-actions {
        display: flex;
        gap: 10px;
      }
    `,
  ],
})
export class VowkeyVaultComponent {
  protected readonly library = inject(VowkeyLibrary);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialogs = inject(DialogService);
  private readonly forms = inject(CipherFormConfigService);
  private readonly ciphers = inject(CipherService);
  private readonly accounts = inject(AccountService);
  private readonly localVault = inject(LocalVaultService, { optional: true });
  private readonly platformUtils = inject(PlatformUtilsService, { optional: true });
  private readonly hub = inject(VowkeyHub);
  private readonly i18n = inject(I18nService);

  private readonly search = viewChild<ElementRef<HTMLInputElement>>("search");
  protected readonly identity = CipherType.Identity;
  protected readonly loginType = CipherType.Login;
  protected readonly localFormConfig = signal<CipherFormConfig | null>(null);
  protected readonly newItems = NEW_ITEMS;
  protected readonly sorts: { value: LibrarySort; label: string }[] = [
    { value: "kind", label: "vkSortKind" },
    { value: "name", label: "vkSortName" },
    { value: "changed", label: "vkSortChanged" },
  ];
  protected readonly shortcut = /Mac/.test(navigator.platform) ? "⌘K" : "Ctrl+K";

  protected readonly query = signal("");
  protected readonly sort = signal<LibrarySort>("kind");

  private readonly params = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly show = computed(() => (this.params().get("show") ?? "all") as LibraryShow);
  private readonly person = computed(() => this.params().get("person"));
  private readonly itemId = computed(() => this.params().get("item"));
  private readonly sourceId = computed(() => this.params().get("source"));

  protected readonly rows = computed(() =>
    this.library.rowsFor(this.show(), this.person(), this.query(), this.sort()),
  );
  protected readonly title = computed(() => {
    const person = this.person() ? this.library.cipherOf(this.person())?.name : null;
    return person ?? this.i18nTitle(this.show());
  });
  protected readonly selected = computed<LibraryRow | null>(() => {
    const rows = this.rows();
    return (
      rows.find(
        (row) => row.cipherId === this.itemId() && row.sourceId === (this.sourceId() ?? null),
      ) ??
      rows.find((row) => row.cipherId === this.itemId() && row.sourceId == null) ??
      rows[0] ??
      null
    );
  });
  protected readonly cipher = computed(() => this.library.cipherOf(this.selected()?.cipherId));

  private i18nTitle(show: LibraryShow): string {
    return this.i18n.t(TITLES[show]);
  }

  /** A profile reads through its envelope; one saved before envelopes shows as an ordinary item. */
  protected readsAsProfile(): boolean {
    const current = this.cipher();
    return (
      current != null &&
      (this.selected()?.kind === "document" ||
        (current.type === CipherType.Identity && readEnvelope(current) != null))
    );
  }

  @HostListener("window:keydown", ["$event"])
  protected onKey(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.search()?.nativeElement.focus();
      this.search()?.nativeElement.select();
    }
  }

  protected history(step: number): void {
    window.history.go(step);
  }

  protected select(row: LibraryRow): void {
    this.localFormConfig.set(null);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: row.cipherId, source: row.sourceId },
      queryParamsHandling: "merge",
    });
  }

  protected addDocument(): void {
    this.hub.open();
  }

  protected cancelLocalForm(): void {
    this.localFormConfig.set(null);
  }

  protected onLocalSaved(saved: CipherView): void {
    this.localFormConfig.set(null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { item: saved.id, source: null },
      queryParamsHandling: "merge",
    });
  }

  private localBaseConfig(): Pick<
    CipherFormConfig,
    "vault" | "admin" | "collections" | "folders"
  > & { organizationDataOwnershipDisabled: true; organizations: [] } {
    const folder = new FolderView();
    folder.name = this.i18n.t("noneFolder");
    return {
      vault: "local",
      admin: false,
      organizationDataOwnershipDisabled: true,
      collections: [],
      folders: [folder],
      organizations: [],
    };
  }

  protected canQuickCopy(cipher: CipherView): boolean {
    if (cipher.type === CipherType.Login) {
      return Boolean(cipher.login?.password || cipher.login?.username);
    }
    if (cipher.type === CipherType.ApiKey) {
      return Boolean(cipher.apiKey?.value);
    }
    if (cipher.type === CipherType.Card) {
      return Boolean(cipher.card?.number);
    }
    return false;
  }

  protected quickCopyLabel(cipher: CipherView): string {
    if (cipher.type === CipherType.Login) {
      return cipher.login?.password ? "Copy password" : "Copy username";
    }
    if (cipher.type === CipherType.ApiKey) {
      return "Copy key";
    }
    return "Copy number";
  }

  protected quickCopy(cipher: CipherView): void {
    const secret =
      cipher.type === CipherType.Login
        ? (cipher.login?.password || cipher.login?.username || "")
        : cipher.type === CipherType.ApiKey
          ? (cipher.apiKey?.value ?? "")
          : (cipher.card?.number ?? "");
    if (!secret) {
      return;
    }
    this.platformUtils?.copyToClipboard(secret);
    this.platformUtils?.showToast("success", null, "Copied to clipboard");
  }

  protected async add(type: CipherType): Promise<void> {
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      await this.localVault.initialize();
      await this.localVault.ensureUnlocked();
      this.localFormConfig.set({
        ...this.localBaseConfig(),
        mode: "add",
        cipherType: type,
      });
      return;
    }
    const formConfig = await this.forms.buildConfig("add", undefined, type);
    await VaultItemDialogComponent.openDrawer(this.dialogs, { mode: "form", formConfig });
  }

  protected async edit(row: LibraryRow): Promise<void> {
    const cipher = this.library.cipherOf(row.cipherId);
    if (!cipher || cipher.isDeleted) {
      return;
    }
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (!account) {
      if (!this.localVault) {
        return;
      }
      const encrypted = await this.localVault.store.get<SdkCipher>("ciphers", cipher.id);
      const originalCipher = encrypted == null ? null : Cipher.fromSdkCipher(encrypted);
      if (!originalCipher) {
        return;
      }
      this.localFormConfig.set({
        ...this.localBaseConfig(),
        mode: "edit",
        cipherType: cipher.type,
        originalCipher,
      });
      return;
    }
    const formConfig = await this.forms.buildConfig(
      cipher.edit ? "edit" : "partial-edit",
      cipher.id as CipherId,
      cipher.type,
    );
    await VaultItemDialogComponent.openDrawer(this.dialogs, { mode: "form", formConfig });
  }

  protected async deleteLocalItem(): Promise<void> {
    const cipher = this.cipher();
    if (!cipher || !this.localVault) {
      return;
    }
    await this.localVault.ensureUnlocked();
    const attachments = await this.localVault.store.list<{ cipherId: string }>("attachments");
    await this.localVault.store.commit([
      { store: "ciphers", id: cipher.id },
      ...attachments
        .filter((a) => a.value.cipherId === cipher.id)
        .map((a) => ({ store: "attachments" as const, id: a.id })),
    ]);
    this.localFormConfig.set(null);
    this.library.refreshLocal();
    this.hub.notifyChanged();
  }

  protected async restore(): Promise<void> {
    const cipher = this.cipher();
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (cipher && account) {
      await this.ciphers.restoreWithServer(cipher.id, account.id);
    }
  }

  protected async deleteForGood(): Promise<void> {
    const cipher = this.cipher();
    const account = await firstValueFrom(this.accounts.activeAccount$);
    if (cipher && account && window.confirm(`Delete ${cipher.name} for good?`)) {
      await this.ciphers.deleteWithServer(cipher.id, account.id);
    }
  }
}
