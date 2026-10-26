import { Component, OnInit } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { concatMap, takeUntil, map, lastValueFrom, firstValueFrom } from "rxjs";
import { first, tap } from "rxjs/operators";

import { TwoFactorIconComponent } from "@vowkey/angular/auth/components/two-factor-icon.component";
import { PremiumBadgeComponent } from "@vowkey/angular/billing/components/premium-badge";
import {
  getOrganizationById,
  OrganizationService,
} from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { UserVerificationService } from "@vowkey/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { TwoFactorProviderType } from "@vowkey/common/auth/enums/two-factor-provider-type";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { TwoFactorService, TwoFactorSetupDialogData } from "@vowkey/common/auth/two-factor";
import { TwoFactorOrganizationDuoResponse } from "@vowkey/common/auth/two-factor/response/two-factor-organization-duo.response";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions/account/billing-account-profile-state.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import {
  BreadcrumbsModule,
  DialogRef,
  DialogService,
  ItemModule,
  ToastService,
} from "@vowkey/components";

import { TwoFactorSetupDuoComponent } from "../../../auth/settings/two-factor/two-factor-setup-duo.component";
import { TwoFactorSetupComponent as BaseTwoFactorSetupComponent } from "../../../auth/settings/two-factor/two-factor-setup.component";
import { TwoFactorVerifyComponent } from "../../../auth/settings/two-factor/two-factor-verify.component";
import { HeaderModule } from "../../../layouts/header/header.module";
import { SharedModule } from "../../../shared";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-two-factor-setup",
  templateUrl: "../../../auth/settings/two-factor/two-factor-setup.component.html",
  imports: [
    ItemModule,
    HeaderModule,
    BreadcrumbsModule,
    PremiumBadgeComponent,
    TwoFactorIconComponent,
    SharedModule,
  ],
})
export class TwoFactorSetupComponent extends BaseTwoFactorSetupComponent implements OnInit {
  tabbedHeader = false;
  constructor(
    dialogService: DialogService,
    twoFactorService: TwoFactorService,
    messagingService: MessagingService,
    policyService: PolicyService,
    private route: ActivatedRoute,
    private organizationService: OrganizationService,
    billingAccountProfileStateService: BillingAccountProfileStateService,
    protected accountService: AccountService,
    configService: ConfigService,
    i18nService: I18nService,
    protected userVerificationService: UserVerificationService,
    protected toastService: ToastService,
  ) {
    super(
      dialogService,
      twoFactorService,
      messagingService,
      policyService,
      billingAccountProfileStateService,
      accountService,
      configService,
      i18nService,
      userVerificationService,
      toastService,
    );
  }

  async ngOnInit() {
    const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    this.route.params
      .pipe(
        concatMap((params) =>
          this.organizationService
            .organizations$(userId)
            .pipe(getOrganizationById(params.organizationId))
            .pipe(map((organization) => ({ params, organization }))),
        ),
        tap(async (mapResponse) => {
          this.organizationId = mapResponse.params.organizationId;
          this.organization = mapResponse.organization!;
        }),
        concatMap(async () => await super.ngOnInit()),
        takeUntil(this.destroy$),
      )
      .subscribe();
  }

  async manage(type: TwoFactorProviderType) {
    // clear any existing subscriptions before creating a new one
    this.twoFactorSetupSubscription?.unsubscribe();

    switch (type) {
      case TwoFactorProviderType.OrganizationDuo: {
        const twoFactorVerifyDialogRef = TwoFactorVerifyComponent.open(this.dialogService, {
          data: { type: type, organizationId: this.organizationId },
        });
        const result = (await lastValueFrom(
          twoFactorVerifyDialogRef.closed,
        )) as TwoFactorSetupDialogData<TwoFactorOrganizationDuoResponse>;
        if (!result) {
          return;
        }
        const duoComp: DialogRef<boolean, any> = TwoFactorSetupDuoComponent.open(
          this.dialogService,
          {
            data: {
              authResponse: result,
              organizationId: this.organizationId,
            },
          },
        );
        this.twoFactorSetupSubscription = duoComp.componentInstance.onChangeStatus
          .pipe(first(), takeUntil(this.destroy$))
          .subscribe((enabled: boolean) => {
            void duoComp.close();
            this.updateStatus(enabled, TwoFactorProviderType.OrganizationDuo);
          });

        break;
      }
      default:
        break;
    }
  }

  protected getTwoFactorProviders() {
    return this.twoFactorService.getTwoFactorOrganizationProviders(this.organizationId);
  }

  protected filterProvider(type: TwoFactorProviderType): boolean {
    return type !== TwoFactorProviderType.OrganizationDuo;
  }
}
