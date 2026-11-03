// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, inject, NgZone, Optional, ViewChild } from "@angular/core";
import { RouterLink } from "@angular/router";
import { combineLatest, firstValueFrom, map, take } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import {
  DisclosureComponent,
  DisclosureTriggerForDirective,
  IconButtonModule,
} from "@vowkey/components";

import BrowserPopupUtils from "../../../../../platform/browser/browser-popup-utils";
import { runInsideAngular } from "../../../../../platform/browser/run-inside-angular.operator";
import { VaultPopupListFiltersService } from "../../../services/vault-popup-list-filters.service";
import { VaultListFiltersComponent } from "../vault-list-filters/vault-list-filters.component";
import { VaultSearchComponent } from "../vault-search/vault-search.component";

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
    RouterLink,
    CommonModule,
    JslibModule,
  ],
})
export class VaultHeaderComponent {
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @ViewChild(DisclosureComponent) disclosure: DisclosureComponent;

  extFillNotice = "";

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
  ) {}

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
      await BrowserPopupUtils.openPopout("popup/index.html#/tabs/current");
      return;
    }
    input.click();
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
    if (!this.cipherService || !this.accountService?.activeAccount$) {
      this.extFillNotice = this.tr(
        "vkExtOpenProfileFirst",
        "Open a profile first, then choose a form to fill.",
      );
      return;
    }
    const active = await firstValueFrom(this.accountService.activeAccount$);
    if (!active?.id) {
      return;
    }
    const all = await this.cipherService.getAllDecrypted(active.id);
    const profile = all.find((c) => c.type === CipherType.Identity && !c.isDeleted);
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
    const details = { details: sdk.profile_details(profileFieldsOf(profile)).details };
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
