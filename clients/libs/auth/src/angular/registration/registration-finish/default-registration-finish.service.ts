// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { firstValueFrom } from "rxjs";

import { AccountApiService } from "@vowkey/common/auth/abstractions/account-api.service";
import { RegisterFinishRequest } from "@vowkey/common/auth/models/request/registration/register-finish.request";
import { assertNonNullish, assertTruthy } from "@vowkey/common/auth/utils";
import { FeatureFlag } from "@vowkey/common/enums/feature-flag.enum";
import { MasterPasswordServiceAbstraction } from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { KeysRequest } from "@vowkey/common/models/request/keys.request";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { asUuid, SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { UserKey } from "@vowkey/common/types/key";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
// eslint-disable-next-line no-restricted-imports
import { EncString, LegacyCompatKeyService, SymmetricCryptoKey } from "@vowkey/legacy-crypto";
import {
  OrganizationId as SdkOrganizationId,
  UserId as SdkUserId,
  UserMasterPasswordRegistrationRequest,
} from "@vowkey/sdk-internal";

import { PasswordInputResult } from "../../input-password/password-input-result";

import { RegistrationFinishService } from "./registration-finish.service";

export class DefaultRegistrationFinishService implements RegistrationFinishService {
  constructor(
    protected legacyCompatKeyService: LegacyCompatKeyService,
    protected accountApiService: AccountApiService,
    protected masterPasswordService: MasterPasswordServiceAbstraction,
    protected configService: ConfigService,
    protected sdkService: SdkService,
    protected localVault?: LocalVaultService,
  ) {}

  async finishRegistration(
    email: string,
    passwordInputResult: PasswordInputResult,
    emailVerificationToken?: string,
    orgSponsoredFreeFamilyPlanToken?: string,
    acceptEmergencyAccessInviteToken?: string,
    emergencyAccessId?: string,
    providerInviteToken?: string,
    providerUserId?: string,
    salesAssistedToken?: string,
  ): Promise<void> {
    const ctx = "Could not finish registration.";
    assertTruthy(passwordInputResult.newPassword, "newPassword", ctx);
    assertNonNullish(passwordInputResult.kdfConfig, "kdfConfig", ctx);
    assertTruthy(passwordInputResult.salt, "salt", ctx);

    await this.localVault?.initialize();
    const adoptLocal = this.localVault != null && this.localVault.state$.value !== "empty";
    if (adoptLocal) {
      await this.localVault!.ensureUnlocked();
    }
    const useV2RegistrationViaSdk = await this.configService.getFeatureFlag(
      FeatureFlag.EnableAccountEncryptionV2UserPasswordRegistration,
    );

    if (useV2RegistrationViaSdk && !adoptLocal) {
      const sdkClient = await firstValueFrom(this.sdkService.client$);
      if (!sdkClient) {
        throw new Error("SDK not available");
      }

      const registerRequest = await this.buildSdkRegisterRequest(
        email,
        passwordInputResult.salt,
        passwordInputResult.newPassword, // String,
        passwordInputResult.newPasswordHint, // Option<String>,
        emailVerificationToken, // Option<String>,
        orgSponsoredFreeFamilyPlanToken,
        acceptEmergencyAccessInviteToken,
        emergencyAccessId,
        providerInviteToken,
        providerUserId,
        salesAssistedToken, // Option<String>,
      );

      // The SDK call returns the
      // - account_cryptographic_state
      // - master_password_unlock
      // - user_key
      // we discard this as all finishRegistration flows immediately log in
      // after a successful return.
      await sdkClient
        .auth()
        .registration()
        .post_keys_for_user_password_registration(registerRequest);

      return;
    }

    const newMasterKey = await this.legacyCompatKeyService.makeMasterKey(
      passwordInputResult.newPassword,
      passwordInputResult.salt,
      passwordInputResult.kdfConfig,
    );

    let newUserKey: UserKey;
    if (adoptLocal) {
      const localKey = await this.localVault!.key();
      try {
        newUserKey = new SymmetricCryptoKey(localKey) as UserKey;
      } finally {
        localKey.fill(0);
      }
    } else {
      const [key, encryptedKey] = await this.legacyCompatKeyService.makeUserKey(newMasterKey);
      if (!key || !encryptedKey) {
        throw new Error("User key could not be created");
      }
      newUserKey = key;
    }
    const userAsymmetricKeys = await this.legacyCompatKeyService.makeKeyPair(newUserKey);

    const registerRequest = await this.buildRegisterRequest(
      newUserKey,
      email,
      passwordInputResult,
      userAsymmetricKeys,
      emailVerificationToken,
      orgSponsoredFreeFamilyPlanToken,
      acceptEmergencyAccessInviteToken,
      emergencyAccessId,
      providerInviteToken,
      providerUserId,
      salesAssistedToken,
    );

    await this.accountApiService.registerFinish(registerRequest);
    if (adoptLocal) {
      await this.localVault!.markRegistered(email);
    }
  }

  protected async buildSdkRegisterRequest(
    email: string,
    salt: string,
    masterPassword: string,
    masterPasswordHint?: string,
    emailVerificationToken?: string,
    orgSponsoredFreeFamilyPlanToken?: string, // web only
    acceptEmergencyAccessInviteToken?: string, // web only
    emergencyAccessId?: string, // web only
    providerInviteToken?: string, // web only
    providerUserId?: string, // web only
    salesAssistedToken?: string, // web only
  ): Promise<UserMasterPasswordRegistrationRequest> {
    const registerFinishRequest: UserMasterPasswordRegistrationRequest = {
      email: email,
      salt: salt,
      master_password: masterPassword,
      master_password_hint: masterPasswordHint,
      email_verification_token: emailVerificationToken,
      organization_user_id: undefined,
      org_invite_token: undefined,
      org_sponsored_free_family_plan_token: undefined,
      accept_emergency_access_invite_token: undefined,
      accept_emergency_access_id: undefined,
      provider_invite_token: undefined,
      provider_user_id: undefined,
      sales_assisted_token: undefined,
      open_org_invite: undefined,
    };

    return registerFinishRequest;
  }

  protected async buildRegisterRequest(
    newUserKey: UserKey,
    email: string,
    passwordInputResult: PasswordInputResult,
    userAsymmetricKeys: [string, EncString],
    emailVerificationToken?: string,
    orgSponsoredFreeFamilyPlanToken?: string, // web only
    acceptEmergencyAccessInviteToken?: string, // web only
    emergencyAccessId?: string, // web only
    providerInviteToken?: string, // web only
    providerUserId?: string, // web only
    salesAssistedToken?: string, // web only
  ): Promise<RegisterFinishRequest> {
    const userAsymmetricKeysRequest = new KeysRequest(
      userAsymmetricKeys[0],
      userAsymmetricKeys[1].encryptedString,
    );

    const masterPasswordAuthentication =
      await this.masterPasswordService.makeMasterPasswordAuthenticationData(
        passwordInputResult.newPassword,
        passwordInputResult.kdfConfig,
        passwordInputResult.salt,
      );

    const masterPasswordUnlock = await this.masterPasswordService.makeMasterPasswordUnlockData(
      passwordInputResult.newPassword,
      passwordInputResult.kdfConfig,
      passwordInputResult.salt,
      newUserKey,
    );

    const registerFinishRequest = new RegisterFinishRequest(
      email,
      passwordInputResult.newPasswordHint,
      userAsymmetricKeysRequest,
      masterPasswordAuthentication,
      masterPasswordUnlock,
    );

    if (emailVerificationToken) {
      registerFinishRequest.emailVerificationToken = emailVerificationToken;
    }

    return registerFinishRequest;
  }

  protected toOptionalSdkUserId(value?: string): SdkUserId | undefined {
    return value ? asUuid<SdkUserId>(value) : undefined;
  }

  protected toOptionalSdkOrganizationId(value?: string): SdkOrganizationId | undefined {
    return value ? asUuid<SdkOrganizationId>(value) : undefined;
  }
}
