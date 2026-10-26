import { LogoutService } from "@vowkey/auth/common";
import MainBackground from "@vowkey/browser/background/main.background";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { ProcessReloadServiceAbstraction } from "@vowkey/common/key-management/process-reload";
import { VaultTimeoutSettingsService } from "@vowkey/common/key-management/vault-timeout";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { SystemService } from "@vowkey/common/platform/abstractions/system.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { BiometricsService, KeyService } from "@vowkey/key-management";
import { LogService } from "@vowkey/logging";
import { StateEventRunnerService } from "@vowkey/state";
import { DefaultLockService, LockSource } from "@vowkey/unlock";
import { UserId } from "@vowkey/user-core";

export class ExtensionLockService extends DefaultLockService {
  constructor(
    accountService: AccountService,
    biometricService: BiometricsService,
    vaultTimeoutSettingsService: VaultTimeoutSettingsService,
    logoutService: LogoutService,
    messagingService: MessagingService,
    folderService: FolderService,
    stateEventRunnerService: StateEventRunnerService,
    cipherService: CipherService,
    authService: AuthService,
    systemService: SystemService,
    processReloadService: ProcessReloadServiceAbstraction,
    logService: LogService,
    keyService: KeyService,
    private readonly main: MainBackground,
  ) {
    super(
      accountService,
      biometricService,
      vaultTimeoutSettingsService,
      logoutService,
      messagingService,
      folderService,
      stateEventRunnerService,
      cipherService,
      authService,
      systemService,
      processReloadService,
      logService,
      keyService,
    );
  }

  async runPlatformOnLockActions(userId: UserId, source: LockSource): Promise<void> {
    await super.runPlatformOnLockActions(userId, source);
    await this.main.refreshMenu(true);
  }
}
