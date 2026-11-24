import { CommonModule } from "@angular/common";
import { Component, inject } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterModule } from "@angular/router";
import { combineLatest, filter, map, Observable, switchMap, take, withLatestFrom } from "rxjs";

import { JslibModule } from "@vowkey/angular/jslib.module";
import { AdminConsoleLogo } from "@vowkey/assets/svg";
import {
  canAccessAccessIntelligence,
  canAccessBillingTab,
  canAccessGroupsTab,
  canAccessMembersTab,
  canAccessOrgAdmin,
  canAccessReportingTab,
  canAccessSettingsTab,
  canAccessVaultTab,
  OrganizationService,
  singleOrganizationPolicyApplies$,
} from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { ProviderService } from "@vowkey/common/admin-console/abstractions/provider.service";
import { ProviderStatusType } from "@vowkey/common/admin-console/enums";
import { Organization } from "@vowkey/common/admin-console/models/domain/organization";
import { Provider } from "@vowkey/common/admin-console/models/domain/provider";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { getById } from "@vowkey/common/platform/misc";
import { BannerModule, SvgModule } from "@vowkey/components";
import { Vfo1I18nPipe, Vfo1IconPipe } from "@vowkey/vault";

import { OrgSwitcherComponent } from "../../../layouts/org-switcher/org-switcher.component";
import { WebLayoutModule } from "../../../layouts/web-layout.module";
import { PamOrgNavSlotComponent } from "../../../pam/org-nav-slot/pam-org-nav-slot.component";
import { InviteLinkCalloutService } from "../members/services/invite-link-callout/invite-link-callout.service";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-organization-layout",
  templateUrl: "organization-layout.component.html",
  imports: [
    CommonModule,
    RouterModule,
    JslibModule,
    WebLayoutModule,
    SvgModule,
    OrgSwitcherComponent,
    BannerModule,
    Vfo1IconPipe,
    Vfo1I18nPipe,
    PamOrgNavSlotComponent,
  ],
})
export class OrganizationLayoutComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly organizationService = inject(OrganizationService);
  private readonly platformUtilsService = inject(PlatformUtilsService);
  private readonly policyService = inject(PolicyService);
  private readonly providerService = inject(ProviderService);
  private readonly accountService = inject(AccountService);
  private readonly inviteLinkCalloutService = inject(InviteLinkCalloutService);

  protected readonly logo = AdminConsoleLogo;

  protected readonly orgFilter = (org: Organization) => canAccessOrgAdmin(org);

  private readonly userId$ = this.accountService.activeAccount$.pipe(getUserId);

  readonly organization$: Observable<Organization> = this.route.params.pipe(
    map((p) => p.organizationId),
    withLatestFrom(this.userId$),
    switchMap(([orgId, userId]) =>
      this.organizationService.organizations$(userId).pipe(getById(orgId)),
    ),
    filter((org): org is Organization => org != null),
  );

  readonly canAccessExport$: Observable<boolean> = this.organization$.pipe(
    map((org) => org.canAccessExport),
  );

  readonly showPaymentAndHistory$: Observable<boolean> = this.organization$.pipe(
    map(
      (org) =>
        !this.platformUtilsService.isSelfHost() &&
        org.canViewBillingHistory &&
        org.canEditPaymentMethods,
    ),
  );

  readonly hideNewOrgButton$: Observable<boolean> = this.userId$.pipe(
    switchMap((userId) => singleOrganizationPolicyApplies$(userId, this.policyService)),
  );

  private readonly provider$: Observable<Provider | undefined> = combineLatest([
    this.organization$,
    this.userId$,
  ]).pipe(
    switchMap(([organization, userId]) =>
      this.providerService.get$(organization.providerId, userId),
    ),
  );

  readonly organizationIsUnmanaged$: Observable<boolean> = combineLatest([
    this.organization$,
    this.provider$,
  ]).pipe(
    map(
      ([organization, provider]) =>
        !organization.hasProvider ||
        !provider ||
        provider.providerStatus !== ProviderStatusType.Billable,
    ),
  );

  protected readonly integrationPageEnabled$: Observable<boolean> = this.organization$.pipe(
    map((org) => org.canAccessIntegrations),
  );


  constructor() {
    document.body.classList.remove("layout_frontend");

    this.organization$
      .pipe(
        take(1),
        switchMap((organization) => this.inviteLinkCalloutService.showIfEligible(organization)),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  canShowVaultTab(organization: Organization): boolean {
    return canAccessVaultTab(organization);
  }

  canShowSettingsTab(organization: Organization): boolean {
    return canAccessSettingsTab(organization);
  }

  canShowMembersTab(organization: Organization): boolean {
    return canAccessMembersTab(organization);
  }

  canShowGroupsTab(organization: Organization): boolean {
    return canAccessGroupsTab(organization);
  }

  canShowReportsTab(organization: Organization): boolean {
    return canAccessReportingTab(organization);
  }

  canShowBillingTab(organization: Organization): boolean {
    return canAccessBillingTab(organization);
  }

  canShowAccessIntelligenceTab(organization: Organization): boolean {
    return canAccessAccessIntelligence(organization);
  }

  getReportTabLabel(organization: Organization): string {
    return organization.useEvents ? "reporting" : "reports";
  }

}
