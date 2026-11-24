// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, DestroyRef, inject, NgZone, OnInit, Optional, ViewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute } from "@angular/router";
import { combineLatest, firstValueFrom, from, map, of, switchMap, take } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { uuidAsString } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { CipherId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { fillableProfileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import { CipherViewLikeUtils } from "@vowkey/common/vault/utils/cipher-view-like-utils";
import {
  DisclosureComponent,
  DisclosureTriggerForDirective,
  IconButtonModule,
} from "@vowkey/components";

import BrowserPopupUtils from "../../../../../platform/browser/browser-popup-utils";
import { runInsideAngular } from "../../../../../platform/browser/run-inside-angular.operator";
import { VaultPopupAutofillService } from "../../../services/vault-popup-autofill.service";
import { VaultPopupItemsService } from "../../../services/vault-popup-items.service";
import { VaultPopupListFiltersService } from "../../../services/vault-popup-list-filters.service";
import { VaultListFiltersComponent } from "../vault-list-filters/vault-list-filters.component";
import { VaultSearchComponent } from "../vault-search/vault-search.component";

const ACTIVE_PROFILE_STORAGE_KEY = "vowkey.activeProfileId";
const AI_MODE_STORAGE_KEY = "vk_aiMode";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-vault-header",
  templateUrl: "vault-header.component.html",
  imports: [
    VaultSearchComponent,
    VaultListFiltersComponent,
    DisclosureComponent,
    IconButtonModule,
    DisclosureTriggerForDirective,
    CommonModule,
    JslibModule,
  ],
})
export class VaultHeaderComponent implements OnInit {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @ViewChild(DisclosureComponent) disclosure: DisclosureComponent;

  private readonly destroyRef = inject(DestroyRef);

  profiles: CipherView[] = [];
  selectedProfileId = "";
  extFillNotice = "";
  /** AI mode: Fill also hands the tab to the desktop app's AI agent. */
  aiMode = false;

  /** Emits the visibility status of the disclosure component. */
  protected isDisclosureShown$ = this.vaultPopupListFiltersService.filterVisibilityState$.pipe(
    runInsideAngular(inject(NgZone)), // Browser state updates can happen outside of `ngZone`
    map((v) => v ?? false),
  );

  // Only use the first value to avoid an infinite loop from two-way binding
  protected initialDisclosureVisibility$ = this.isDisclosureShown$.pipe(take(1));

  protected numberOfAppliedFilters$ = this.vaultPopupListFiltersService.numberOfAppliedFilters$;

  /** Emits true when the number of filters badge should be applied. */
  protected showBadge$ = combineLatest([
    this.numberOfAppliedFilters$,
    this.isDisclosureShown$,
  ]).pipe(map(([numberOfFilters, disclosureShown]) => numberOfFilters !== 0 && !disclosureShown));

  protected buttonSupportingText$ = this.numberOfAppliedFilters$.pipe(
    map((numberOfFilters) => {
      if (numberOfFilters === 0) {
        return null;
      }
      if (numberOfFilters === 1) {
        return this.i18nService.t("filterApplied");
      }

      return this.i18nService.t("filterAppliedPlural", numberOfFilters);
    }),
  );

  constructor(
    private vaultPopupListFiltersService: VaultPopupListFiltersService,
    private i18nService: I18nService,
    @Optional() private cipherService?: CipherService,
    @Optional() private accountService?: AccountService,
    @Optional() private localVaultService?: LocalVaultService,
    @Optional() private vaultPopupAutofillService?: VaultPopupAutofillService,
    @Optional() private vaultPopupItemsService?: VaultPopupItemsService,
    @Optional() private activatedRoute?: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.selectedProfileId = this.readStoredActiveProfileId();
    void this.loadAiMode();
    this.syncStoredActiveProfileIdFromChrome();

    if (this.activatedRoute?.snapshot?.queryParamMap?.get("action") === "fill-file") {
      this.extFillNotice = this.tr(
        "vkExtChooseOfficeForm",
        "Choose a Word (.docx), Excel (.xlsx), or Hangul (.hwpx) form to fill.",
      );
    }

    if (typeof this.accountService?.activeAccount$?.pipe === "function") {
      this.accountService.activeAccount$
        .pipe(
          map((account) => account?.id ?? null),
          switchMap((userId) => {
            if (userId != null && typeof this.cipherService?.cipherViews$ === "function") {
              return this.cipherService.cipherViews$(userId).pipe(map((views) => views ?? []));
            }
            if (userId == null && typeof this.localVaultService?.state$?.pipe === "function") {
              return this.localVaultService.state$.pipe(
                switchMap(() => from(this.readLocalCiphers())),
              );
            }
            return of([] as CipherView[]);
          }),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((ciphers) => {
          this.updateProfiles(ciphers);
        });
    } else if (typeof this.localVaultService?.state$?.pipe === "function") {
      this.localVaultService.state$
        .pipe(
          switchMap(() => from(this.readLocalCiphers())),
          takeUntilDestroyed(this.destroyRef),
        )
        .subscribe((ciphers) => {
          this.updateProfiles(ciphers);
        });
    }
  }

  get selectedProfile(): CipherView | null {
    if (!this.profiles.length) {
      return null;
    }
    return this.profiles.find((p) => p.id === this.selectedProfileId) ?? this.profiles[0] ?? null;
  }

  onProfileSelectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const nextId = select?.value ?? "";
    this.setActiveProfileId(nextId);
  }

