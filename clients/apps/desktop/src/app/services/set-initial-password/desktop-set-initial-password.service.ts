import { OrganizationUserApiService } from "@vowkey/admin-console/common";
import { DefaultSetInitialPasswordService } from "@vowkey/angular/auth/password-management/set-initial-password/default-set-initial-password.service.implementation";
import {
  InitializeJitPasswordCredentials,
  SetInitialPasswordCredentials,
  SetInitialPasswordService,
  SetInitialPasswordTdeUserWithPermissionCredentials,
  SetInitialPasswordUserType,
} from "@vowkey/angular/auth/password-management/set-initial-password/set-initial-password.service.abstraction";
import { InternalUserDecryptionOptionsServiceAbstraction } from "@vowkey/auth/common";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { OrganizationApiServiceAbstraction } from "@vowkey/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { AccountCryptographicStateService } from "@vowkey/common/key-management/account-cryptography/account-cryptographic-state.service";
import { InternalMasterPasswordServiceAbstraction } from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { RegisterSdkService } from "@vowkey/common/platform/abstractions/sdk/register-sdk.service";
import { UserId } from "@vowkey/common/types/guid";
import { KdfConfigService, KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, LegacyCompatKeyService } from "@vowkey/legacy-crypto";
import { UnlockService } from "@vowkey/unlock";

export class DesktopSetInitialPasswordService
  extends DefaultSetInitialPasswordService
  implements SetInitialPasswordService
{
  constructor(
    protected apiService: ApiService,
    protected encryptService: EncryptService,
    protected i18nService: I18nService,
    protected kdfConfigService: KdfConfigService,
    protected keyService: KeyService,
    protected legacyCompatKeyService: LegacyCompatKeyService,
    protected masterPasswordApiService: MasterPasswordApiService,
    protected masterPasswordService: InternalMasterPasswordServiceAbstraction,
    protected organizationApiService: OrganizationApiServiceAbstraction,
    protected organizationUserApiService: OrganizationUserApiService,
    protected userDecryptionOptionsService: InternalUserDecryptionOptionsServiceAbstraction,
    private messagingService: MessagingService,
    protected accountCryptographicStateService: AccountCryptographicStateService,
    protected registerSdkService: RegisterSdkService,
    protected unlockService: UnlockService,
  ) {
    super(
      apiService,
      encryptService,
      i18nService,
      kdfConfigService,
      keyService,
      legacyCompatKeyService,
      masterPasswordApiService,
      masterPasswordService,
      organizationApiService,
      organizationUserApiService,
      userDecryptionOptionsService,
      accountCryptographicStateService,
      registerSdkService,
      unlockService,
    );
  }

  /**
   * @deprecated use `initializePasswordJitPasswordUserV2Encryption()` instead
   */
  override async setInitialPassword(
    credentials: SetInitialPasswordCredentials,
    userType: SetInitialPasswordUserType,
    userId: UserId,
  ) {
    await super.setInitialPassword(credentials, userType, userId);

    this.messagingService.send("redrawMenu");
  }

  override async initializePasswordJitPasswordUserV2Encryption(
    credentials: InitializeJitPasswordCredentials,
    userId: UserId,
  ): Promise<void> {
    await super.initializePasswordJitPasswordUserV2Encryption(credentials, userId);

    this.messagingService.send("redrawMenu");
  }

  override async setInitialPasswordTdeUserWithPermission(
    credentials: SetInitialPasswordTdeUserWithPermissionCredentials,
    userId: UserId,
  ) {
    await super.setInitialPasswordTdeUserWithPermission(credentials, userId);

    this.messagingService.send("redrawMenu");
  }
}
