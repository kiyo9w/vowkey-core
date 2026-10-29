import { withPasswordManagerSdk } from "@vowkey/common/key-management/utils";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { LogService } from "@vowkey/logging";
import {
  KeyRotationMethod,
  PasswordChangeAndRotateUserKeysRequest,
  PreparedUserKeyRotation,
  RotateUserKeysRequest,
  UpgradeTokenAction,
  isRotateUserKeysError,
} from "@vowkey/sdk-internal";
import { UserId } from "@vowkey/user-core";

import { UserCryptoDialogService } from "./user-crypto-dialog.service.abstraction";
import {
  TrustVerificationResult,
  UserKeyRotationService,
} from "./user-key-rotation.service.abstraction";

/**
 * Service for rotating user keys using the SDK.
 * Handles key rotation and trust verification for organizations and emergency access users.
 */
export class DefaultUserKeyRotationService implements UserKeyRotationService {
  constructor(
    private sdkService: SdkService,
    private logService: LogService,
    private userCryptoDialogService: UserCryptoDialogService,
    private localVault: LocalVaultService,
  ) {}

  private async postRotation(userId: UserId, prepared: PreparedUserKeyRotation): Promise<void> {
    const current = prepared.current_user_key();
    const next = prepared.new_user_key();
    try {
      await this.localVault.rotateAccountKey(userId, current, next);
      try {
        await prepared.post();
      } catch (error) {
        if (isRotateUserKeysError(error) && error.variant === "Rejected") {
          await this.localVault.cancelAccountKeyRotation(userId);
        } else {
          await this.localVault.resumeAccountKeyRotation(userId);
        }
        throw error;
      }
      await this.localVault.completeAccountKeyRotation(userId, current, next);
    } finally {
      current.fill(0);
      next.fill(0);
    }
  }

  async changePasswordAndRotateUserKey(
    currentMasterPassword: string,
    newMasterPassword: string,
    hint: string | undefined,
    userId: UserId,
  ): Promise<boolean> {
    const { wasTrustDenied, trustedOrganizationPublicKeys, trustedEmergencyAccessUserPublicKeys } =
      await this.verifyTrust(userId, "Skip");
    if (wasTrustDenied) {
      this.logService.info("[Userkey rotation] Trust was denied by user. Aborting!");
      return false;
    }

    return await withPasswordManagerSdk(userId, this.sdkService, async (sdk) => {
      this.logService.info("[UserKey Rotation] Re-encrypting user data with new user key...");
      try {
        const prepared = await sdk.user_crypto_management().prepare_password_change_and_rotate_user_keys({
          old_password: currentMasterPassword,
          password: newMasterPassword,
          hint,
          trusted_emergency_access_public_keys: trustedEmergencyAccessUserPublicKeys,
          trusted_organization_public_keys: trustedOrganizationPublicKeys,
        } as PasswordChangeAndRotateUserKeysRequest);
        await this.postRotation(userId, prepared);
        return true;
      } catch (error) {
        this.logService.error(`Failed to rotate user keys: ${error}`);
        return false;
      }
    });
  }

  async rotateUserKey(
    keyRotationMethod: KeyRotationMethod,
    upgradeTokenAction: UpgradeTokenAction,
    userId: UserId,
  ): Promise<boolean> {
    const { wasTrustDenied, trustedOrganizationPublicKeys, trustedEmergencyAccessUserPublicKeys } =
      await this.verifyTrust(userId, upgradeTokenAction);
    if (wasTrustDenied) {
      this.logService.info("[UserKeyRotationService] Trust was denied by user. Aborting!");
      return false;
    }

    return await withPasswordManagerSdk(userId, this.sdkService, async (sdk) => {
      this.logService.info("[UserKeyRotationService] Re-encrypting user data with new user key...");
      const prepared = await sdk.user_crypto_management().prepare_rotate_user_keys({
        key_rotation_method: keyRotationMethod,
        trusted_emergency_access_public_keys: trustedEmergencyAccessUserPublicKeys,
        trusted_organization_public_keys: trustedOrganizationPublicKeys,
        upgrade_token_action: upgradeTokenAction,
      } as RotateUserKeysRequest);
      await this.postRotation(userId, prepared);
      return true;
    });
  }

  async verifyTrust(
    userId: UserId,
    upgradeTokenAction: UpgradeTokenAction,
  ): Promise<TrustVerificationResult> {
    // Since currently the joined organizations and emergency access grantees are
    // not signed, manual trust prompts are required, to verify that the server
    // does not inject public keys here.
    //
    // Once signing is implemented, this is the place to also sign the keys and
    // upload the signed trust claims.
    this.logService.info("[Userkey rotation] Verifying trust...");
    const [emergencyAccessV1Memberships, organizationV1Memberships] = await withPasswordManagerSdk(
      userId,
      this.sdkService,
      async (sdk) => {
        const untrustedMemberships = await sdk
          .user_crypto_management()
          .get_untrusted_memberships(upgradeTokenAction);
        return [
          untrustedMemberships.emergency_access_memberships,
          untrustedMemberships.organization_memberships,
        ] as const;
      },
    );
    this.logService.info("result", { emergencyAccessV1Memberships, organizationV1Memberships });

    return this.userCryptoDialogService.verifyTrust(
      organizationV1Memberships,
      emergencyAccessV1Memberships,
    );
  }
}
