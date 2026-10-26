import {
  DefaultChangePasswordService,
  ChangePasswordService,
} from "@vowkey/angular/auth/password-management/change-password";
import BrowserPopupUtils from "@vowkey/browser/platform/browser/browser-popup-utils";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { OrganizationInviteService } from "@vowkey/common/auth/organization-invite";
import { MasterPasswordUnlockService } from "@vowkey/common/key-management/master-password/abstractions/master-password-unlock.service";
import { InternalMasterPasswordServiceAbstraction } from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { KeyService } from "@vowkey/key-management";

import { BrowserApi } from "../../../platform/browser/browser-api";

export class ExtensionChangePasswordService
  extends DefaultChangePasswordService
  implements ChangePasswordService
{
  constructor(
    protected keyService: KeyService,
    protected masterPasswordApiService: MasterPasswordApiService,
    protected masterPasswordService: InternalMasterPasswordServiceAbstraction,
    protected masterPasswordUnlockService: MasterPasswordUnlockService,
    protected policyService: PolicyService,
    protected organizationInviteService: OrganizationInviteService,
    private win: Window,
  ) {
    super(
      keyService,
      masterPasswordApiService,
      masterPasswordService,
      masterPasswordUnlockService,
      policyService,
      organizationInviteService,
    );
  }

  closeBrowserExtensionPopout(): void {
    if (BrowserPopupUtils.inPopout(this.win)) {
      BrowserApi.closePopup(this.win);
    }
  }

  /**
   * In the extension, if there is a "next account" user who is unlocked, if we do not route to root
   * the user is left on the change-password page after changing their password. See `switchAccount()`
   * in main.background.ts: when we send an "unlocked" message there is no subsequent routing, so we
   * must route to root from the ChangePasswordComponent. [Note: LogoutService behavior and routing will
   * be investigated in https://bitwarden.atlassian.net/browse/PM-32660]
   *
   * @returns true
   */
  shouldNavigateToRoot(): boolean {
    return true;
  }
}
