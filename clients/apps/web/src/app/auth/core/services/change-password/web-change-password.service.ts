import {
  ChangePasswordService,
  DefaultChangePasswordService,
  InvalidCurrentPasswordError,
} from "@vowkey/angular/auth/password-management/change-password";
import { PasswordInputResult } from "@vowkey/auth/angular";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { Account } from "@vowkey/common/auth/abstractions/account.service";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { OrganizationInviteService } from "@vowkey/common/auth/organization-invite";
import { assertNonNullish, assertTruthy } from "@vowkey/common/auth/utils";
import { MasterPasswordUnlockService } from "@vowkey/common/key-management/master-password/abstractions/master-password-unlock.service";
import { InternalMasterPasswordServiceAbstraction } from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { SyncService } from "@vowkey/common/platform/sync";
import { KeyService } from "@vowkey/key-management";
import { RouterService } from "@vowkey/web-vault/app/core";
import { UserKeyRotationService } from "@vowkey/web-vault/app/key-management/key-rotation/user-key-rotation.service";

export class WebChangePasswordService
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
    private syncService: SyncService,
    private userKeyRotationService: UserKeyRotationService,
    private routerService: RouterService,
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

  async changePasswordAndRotateUserKey(
    passwordInputResult: PasswordInputResult,
    user: Account,
  ): Promise<void> {
    const context = "Could not change password and rotate user key.";
    assertTruthy(passwordInputResult.currentPassword, "currentPassword", context);
    assertTruthy(passwordInputResult.newPassword, "newPassword", context);
    assertNonNullish(passwordInputResult.newPasswordHint, "newPasswordHint", context); // can have an empty string as a meaningful value, so check non-nullish

    const currentPasswordVerified = await this.masterPasswordUnlockService.proofOfDecryption(
      passwordInputResult.currentPassword,
      user.id,
    );
    if (!currentPasswordVerified) {
      throw new InvalidCurrentPasswordError();
    }

    await this.syncService.fullSync(true);

    await this.userKeyRotationService.rotateUserKeyMasterPasswordAndEncryptedData(
      passwordInputResult.currentPassword,
      passwordInputResult.newPassword,
      user,
      passwordInputResult.newPasswordHint,
    );
  }

  async clearDeeplinkState() {
    await this.routerService.getAndClearLoginRedirectUrl();
  }
}
