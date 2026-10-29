import { LocalVaultAttachService } from "@vowkey/angular/services/local-vault-attach.service";
import { Inject, Injectable, DOCUMENT } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { AbstractThemingService } from "@vowkey/angular/platform/services/theming/theming.service.abstraction";
import { WINDOW } from "@vowkey/angular/services/injection-tokens";
import { AutomationDriver } from "@vowkey/automation-driver";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { TokenService } from "@vowkey/common/auth/abstractions/token.service";
import { TwoFactorService } from "@vowkey/common/auth/two-factor";
import { EventUploadService as EventUploadServiceAbstraction } from "@vowkey/common/dirt/event-logs";
import { EventUploadService } from "@vowkey/common/dirt/event-logs/services/event-upload.service";
import { SharedUnlockPeerService } from "@vowkey/common/key-management/shared-unlock";
import { DefaultVaultTimeoutService } from "@vowkey/common/key-management/vault-timeout";
import { I18nService as I18nServiceAbstraction } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService as PlatformUtilsServiceAbstraction } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { IpcService } from "@vowkey/common/platform/ipc";
import { ServerNotificationsService } from "@vowkey/common/platform/server-notifications";
import { ContainerService } from "@vowkey/common/platform/services/container.service";
import { MigrationRunner } from "@vowkey/common/platform/services/migration-runner";
import { UserId } from "@vowkey/common/types/guid";
import { BiometricsService, KeyService as KeyServiceAbstraction } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, LegacyCompatKeyService } from "@vowkey/legacy-crypto";
import { LogService } from "@vowkey/logging";
import { UnlockService } from "@vowkey/unlock";

import { DesktopAutofillService } from "../../autofill/services/desktop-autofill.service";
import { DesktopAutotypeMvpService } from "../../autofill/services/desktop-autotype-mvp.service";
import { DesktopAutotypeService } from "../../autofill/services/desktop-autotype.service";
import { SshAgentService } from "../../autofill/services/ssh-agent.service";
import { I18nRendererService } from "../../platform/services/i18n.renderer.service";
import { ServerCommunicationConfigService } from "../../platform/services/server-communication-config/server-communication-config.service";
import { VersionService } from "../../platform/services/version.service";
import { BiometricMessageHandlerService } from "../../services/biometric-message-handler.service";
import { NativeMessagingService } from "../../services/native-messaging.service";

import { UpdateRestartService } from "./update-restart.service";

@Injectable()
export class InitService {
  constructor(
    @Inject(WINDOW) private win: Window,
    private vaultTimeoutService: DefaultVaultTimeoutService,
    private i18nService: I18nServiceAbstraction,
    private eventUploadService: EventUploadServiceAbstraction,
    private twoFactorService: TwoFactorService,
    private notificationsService: ServerNotificationsService,
    private platformUtilsService: PlatformUtilsServiceAbstraction,
    private keyService: KeyServiceAbstraction,
    private nativeMessagingService: NativeMessagingService,
    private themingService: AbstractThemingService,
    private encryptService: EncryptService,
    private unlockService: UnlockService,
    private accountService: AccountService,
    private tokenService: TokenService,
    private versionService: VersionService,
    private sshAgentService: SshAgentService,
    private autofillService: DesktopAutofillService,
    private autotypeMvpService: DesktopAutotypeMvpService,
    private autotypeService: DesktopAutotypeService,
    private sdkLoadService: SdkLoadService,
    private ipcService: IpcService,
    private sharedUnlockPeerService: SharedUnlockPeerService,
    private biometricMessageHandlerService: BiometricMessageHandlerService,
    private biometricsService: BiometricsService,
    private legacyCompatKeyService: LegacyCompatKeyService,
    @Inject(DOCUMENT) private document: Document,
    private readonly migrationRunner: MigrationRunner,
    private serverCommunicationConfigService: ServerCommunicationConfigService,
    private updateRestartService: UpdateRestartService,
    private logService: LogService,
    private automationDriver: AutomationDriver,
    private localVaultAttach: LocalVaultAttachService,
  ) {}

  init() {
    return async () => {
      await this.sdkLoadService.loadAndInit();
      this.localVaultAttach.start();
      await this.ipcService.init();
      await this.biometricsService.setUnlockService(this.unlockService);
      await this.sshAgentService.init();
      this.nativeMessagingService.init();
      await this.migrationRunner.waitForCompletion(); // Desktop will run migrations in the main process

      const accounts = await firstValueFrom(this.accountService.accounts$);
      const userIds = Object.keys(accounts) as UserId[];
      await this.tokenService.cleanupTokenStorage(userIds);

      // For each acct, we must await the process of unlocking with the never-lock key
      // if it is set, to avoid race conditions of any code trying to access the user key
      // from mem. A failure to unlock one account leaves that account locked rather than
      // failing app initialization for every other account.
      await Promise.all(
        userIds.map(async (userId) => {
          try {
            await this.unlockService.unlockWithAutoUnlockKey(userId);
          } catch (e) {
            this.logService.error("[InitService] Failed to auto-unlock user on startup", e);
          }
        }),
      );

      await this.serverCommunicationConfigService.init();
      await this.vaultTimeoutService.init(true);
      await (this.i18nService as I18nRendererService).init();
      (this.eventUploadService as EventUploadService).init(true);
      this.twoFactorService.init();
      this.notificationsService.startListening();
      const htmlEl = this.win.document.documentElement;
      htmlEl.classList.add("os_" + this.platformUtilsService.getDeviceString());
      this.themingService.applyThemeChangesTo(this.document);

      this.versionService.init();
      this.updateRestartService.init();

      const containerService = new ContainerService(
        this.keyService,
        this.encryptService,
        this.legacyCompatKeyService,
      );
      containerService.attachToGlobal(this.win);
      this.automationDriver.attachToGlobal(this.win);

      await this.sharedUnlockPeerService.start();
      await this.biometricMessageHandlerService.init();
      await this.autofillService.init();
      await this.autotypeMvpService.init();
      await this.autotypeService.init();
    };
  }
}
