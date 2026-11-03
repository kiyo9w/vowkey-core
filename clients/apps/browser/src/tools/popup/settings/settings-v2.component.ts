import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterModule } from "@angular/router";
import {
  combineLatest,
  filter,
  firstValueFrom,
  map,
  Observable,
  shareReplay,
  switchMap,
} from "rxjs";

import { PremiumUpgradeDialogComponent } from "@vowkey/angular/billing/components";
import { JslibModule } from "@vowkey/angular/jslib.module";
import { NudgesService, NudgeType } from "@vowkey/angular/vault";
import { AutomaticUserConfirmationService } from "@vowkey/auto-confirm";
import { Account, AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions";
import { UserId } from "@vowkey/common/types/guid";
import { DialogService, ItemModule, BerryComponent } from "@vowkey/components";

import { CurrentAccountComponent } from "../../../auth/popup/account-switching/current-account.component";
import { PopOutComponent } from "../../../platform/popup/components/pop-out.component";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

@Component({
  templateUrl: "settings-v2.component.html",
  imports: [
    CommonModule,
    JslibModule,
    RouterModule,
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    ItemModule,
    CurrentAccountComponent,
    BerryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsV2Component {
  readonly NudgeType = NudgeType;

  private readonly authenticatedAccount$: Observable<Account> =
    this.accountService.activeAccount$.pipe(
      filter((account): account is Account => account !== null),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

  protected readonly hasPremium$ = this.authenticatedAccount$.pipe(
    switchMap((account) => this.accountProfileStateService.hasPremiumFromAnySource$(account.id)),
  );

  readonly showDownloadVowkeyNudge$: Observable<boolean> = this.authenticatedAccount$.pipe(
    switchMap((account) =>
      this.nudgesService.showNudgeBadge$(NudgeType.DownloadVowkey, account.id),
    ),
  );

  readonly showVaultBadge$: Observable<boolean> = this.authenticatedAccount$.pipe(
    switchMap((account) =>
      this.nudgesService.showNudgeBadge$(NudgeType.EmptyVaultNudge, account.id),
    ),
  );

  readonly showAdminBadge$: Observable<boolean> = this.authenticatedAccount$.pipe(
    switchMap((account) =>
      this.nudgesService.showNudgeBadge$(NudgeType.AutoConfirmNudge, account.id),
    ),
  );

  readonly showAutofillBadge$: Observable<boolean> = this.authenticatedAccount$.pipe(
    switchMap((account) =>
      combineLatest([
        this.nudgesService.showNudgeBadge$(NudgeType.AutofillNudge, account.id),
        this.autofillSettingsService.showClipboardSettingUpdateNotification$,
      ]).pipe(
        map(
          ([showAutofillNudge, showClipboardNotification]) =>
            showAutofillNudge || showClipboardNotification,
        ),
      ),
    ),
  );

  readonly showAdminSettingsLink$: Observable<boolean> = this.accountService.activeAccount$.pipe(
    getUserId,
    switchMap((userId) => this.autoConfirmService.canManageAutoConfirm$(userId)),
  );

  constructor(
    private readonly nudgesService: NudgesService,
    private readonly accountService: AccountService,
    private readonly autoConfirmService: AutomaticUserConfirmationService,
    private readonly accountProfileStateService: BillingAccountProfileStateService,
    private readonly dialogService: DialogService,
    private readonly autofillSettingsService: AutofillSettingsServiceAbstraction,
  ) {}

  protected openUpgradeDialog() {
    PremiumUpgradeDialogComponent.open(this.dialogService);
  }

  async dismissBadge(type: NudgeType) {
    if (await firstValueFrom(this.showVaultBadge$)) {
      const account = await firstValueFrom(this.authenticatedAccount$);
      await this.nudgesService.dismissNudge(type, account.id as UserId, true);
    }
  }
}
