// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component, computed, inject, OnInit, Signal } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { RouterModule } from "@angular/router";
import { map, Observable, switchMap } from "rxjs";

import { PasswordManagerLogo } from "@vowkey/assets/svg";
import {
  canAccessEmergencyAccess,
  singleOrganizationPolicyApplies$,
} from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { getUserId } from "@vowkey/common/auth/services/account.service";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { SyncService } from "@vowkey/common/platform/sync";
import { PopoverModule, SideNavService, SvgModule } from "@vowkey/components";
import { SendPolicyService } from "@vowkey/send-ui";
import { I18nPipe } from "@vowkey/ui-common";
import {
  VaultManageNavComponent,
  VaultNavSectionComponent,
  CoachmarkComponent,
  CoachmarkService,
} from "@vowkey/vault";

import { PamUserNavSlotComponent } from "../pam/user-nav-slot/pam-user-nav-slot.component";

import { WebLayoutModule } from "./web-layout.module";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "app-user-layout",
  templateUrl: "user-layout.component.html",
  imports: [
    CommonModule,
    RouterModule,
    I18nPipe,
    WebLayoutModule,
    SvgModule,
    VaultManageNavComponent,
    VaultNavSectionComponent,
    PamUserNavSlotComponent,
    PopoverModule,
    CoachmarkComponent,
  ],
})
export class UserLayoutComponent implements OnInit {
  protected readonly logo = PasswordManagerLogo;
  protected readonly showEmergencyAccess: Signal<boolean>;
  protected readonly sendEnabled$: Observable<boolean> = this.sendPolicyService.disableSend$.pipe(
    map((disableSend) => !disableSend),
  );
  protected readonly coachmarkService = inject(CoachmarkService);
  protected readonly sideNavService = inject(SideNavService);
  private readonly configService = inject(ConfigService);

  protected readonly exportRoute = computed(() => {
    const vfo1Enabled = this.vfo1Enabled();
    return vfo1Enabled ? "/settings/export" : "/tools/export";
  });

  protected readonly vfo1Enabled: Signal<boolean> = toSignal(
    inject(ConfigService).getFeatureFlag$(FeatureFlag.VFO1Foundation),
    { initialValue: false },
  );

  protected readonly singleOrgPolicyApplies = toSignal(
    this.accountService.activeAccount$.pipe(
      getUserId,
      switchMap((userId) => singleOrganizationPolicyApplies$(userId, this.policyService)),
    ),
    { initialValue: true },
  );

  protected readonly importCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  protected readonly reportsCoachmarkOpen = computed(
    () => this.coachmarkService.activeStepId() === "monitorSecurity",
  );

  /** Expand tools nav group when import coachmark is active */
  protected readonly toolsNavGroupOpen = computed(
    () => this.coachmarkService.activeStepId() === "importData",
  );

  constructor(
    private syncService: SyncService,
    private accountService: AccountService,
    private policyService: PolicyService,
    private sendPolicyService: SendPolicyService,
  ) {
    this.showEmergencyAccess = toSignal(
      this.accountService.activeAccount$.pipe(
        getUserId,
        switchMap((userId) => canAccessEmergencyAccess(userId, this.policyService)),
      ),
    );

  }

  async ngOnInit() {
    document.body.classList.remove("layout_frontend");
    await this.syncService.fullSync(false);
  }
}
