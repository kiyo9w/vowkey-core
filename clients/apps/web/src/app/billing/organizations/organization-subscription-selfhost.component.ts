// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormControl, FormGroup } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { concatMap, firstValueFrom, Subject, takeUntil } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { OrganizationApiServiceAbstraction } from "@vowkey/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import {
  getOrganizationById,
  OrganizationService,
} from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { OrganizationConnectionType } from "@vowkey/common/admin-console/enums";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { OrganizationConnectionResponse } from "@vowkey/common/admin-console/models/response/organization-connection.response";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { ProductTierType } from "@vowkey/common/billing/enums";
import { BillingSyncConfigApi } from "@vowkey/common/billing/models/api/billing-sync-config.api";
import { SelfHostedOrganizationSubscriptionView } from "@vowkey/common/billing/models/view/self-hosted-organization-subscription.view";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { DialogService, ToastService } from "@vowkey/components";

import { BillingSyncKeyComponent } from "./billing-sync-key.component";

// FIXME: update to use a const object instead of a typescript enum
// eslint-disable-next-line @vowkey/platform/no-enums
enum LicenseOptions {
  SYNC = 0,
  UPLOAD = 1,
}

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "organization-subscription-selfhost.component.html",
  standalone: false,
})
export class OrganizationSubscriptionSelfhostComponent implements OnInit, OnDestroy {
  subscription: SelfHostedOrganizationSubscriptionView;
  organizationId: string;
  userOrg: Organization;
  cloudWebVaultUrl: string;
  showAutomaticSyncAndManualUpload: boolean;

  licenseOptions = LicenseOptions;
  form = new FormGroup({
    updateMethod: new FormControl(LicenseOptions.UPLOAD),
  });

  disableLicenseSyncControl = false;

  firstLoaded = false;
  loading = false;

  private _existingBillingSyncConnection: OrganizationConnectionResponse<BillingSyncConfigApi>;

  private destroy$ = new Subject<void>();

  set existingBillingSyncConnection(value: OrganizationConnectionResponse<BillingSyncConfigApi>) {
    this._existingBillingSyncConnection = value;

    this.form
      .get("updateMethod")
      .setValue(this.billingSyncEnabled ? LicenseOptions.SYNC : LicenseOptions.UPLOAD);
  }

  get existingBillingSyncConnection() {
    return this._existingBillingSyncConnection;
  }

  get billingSyncEnabled() {
    return this.existingBillingSyncConnection?.enabled;
  }

  /**
   * Render the subscription as expired.
   */
  get showAsExpired() {
    return this.subscription.hasSeparateGracePeriod
      ? this.subscription.isExpiredWithoutGracePeriod
      : this.subscription.isExpiredAndOutsideGracePeriod;
  }

  constructor(
    private messagingService: MessagingService,
    private apiService: ApiService,
    private organizationService: OrganizationService,
    private accountService: AccountService,
    private route: ActivatedRoute,
    private organizationApiService: OrganizationApiServiceAbstraction,
    private platformUtilsService: PlatformUtilsService,
    private i18nService: I18nService,
    private environmentService: EnvironmentService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {}

  async ngOnInit() {
    this.cloudWebVaultUrl = await firstValueFrom(this.environmentService.cloudWebVaultUrl$);

    this.route.params
      .pipe(
        concatMap(async (params) => {
          this.organizationId = params.organizationId;
          await this.load();
          await this.loadOrganizationConnection();
          this.firstLoaded = true;
        }),
        takeUntil(this.destroy$),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async load() {
    if (this.loading) {
      return;
    }
    this.loading = true;
    const userId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    this.userOrg = await firstValueFrom(
      this.organizationService
        .organizations$(userId)
        .pipe(getOrganizationById(this.organizationId)),
    );
    this.showAutomaticSyncAndManualUpload =
      this.userOrg.productTierType == ProductTierType.Families ? false : true;
    if (this.userOrg.canViewSubscription) {
      const subscriptionResponse = await this.organizationApiService.getSubscription(
        this.organizationId,
      );
      this.subscription = new SelfHostedOrganizationSubscriptionView(subscriptionResponse);
    }

    this.loading = false;
  }

  async loadOrganizationConnection() {
    if (!this.firstLoaded) {
      const cloudCommunicationEnabled = await this.apiService.getCloudCommunicationsEnabled();
      this.disableLicenseSyncControl = !cloudCommunicationEnabled;
    }

    if (this.disableLicenseSyncControl) {
      return;
    }

    this.existingBillingSyncConnection = await this.apiService.getOrganizationConnection(
      this.organizationId,
      OrganizationConnectionType.CloudBillingSync,
      BillingSyncConfigApi,
    );
  }

  licenseUploaded() {
    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.load();
    this.messagingService.send("updatedOrgLicense");
  }

  manageBillingSyncSelfHosted() {
    BillingSyncKeyComponent.open(this.dialogService, {
      entityId: this.organizationId,
      existingConnectionId: this.existingBillingSyncConnection?.id,
      billingSyncKey: this.existingBillingSyncConnection?.config?.billingSyncKey,
      setParentConnection: (connection: OrganizationConnectionResponse<BillingSyncConfigApi>) => {
        this.existingBillingSyncConnection = connection;
      },
    });
  }

  syncLicense = async () => {
    this.form.get("updateMethod").setValue(LicenseOptions.SYNC);
    await this.organizationApiService.selfHostedSyncLicense(this.organizationId);

    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.load();
    await this.loadOrganizationConnection();
    this.messagingService.send("updatedOrgLicense");
    this.toastService.showToast({
      variant: "success",
      title: null,
      message: this.i18nService.t("licenseSyncSuccess"),
    });
  };

  get billingSyncSetUp() {
    return this.existingBillingSyncConnection?.id != null;
  }

  get updateMethod() {
    return this.form.get("updateMethod").value;
  }

  get lastLicenseSync() {
    return this.existingBillingSyncConnection?.config?.lastLicenseSync;
  }
}
