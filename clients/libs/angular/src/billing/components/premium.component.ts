// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { OnInit, Directive } from "@angular/core";
import { firstValueFrom, Observable, switchMap } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { BillingApiServiceAbstraction } from "@vowkey/common/billing/abstractions";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions/account/billing-account-profile-state.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { DialogService, SimpleDialogOptions, ToastService } from "@vowkey/components";

@Directive()
export class PremiumComponent implements OnInit {
  isPremium$: Observable<boolean>;
  price = 10;
  storageProvidedGb = 0;
  refreshing = false;
  refreshPromise: Promise<any>;
  cloudWebVaultUrl: string;

  constructor(
    protected i18nService: I18nService,
    protected platformUtilsService: PlatformUtilsService,
    protected apiService: ApiService,
    private logService: LogService,
    protected dialogService: DialogService,
    private environmentService: EnvironmentService,
    billingAccountProfileStateService: BillingAccountProfileStateService,
    private toastService: ToastService,
    accountService: AccountService,
    private billingApiService: BillingApiServiceAbstraction,
  ) {
    this.isPremium$ = accountService.activeAccount$.pipe(
      switchMap((account) =>
        billingAccountProfileStateService.hasPremiumFromAnySource$(account.id),
      ),
    );
  }

  async ngOnInit() {
    this.cloudWebVaultUrl = await firstValueFrom(this.environmentService.cloudWebVaultUrl$);
    const premiumResponse = await this.billingApiService.getPremiumPlan();
    this.storageProvidedGb = premiumResponse.storage.provided;
    this.price = premiumResponse.seat.price;
  }

  async refresh() {
    this.refreshing = true;
    this.refreshPromise = this.apiService.refreshIdentityToken();
    try {
      await this.refreshPromise;
      this.toastService.showToast({
        variant: "success",
        title: null,
        message: this.i18nService.t("refreshComplete"),
      });
    } catch (e) {
      this.logService.error(e);
    } finally {
      this.refreshing = false;
    }
  }

  async purchase() {
    const dialogOpts: SimpleDialogOptions = {
      title: { key: "continueToVowkeyDotCom" },
      content: {
        key: "premiumPurchaseAlertV2",
      },
      type: "info",
    };

    dialogOpts.acceptButtonText = { key: "continue" };
    dialogOpts.cancelButtonText = { key: "close" };

    const confirmed = await this.dialogService.openSimpleDialog(dialogOpts);

    if (confirmed) {
      this.platformUtilsService.launchUri(
        `${this.cloudWebVaultUrl}/#/settings/subscription/premium`,
      );
    }
  }

  async manage() {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "premiumManage" },
      content: { key: "premiumManageAlert" },
      type: "info",
    });

    if (confirmed) {
      this.platformUtilsService.launchUri(
        `${this.cloudWebVaultUrl}/#/settings/subscription/premium`,
      );
    }
  }
}
