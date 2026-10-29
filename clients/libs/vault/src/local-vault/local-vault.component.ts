import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterModule } from "@angular/router";
import { Subscription } from "rxjs";
import { Cipher as SdkCipher } from "@vowkey/sdk-internal";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ClientType } from "@vowkey/common/enums";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { ButtonModule } from "@vowkey/components";
import { I18nPipe } from "@vowkey/ui-common";

import { CipherFormConfig } from "../cipher-form/abstractions/cipher-form-config.service";
import { CipherFormModule } from "../cipher-form/cipher-form.module";
import { CipherViewComponent } from "../cipher-view/cipher-view.component";
import { AgentManagementComponent } from "../agent-management/agent-management.component";
import { LOCAL_AGENT_MANAGEMENT } from "../agent-management/local-agent-management";

@Component({
  selector: "vault-local-vault",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ButtonModule, I18nPipe, CipherFormModule, CipherViewComponent, AgentManagementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="local-vault">
      <aside>
        <h1>Vowkey</h1>
        <p class="scope">{{ 'vowkeyLocalVault' | i18n }}</p>
        <nav [attr.aria-label]="'filter' | i18n">
          <button type="button" [attr.aria-pressed]="!showAgents() && filter() === null" (click)="filter.set(null); showAgents.set(false)">{{ 'allItems' | i18n }}</button>
          @for (kind of kinds; track kind.type) {
            <button type="button" [attr.aria-pressed]="!showAgents() && filter() === kind.type" (click)="filter.set(kind.type); showAgents.set(false)">{{ kind.label | i18n }}</button>
          }
        </nav>
        <div class="account-links">
          @if (agentManagement != null) { <button type="button" [attr.aria-pressed]="showAgents()" (click)="showAgents.set(true)">{{ 'vowkeyAgents' | i18n }}</button> }
          <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
          <a routerLink="/login">{{ 'logIn' | i18n }}</a>
          @if (!native && !hasPassword() && !locked()) { <button type="button" (click)="protecting.set(true)">{{ 'vowkeyLocalSetPassword' | i18n }}</button> }
          @if (canLock() && !locked()) { <button type="button" (click)="lock()">{{ 'lock' | i18n }}</button> }
        </div>
      </aside>
      <section class="workspace">
        @if (error()) { <p class="notice" role="alert">{{ error() }}</p> }
        @if (locked()) {
          <form class="unlock" (ngSubmit)="unlock()">
            <h2>{{ 'unlock' | i18n }}</h2>
            @if (hasPassword()) {
              <label>{{ 'vowkeyLocalPassword' | i18n }}<input type="password" name="password" [(ngModel)]="password" autocomplete="current-password" required /></label>
            } @else if (!native) {
              <p>{{ 'vowkeyLocalSessionEnded' | i18n }}</p>
            }
            @if (hasPassword() || native) { <button bitButton buttonType="primary" type="submit" [disabled]="busy()">{{ 'unlock' | i18n }}</button> }
          </form>
        } @else if (ready()) {
          <header>
            <input type="search" [attr.aria-label]="'search' | i18n" [placeholder]="'search' | i18n" [ngModel]="search()" (ngModelChange)="search.set($event)" />
            <details class="new-menu"><summary>{{ 'new' | i18n }}</summary>
              <div>@for (kind of kinds; track kind.type) { <button type="button" (click)="create(kind.type, $event)">{{ kind.label | i18n }}</button> }</div>
            </details>
          </header>
          @if (offer() || protecting()) {
            <section class="protection-offer">
              <p>{{ 'vowkeyLocalKeepOffer' | i18n }}</p>
              <a routerLink="/signup">{{ 'createAccount' | i18n }}</a>
              @if (!native && !hasPassword()) {
                <form (ngSubmit)="protect()"><label>{{ 'vowkeyLocalPassword' | i18n }}<input type="password" name="newPassword" [(ngModel)]="newPassword" autocomplete="new-password" required /></label>
                  <button bitButton buttonType="secondary" type="submit" [disabled]="busy()">{{ 'vowkeyLocalSetPassword' | i18n }}</button>
                </form>
              }
              <button type="button" (click)="dismissOffer()">{{ 'close' | i18n }}</button>
            </section>
          }
          @if (showAgents()) {
            <vault-agent-management />
          } @else {
          <div class="panes">
            <section class="item-list" [attr.aria-label]="'allItems' | i18n">
              @for (item of visible(); track item.id) {
                <button type="button" [attr.aria-pressed]="selected()?.id === item.id" (click)="select(item)">
                  <strong>{{ item.name }}</strong><small>{{ typeLabel(item.type) | i18n }}</small>
                </button>
              } @empty { <p>{{ 'vowkeyLocalEmpty' | i18n }}</p> }
            </section>
            <section class="item-detail">
              @if (config(); as formConfig) {
                <div class="detail-actions"><button bitButton buttonType="secondary" type="button" (click)="config.set(null)">{{ 'cancel' | i18n }}</button>
                  <button bitButton buttonType="primary" type="submit" form="local-item-form">{{ 'save' | i18n }}</button></div>
                <vault-cipher-form formId="local-item-form" [config]="formConfig" (cipherSaved)="saved($event)" />
              } @else if (selected(); as item) {
                <div class="detail-actions"><button bitButton buttonType="secondary" type="button" (click)="edit(item)">{{ 'edit' | i18n }}</button></div>
                <app-cipher-view [cipher]="item" [hideChangePasswordLink]="true" />
              }
            </section>
          </div>
          }
        }
      </section>
    </main>
  `,
  styles: [`
    :host{display:block;height:100%;color:rgb(var(--color-text-main))}.local-vault{display:grid;grid-template-columns:210px minmax(0,1fr);min-height:100vh;background:rgb(var(--color-background-alt))}aside{display:flex;flex-direction:column;padding:24px 14px;border-right:1px solid rgb(var(--color-secondary-300))}h1{font-size:22px;font-weight:700;margin:0 10px 4px}.scope{margin:0 10px 24px;font-size:13px;opacity:.7}nav{display:grid;gap:4px}nav button,.account-links button{border:0;background:none;text-align:left;padding:10px 12px;border-radius:8px;color:inherit}button[aria-pressed=true]{background:rgb(var(--color-secondary-100));font-weight:600}.account-links{display:grid;gap:12px;margin:24px 10px}.workspace{min-width:0}header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 24px;border-bottom:1px solid rgb(var(--color-secondary-300));background:rgb(var(--color-background))}header input{max-width:420px;width:100%;padding:8px 12px;border:1px solid rgb(var(--color-secondary-300));border-radius:8px;background:transparent;color:inherit}.new-menu{position:relative}.new-menu summary{cursor:pointer;padding:8px 16px;border-radius:8px;background:rgb(var(--color-primary-600));color:rgb(var(--color-text-contrast))}.new-menu>div{position:absolute;right:0;top:100%;z-index:2;min-width:180px;padding:6px;border:1px solid rgb(var(--color-secondary-300));border-radius:10px;background:rgb(var(--color-background));box-shadow:0 8px 24px #0002}.new-menu button{display:block;width:100%;border:0;padding:8px 12px;text-align:left;background:none;color:inherit}.panes{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:75vh}.item-list{padding:10px;border-right:1px solid rgb(var(--color-secondary-300));background:rgb(var(--color-background))}.item-list>button{display:block;width:100%;text-align:left;border:0;border-radius:8px;background:none;padding:12px;color:inherit}.item-list>button[aria-pressed=true]{background:rgb(var(--color-secondary-100))}.item-list strong{display:block;font-size:14px}.item-list small{font-size:12px;opacity:.65}.item-list p{padding:12px;font-size:14px}.item-detail{min-width:0;padding:24px}.detail-actions{display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px}.notice,.protection-offer{padding:16px 24px}.protection-offer{border-bottom:1px solid rgb(var(--color-secondary-300));display:flex;align-items:center;flex-wrap:wrap;gap:16px}.protection-offer form{display:flex;align-items:end;gap:8px}.unlock{max-width:400px;margin:80px auto;padding:24px}.unlock h2{font-size:22px;font-weight:700;margin-bottom:16px}label{display:grid;gap:6px;font-size:14px;margin-bottom:12px}label input{border:1px solid rgb(var(--color-secondary-300));border-radius:8px;padding:8px;background:transparent;color:inherit}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid rgb(var(--color-primary-600));outline-offset:2px}@media(max-width:800px){.local-vault{grid-template-columns:150px minmax(0,1fr)}.panes{grid-template-columns:180px minmax(0,1fr)}.item-detail{padding:16px}}@media(max-width:600px){.local-vault{display:block}aside{padding:12px;border-right:0;border-bottom:1px solid rgb(var(--color-secondary-300))}aside h1{font-size:18px}.scope{margin-bottom:8px}nav{display:flex;overflow:auto}nav button{white-space:nowrap}.account-links{display:flex;margin:12px 10px 0;font-size:13px}.panes{display:block}.item-list{border-right:0;border-bottom:1px solid rgb(var(--color-secondary-300));max-height:240px;overflow:auto}}
  `],
})
export class LocalVaultComponent implements OnInit, OnDestroy {
  private readonly vault = inject(LocalVaultService);
  private readonly accounts = inject(AccountService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  readonly native = inject(PlatformUtilsService).getClientType() === ClientType.Desktop;
  readonly agentManagement = inject(LOCAL_AGENT_MANAGEMENT, { optional: true });
  readonly showAgents = signal(false);
  readonly items = signal<CipherView[]>([]);
  readonly selected = signal<CipherView | null>(null);
  readonly config = signal<CipherFormConfig | null>(null);
  readonly search = signal("");
  readonly filter = signal<CipherType | null>(null);
  readonly locked = signal(false);
  readonly ready = signal(false);
  readonly hasPassword = signal(false);
  readonly offer = signal(false);
  readonly protecting = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly canLock = computed(() => this.native || this.hasPassword());
  readonly kinds = [
    { type: CipherType.Login, label: "typeLogin" }, { type: CipherType.Identity, label: "profile" },
    { type: CipherType.Card, label: "typeCard" }, { type: CipherType.SecureNote, label: "typeSecureNote" },
    { type: CipherType.ApiKey, label: "typeApiKey" }, { type: CipherType.Environment, label: "typeEnvironment" },
  ];
  readonly visible = computed(() => {
    const query = this.search().toLocaleLowerCase();
    return this.items().filter((item) => (this.filter() == null || item.type === this.filter()) && item.name.toLocaleLowerCase().includes(query));
  });
  password = "";
  newPassword = "";
  private readonly subscriptions = new Subscription();
  private generation = 0;

  ngOnInit(): void {
    this.subscriptions.add(this.accounts.activeAccount$.subscribe((account) => {
      if (account != null) { this.clear(); void this.router.navigate(["/vault"]); }
    }));
    this.subscriptions.add(this.vault.state$.subscribe((state) => {
      this.locked.set(state === "persisted-locked");
      if (state === "persisted-locked") { this.clear(); }
    }));
    void this.act(async () => {
      await this.vault.initialize();
      this.hasPassword.set((await this.vault.protectionMetadata())?.wrappedUserKey != null);
      if (this.vault.state$.value === "empty") { await this.vault.ensureUnlocked(); }
      if (this.vault.state$.value !== "persisted-locked") { await this.refresh(); }
      this.ready.set(true);
    });
  }
  ngOnDestroy(): void { this.subscriptions.unsubscribe(); this.clear(); }
  private clear(): void {
    this.generation++; this.items.set([]); this.selected.set(null); this.config.set(null);
    this.password = ""; this.newPassword = ""; this.protecting.set(false);
  }
  typeLabel(type: CipherType): string { return this.kinds.find((kind) => kind.type === type)?.label ?? "item"; }
  select(item: CipherView): void { this.config.set(null); this.selected.set(item); }
  create(type: CipherType, event: Event): void {
    this.showAgents.set(false);
    (event.target as HTMLElement).closest("details")?.removeAttribute("open");
    this.selected.set(null); this.config.set({ ...this.baseConfig(), mode: "add", cipherType: type });
  }
  edit(item: CipherView): Promise<void> {
    return this.act(async () => {
      const encrypted = await this.vault.store.get<SdkCipher>("ciphers", item.id);
      const originalCipher = encrypted == null ? null : Cipher.fromSdkCipher(encrypted);
      if (originalCipher == null) { throw new Error(this.i18n.t("vowkeyLocalItemUnavailable")); }
      this.config.set({ ...this.baseConfig(), mode: "edit", cipherType: item.type, originalCipher });
    });
  }
  private baseConfig(): Pick<CipherFormConfig, "vault" | "admin" | "collections" | "folders"> &
    { organizationDataOwnershipDisabled: true; organizations: [] } {
    const folder = new FolderView(); folder.name = this.i18n.t("noneFolder");
    return { vault: "local" as const, admin: false, organizationDataOwnershipDisabled: true as const,
      collections: [], folders: [folder], organizations: [] };
  }
  saved(item: CipherView): Promise<void> {
    this.config.set(null); this.selected.set(item);
    return this.act(() => this.refresh());
  }
  unlock(): Promise<void> {
    return this.act(async () => { await this.vault.unlock(this.password); this.password = ""; await this.refresh(); });
  }
  lock(): Promise<void> { return this.act(() => this.vault.lock()); }
  protect(): Promise<void> {
    return this.act(async () => {
      await this.vault.setPassword(this.newPassword); this.newPassword = "";
      this.hasPassword.set(true);
      await this.vault.dismissProtectionOffer(); this.offer.set(false); this.protecting.set(false);
    });
  }
  dismissOffer(): Promise<void> {
    return this.act(async () => { await this.vault.dismissProtectionOffer(); this.offer.set(false); this.protecting.set(false); });
  }
  private async refresh(): Promise<void> {
    const generation = this.generation;
    const items = await this.vault.list();
    const offer = await this.vault.afterFillOffer();
    if (generation !== this.generation) { return; }
    this.items.set(items); this.offer.set(offer.show);
    const id = this.selected()?.id;
    this.selected.set(items.find((item) => item.id === id) ?? items[0] ?? null);
  }
  private async act(action: () => Promise<unknown>): Promise<void> {
    if (this.busy()) { return; }
    this.busy.set(true); this.error.set("");
    try { await action(); }
    catch (error) { this.error.set(error instanceof Error ? error.message : this.i18n.t("unexpectedError")); }
    finally { this.busy.set(false); }
  }
}