  setActiveProfileId(profileId: string): void {
    this.selectedProfileId = profileId;
    try {
      globalThis.localStorage?.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
    } catch {
      // Storage unavailable in restricted context.
    }
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        void chrome.storage.local.set({ [ACTIVE_PROFILE_STORAGE_KEY]: profileId });
      }
    } catch {
      // Extension storage unavailable in unit test context.
    }
  }

  async toggleAiMode(): Promise<void> {
    this.aiMode = !this.aiMode;
    try {
      await chrome?.storage?.local?.set({ [AI_MODE_STORAGE_KEY]: this.aiMode });
    } catch {
      // Extension storage unavailable in unit test context.
    }
  }

  private async loadAiMode(): Promise<void> {
    try {
      const stored = await chrome?.storage?.local?.get(AI_MODE_STORAGE_KEY);
      this.aiMode = stored?.[AI_MODE_STORAGE_KEY] === true;
    } catch {
      this.aiMode = false;
    }
  }

  async fillThisPage(): Promise<void> {
    if (this.aiMode) {
      await this.aiFillThisPage();
      return;
    }
    await this.instantFill();
  }

  /**
   * Fills what the instant fill recognises, then asks the desktop app to run the chosen AI agent
   * on the tab in front. The popup closes so the page has focus when the agent starts.
   */
  private async aiFillThisPage(): Promise<void> {
    try {
      await this.instantFill();
    } catch {
      // The agent fills whatever the instant fill could not.
    }
    this.extFillNotice = this.tr(
      "vkExtAiHandoff",
      "Vowkey on your Mac is filling this page with your AI agent.",
    );
    const frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = "vowkey://ai-fill";
    document.body.appendChild(frame);
    setTimeout(() => {
      frame.remove();
      if (BrowserPopupUtils.inPopup(window) && !BrowserPopupUtils.inPopout(window)) {
        window.close();
      }
    }, 900);
  }

  private async instantFill(): Promise<void> {
    this.extFillNotice = "";
    const profile = this.selectedProfile ?? (await this.resolveSelectedOrFirstProfile());
    if (profile != null && this.vaultPopupAutofillService != null) {
      await this.vaultPopupAutofillService.doAutofill(profile, true);
      return;
    }

    if (
      this.vaultPopupItemsService?.autoFillCiphers$ != null &&
      this.vaultPopupAutofillService != null
    ) {
      const suggestions = await firstValueFrom(this.vaultPopupItemsService.autoFillCiphers$);
      const top = suggestions[0];
      if (top != null) {
        if (!CipherViewLikeUtils.isCipherListView(top)) {
          await this.vaultPopupAutofillService.doAutofill(top, true);
          return;
        }
        const active = this.accountService?.activeAccount$
          ? await firstValueFrom(this.accountService.activeAccount$)
          : null;
        if (active?.id && typeof this.cipherService?.cipherView$ === "function") {
          const full = await firstValueFrom(
            this.cipherService.cipherView$(active.id, uuidAsString(top.id) as CipherId),
          );
          if (full != null) {
            await this.vaultPopupAutofillService.doAutofill(full, true);
            return;
          }
        }
      }
    }

    this.extFillNotice = this.tr(
      "vkExtCreateProfileFirst",
      "Create a profile first, then select Fill this page.",
    );
  }

  async toggleFilters(isShown: boolean) {
    await this.vaultPopupListFiltersService.updateFilterVisibility(isShown);
  }

  async openFillForm(input: HTMLInputElement) {
    if (
      typeof window !== "undefined" &&
      BrowserPopupUtils.inPopup(window) &&
      !BrowserPopupUtils.inPopout(window) &&
      !BrowserPopupUtils.inSidebar(window) &&
      typeof chrome !== "undefined" &&
      chrome.windows
    ) {
      await BrowserPopupUtils.openPopout("popup/index.html#/tabs/vault?action=fill-file");
      return;
    }
    input.click();
  }

  private readStoredActiveProfileId(): string {
    try {
      return globalThis.localStorage?.getItem(ACTIVE_PROFILE_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  }

  private syncStoredActiveProfileIdFromChrome(): void {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(ACTIVE_PROFILE_STORAGE_KEY, (items) => {
          const saved = items?.[ACTIVE_PROFILE_STORAGE_KEY];
          if (typeof saved === "string" && saved && !this.selectedProfileId) {
            this.selectedProfileId = saved;
          }
        });
      }
    } catch {
      // Extension storage unavailable in unit test context.
    }
  }

  private async readLocalCiphers(): Promise<CipherView[]> {
    if (!this.localVaultService) {
      return [];
    }
    await this.localVaultService.initialize();
    if (this.localVaultService.state$.value === "persisted-locked") {
      return [];
    }
    return await this.localVaultService.list();
  }

  private updateProfiles(ciphers: CipherView[]): void {
    const activeProfiles = (ciphers ?? [])
      .filter((c) => c.type === CipherType.Identity && !c.isDeleted && !(c as any).archivedDate)
      .slice()
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) {
          return a.favorite ? -1 : 1;
        }
        const aUsed = a.localData?.lastUsedDate ?? a.revisionDate?.getTime?.() ?? 0;
        const bUsed = b.localData?.lastUsedDate ?? b.revisionDate?.getTime?.() ?? 0;
        if (aUsed !== bUsed) {
          return bUsed - aUsed;
        }
        return (a.name ?? "").localeCompare(b.name ?? "");
      });

    this.profiles = activeProfiles;
    if (!activeProfiles.length) {
      this.selectedProfileId = "";
      return;
    }
    if (!activeProfiles.some((p) => p.id === this.selectedProfileId)) {
      this.setActiveProfileId(activeProfiles[0].id);
    }
  }

  private async resolveSelectedOrFirstProfile(): Promise<CipherView | null> {
    if (this.selectedProfile != null) {
      return this.selectedProfile;
    }
    const active = this.accountService?.activeAccount$
      ? await firstValueFrom(this.accountService.activeAccount$)
      : null;
    if (active?.id && typeof this.cipherService?.getAllDecrypted === "function") {
      const all = await this.cipherService.getAllDecrypted(active.id);
      this.updateProfiles(all ?? []);
      return this.selectedProfile;
    }
    if (this.localVaultService != null) {
      const local = await this.readLocalCiphers();
      this.updateProfiles(local);
      return this.selectedProfile;
    }
    return null;
  }

  private tr(key: string, fallback: string, p1?: string | number, p2?: string | number): string {
    const translated = this.i18nService.t(
      key,
      p1 != null ? String(p1) : undefined,
      p2 != null ? String(p2) : undefined,
    );
    return translated && translated !== key ? translated : fallback;
  }

  async onExtFormSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      this.extFillNotice = this.tr(
        "vkExtPdfRunsInDesktop",
        "PDF file filling runs in Vowkey for Desktop so flat and scanned PDFs stay on your device. Word (.docx), Excel (.xlsx), and Hangul (.hwpx) forms fill right here.",
      );
      return;
    }
    if (!lower.endsWith(".docx") && !lower.endsWith(".xlsx") && !lower.endsWith(".hwpx")) {
      this.extFillNotice = this.tr(
        "vkExtChooseOfficeForm",
        "Choose a Word (.docx), Excel (.xlsx), or Hangul (.hwpx) form to fill.",
      );
      return;
    }
    const profile = await this.resolveSelectedOrFirstProfile();
    if (!profile) {
      this.extFillNotice = this.tr(
        "vkExtCreateProfileFirst",
        "Create a profile first, then choose a form to fill.",
      );
      return;
    }
    await SdkLoadService.Ready;
    const sdk = await import("@vowkey/sdk-internal");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const details = { details: sdk.profile_details(fillableProfileFieldsOf(profile)).details };
    const result = lower.endsWith(".docx")
      ? sdk.fill_docx_with_profile(bytes, details)
      : lower.endsWith(".xlsx")
        ? sdk.fill_xlsx_with_profile(bytes, details)
        : sdk.fill_hwpx_with_profile(bytes, details);
    const count = result.report.filled_count;
    if (count === 0) {
      this.extFillNotice = this.tr(
        "vkExtNoMatchingFields",
        `No matching fields were filled in ${file.name}.`,
        file.name,
      );
      return;
    }
    const dot = file.name.lastIndexOf(".");
    const outName =
      dot > 0 ? `${file.name.slice(0, dot)} (filled)${file.name.slice(dot)}` : `${file.name} (filled)`;
    const blob = new Blob([Uint8Array.from(result.bytes)], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.extFillNotice =
      count === 1
        ? this.tr("vkExtFilledOne", `Filled 1 field in ${outName}.`, outName)
        : this.tr("vkExtFilledCount", `Filled ${count} fields in ${outName}.`, count, outName);
  }
}
