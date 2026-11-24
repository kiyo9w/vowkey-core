import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { RouterModule } from "@angular/router";
import {
  combineLatest,
  catchError,
  defer,
  filter,
  firstValueFrom,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
} from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { NudgesService, NudgeType } from "@vowkey/angular/vault";
import { AutomaticUserConfirmationService } from "@vowkey/auto-confirm";
import { Account, AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { EntitlementService, planNameKey } from "@vowkey/common/billing/services/entitlement.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { UserId } from "@vowkey/common/types/guid";
import { ItemModule, BerryComponent } from "@vowkey/components";

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

  protected readonly planName$ = this.authenticatedAccount$.pipe(
    switchMap(() =>
      defer(() => this.entitlements.get()).pipe(
        map((response) => this.i18n.t(planNameKey(response.personal.basePlan))),
        catchError((error: unknown) => {
          this.log.error(error);
          return of(null);
        }),
      ),
    ),
  );

  protected readonly planUrl$ = this.environmentService.environment$.pipe(
    map((environment) => `${environment.getWebVaultUrl().replace(/\/$/, "")}/#/settings/subscription`),
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
    private readonly entitlements: EntitlementService,
    private readonly environmentService: EnvironmentService,
    private readonly i18n: I18nService,
    private readonly log: LogService,
    private readonly autofillSettingsService: AutofillSettingsServiceAbstraction,
  ) {}


  async dismissBadge(type: NudgeType) {
    if (await firstValueFrom(this.showVaultBadge$)) {
      const account = await firstValueFrom(this.authenticatedAccount$);
      await this.nudgesService.dismissNudge(type, account.id as UserId, true);
    }
  }
}
