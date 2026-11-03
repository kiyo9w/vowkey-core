// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { APP_INITIALIZER, NgModule } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { Subject, merge, of } from "rxjs";

import { CollectionService, OrganizationUserApiService } from "@vowkey/admin-console/common";
import { DeviceManagementComponentServiceAbstraction } from "@vowkey/angular/auth/device-management/device-management-component.service.abstraction";
import { SetInitialPasswordService } from "@vowkey/angular/auth/password-management/set-initial-password/set-initial-password.service.abstraction";
import { SafeProvider, safeProvider } from "@vowkey/angular/platform/utils/safe-provider";
import {
  SECURE_STORAGE,
  LOCALES_DIRECTORY,
  SYSTEM_LANGUAGE,
  MEMORY_STORAGE,
  OBSERVABLE_MEMORY_STORAGE,
  OBSERVABLE_DISK_STORAGE,
  WINDOW,
  SUPPORTS_SECURE_STORAGE,
  SYSTEM_THEME_OBSERVABLE,
  SafeInjectionToken,
  DEFAULT_VAULT_TIMEOUT,
  INTRAPROCESS_MESSAGING_SUBJECT,
  CLIENT_TYPE,
} from "@vowkey/angular/services/injection-tokens";
import { JslibServicesModule } from "@vowkey/angular/services/jslib-services.module";
import { NudgesService } from "@vowkey/angular/vault";
import {
  LoginComponentService,
  SsoComponentService,
  DefaultSsoComponentService,
  TwoFactorAuthDuoComponentService,
} from "@vowkey/auth/angular";
import {
  InternalUserDecryptionOptionsServiceAbstraction,
  LoginEmailService,
  SsoUrlService,
} from "@vowkey/auth/common";
import {
  AutomationCapability,
  BiometricsCapability,
  DesktopNavigationCapability,
  ProcessReloadCapability,
} from "@vowkey/automation-driver";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { OrganizationApiServiceAbstraction } from "@vowkey/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import {
  PolicyService as PolicyServiceAbstraction,
  InternalPolicyService,
} from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import {
  AccountService,
  AccountService as AccountServiceAbstraction,
} from "@vowkey/common/auth/abstractions/account.service";
import { AuthRequestAnsweringService } from "@vowkey/common/auth/abstractions/auth-request-answering/auth-request-answering.service.abstraction";
import {
  AuthService,
  AuthService as AuthServiceAbstraction,
} from "@vowkey/common/auth/abstractions/auth.service";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { SsoLoginServiceAbstraction } from "@vowkey/common/auth/abstractions/sso-login.service.abstraction";
import { TokenService } from "@vowkey/common/auth/abstractions/token.service";
import { WebAuthnLoginPrfKeyServiceAbstraction } from "@vowkey/common/auth/abstractions/webauthn/webauthn-login-prf-key.service.abstraction";
import { PendingAuthRequestsStateService } from "@vowkey/common/auth/services/auth-request-answering/pending-auth-requests.state";
import { AutofillSettingsServiceAbstraction } from "@vowkey/common/autofill/services/autofill-settings.service";
import { DomainSettingsService } from "@vowkey/common/autofill/services/domain-settings.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions";
import { ClientType, DeviceType } from "@vowkey/common/enums";
import { AccountCryptographicStateService } from "@vowkey/common/key-management/account-cryptography/account-cryptographic-state.service";
import {
  InternalMasterPasswordServiceAbstraction,
  MasterPasswordServiceAbstraction,
} from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { PinServiceAbstraction } from "@vowkey/common/key-management/pin/pin.service.abstraction";
import {
  DefaultProcessReloadService,
  ProcessReloadServiceAbstraction,
} from "@vowkey/common/key-management/process-reload";
import { SessionTimeoutTypeService } from "@vowkey/common/key-management/session-timeout";
import {
  SharedUnlockPeerService,
  SharedUnlockSettingsService,
  DefaultSharedUnlockSettingsService,
} from "@vowkey/common/key-management/shared-unlock";
import { DefaultSharedUnlockPeerService } from "@vowkey/common/key-management/shared-unlock/default-shared-unlock-peer.service";
import {
  VaultTimeoutSettingsService,
  VaultTimeoutStringType,
} from "@vowkey/common/key-management/vault-timeout";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { Fido2AuthenticatorService as Fido2AuthenticatorServiceAbstraction } from "@vowkey/common/platform/abstractions/fido2/fido2-authenticator.service.abstraction";
import { Fido2UserInterfaceService as Fido2UserInterfaceServiceAbstraction } from "@vowkey/common/platform/abstractions/fido2/fido2-user-interface.service.abstraction";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { I18nService as I18nServiceAbstraction } from "@vowkey/common/platform/abstractions/i18n.service";
import {
  LogService,
  LogService as LogServiceAbstraction,
} from "@vowkey/common/platform/abstractions/log.service";
import { MessagingService as MessagingServiceAbstraction } from "@vowkey/common/platform/abstractions/messaging.service";
import {
  PlatformUtilsService,
  PlatformUtilsService as PlatformUtilsServiceAbstraction,
} from "@vowkey/common/platform/abstractions/platform-utils.service";
import { RegisterSdkService } from "@vowkey/common/platform/abstractions/sdk/register-sdk.service";
import { SdkClientFactory } from "@vowkey/common/platform/abstractions/sdk/sdk-client-factory";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { StateService as StateServiceAbstraction } from "@vowkey/common/platform/abstractions/state.service";
import { AbstractStorageService } from "@vowkey/common/platform/abstractions/storage.service";
import { SystemService as SystemServiceAbstraction } from "@vowkey/common/platform/abstractions/system.service";
import { IpcService } from "@vowkey/common/platform/ipc";
import { Message, MessageListener, MessageSender } from "@vowkey/common/platform/messaging";
// eslint-disable-next-line no-restricted-imports -- Used for dependency injection
import { SubjectMessageSender } from "@vowkey/common/platform/messaging/internal";
import { TaskSchedulerService } from "@vowkey/common/platform/scheduling";
import { Fido2AuthenticatorService } from "@vowkey/common/platform/services/fido2/fido2-authenticator.service";
import { MemoryStorageService } from "@vowkey/common/platform/services/memory-storage.service";
import { DefaultSdkClientFactory } from "@vowkey/common/platform/services/sdk/default-sdk-client-factory";
import { DefaultSdkLoadService } from "@vowkey/common/platform/services/sdk/default-sdk-load.service";
import { NoopSdkClientFactory } from "@vowkey/common/platform/services/sdk/noop-sdk-client-factory";
import { NoopSdkLoadService } from "@vowkey/common/platform/services/sdk/noop-sdk-load.service";
import { SystemService } from "@vowkey/common/platform/services/system.service";
import { GlobalStateProvider, StateProvider } from "@vowkey/common/platform/state";
import { SyncService } from "@vowkey/common/platform/sync";
import { CipherService as CipherServiceAbstraction } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { COPY_CLICK_LISTENER, DialogService, ToastService } from "@vowkey/components";
import { GeneratorServicesModule } from "@vowkey/generator-components";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";
import {
  KdfConfigService,
  KeyService,
  KeyService as KeyServiceAbstraction,
  DefaultKeyService,
  BiometricStateService,
  BiometricsService,
} from "@vowkey/key-management";
import {
  LockComponentService,
  SessionTimeoutSettingsComponentService,
  WebAuthnPrfUnlockService,
  DefaultWebAuthnPrfUnlockService,
  KeyManagementUiModule,
} from "@vowkey/key-management-ui";
// eslint-disable-next-line no-restricted-imports
import {
  CryptoFunctionService as CryptoFunctionServiceAbstraction,
  EncryptService,
  LegacyCompatKeyService,
  WebCryptoFunctionService,
} from "@vowkey/legacy-crypto";
import { FlightRecorderLogRecorderService } from "@vowkey/logging-angular";
import { SerializedMemoryStorageService } from "@vowkey/storage-core";
import {
  SHARE_ITEM_PRESENTER,
  SHARE_PASSWORD_REPROMPT,
  ShareButtonComponent,
} from "@vowkey/tools-share";
import { LockService, UnlockService } from "@vowkey/unlock";
import {
  CipherFormGenerationService,
  DefaultSshImportPromptService,
  DefaultVaultNavService,
  SshImportPromptService,
  VaultNavService,
  VaultFilterServiceAbstraction,
  VaultFilterService,
  RoutedVaultFilterService,
  RoutedVaultFilterBridgeService,
  VAULT_FILTER_BASE_ROUTE,
  Vfo1TerminologyService,
  PasswordRepromptService,
  SHARE_ITEM_ENTRY_POINT,
  VFO1_FILTERS_STEP,
  VFO1_SHARED_FOLDERS_STEP,
  VFO1_VAULT_LIST_STEP,
  VFO1_WALKTHROUGH_STEPS,
} from "@vowkey/vault";

import { DesktopLoginComponentService } from "../../auth/login/desktop-login-component.service";
import { DesktopAuthRequestAnsweringService } from "../../auth/services/auth-request-answering/desktop-auth-request-answering.service";
import { DesktopTwoFactorAuthDuoComponentService } from "../../auth/services/desktop-two-factor-auth-duo-component.service";
import { DesktopAutofillSettingsService } from "../../autofill/services/desktop-autofill-settings.service";
import { DesktopAutofillService } from "../../autofill/services/desktop-autofill.service";
import { DesktopAutotypeMvpService } from "../../autofill/services/desktop-autotype-mvp.service";
import { DesktopAutotypeDefaultSettingPolicy } from "../../autofill/services/desktop-autotype-policy.service";
import { DesktopAutotypeService } from "../../autofill/services/desktop-autotype.service";
import { DesktopFido2MacOsUserVerificationService } from "../../autofill/services/desktop-fido2-macos-user-verification.service";
import { DesktopFido2UnsupportedUserVerificationService } from "../../autofill/services/desktop-fido2-unsupported-user-verification.service";
import { DesktopFido2UserInterfaceService } from "../../autofill/services/desktop-fido2-user-interface.service";
import { DesktopFido2UserVerificationService } from "../../autofill/services/desktop-fido2-user-verification.service.abstraction";
import { DesktopFido2WindowsUserVerificationService } from "../../autofill/services/desktop-fido2-windows-user-verification.service";
import { DesktopBiometricsService } from "../../key-management/biometrics/desktop.biometrics.service";
import { RendererBiometricsService } from "../../key-management/biometrics/renderer-biometrics.service";
import { DesktopLockComponentService } from "../../key-management/lock/services/desktop-lock-component.service";
import { DesktopSessionTimeoutTypeService } from "../../key-management/session-timeout/services/desktop-session-timeout-type.service";
import { flagEnabled } from "../../platform/flags";
import { DesktopSettingsService } from "../../platform/services/desktop-settings.service";
import { ElectronLogRendererService } from "../../platform/services/electron-log.renderer.service";
import {
  ELECTRON_SUPPORTS_SECURE_STORAGE,
  ElectronPlatformUtilsService,
} from "../../platform/services/electron-platform-utils.service";
import { ElectronRendererMessageSender } from "../../platform/services/electron-renderer-message.sender";
import { ElectronRendererSecureStorageService } from "../../platform/services/electron-renderer-secure-storage.service";
import { ElectronRendererStorageService } from "../../platform/services/electron-renderer-storage.service";
import { I18nRendererService } from "../../platform/services/i18n.renderer.service";
import { IpcRendererService } from "../../platform/services/ipc-renderer.service";
import {
  DefaultServerCommunicationConfigService,
  ServerCommunicationConfigPlatformApiService,
  ServerCommunicationConfigRepository,
} from "../../platform/services/server-communication-config";
import { ServerCommunicationConfigService } from "../../platform/services/server-communication-config/server-communication-config.service";
import { fromIpcMessaging } from "../../platform/utils/from-ipc-messaging";
import { fromIpcSystemTheme } from "../../platform/utils/from-ipc-system-theme";
import { BiometricMessageHandlerService } from "../../services/biometric-message-handler.service";
import { DesktopCredentialGenerationService } from "../../services/desktop-cipher-form-generator.service";
import { DesktopCopyListenerService } from "../../services/desktop-copy-listener.service";
import { DesktopDeviceManagementComponentService } from "../../services/desktop-device-management-component.service";
import { DuckDuckGoMessageHandlerService } from "../../services/duckduckgo-message-handler.service";
import { EncryptedMessageHandlerService } from "../../services/encrypted-message-handler.service";
import { NativeMessagingService } from "../../services/native-messaging.service";
import { DesktopShareItemPresenter } from "../tools/share-item/desktop-share-item.presenter";

import { DesktopFileDownloadService } from "./desktop-file-download.service";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";
import { productInferenceFactory } from "@vowkey/angular/services/product-inference.factory";
import { NativeKeyProtector } from "@vowkey/common/vault/local/protection";
import { LocalVaultAttachService, LOCAL_VAULT_CUSTODY } from "@vowkey/angular/services/local-vault-attach.service";
import { PROFILE_DOCUMENT_ACTIONS } from "@vowkey/vault";
import { LOCAL_AGENT_MANAGEMENT, LocalAgentState } from "@vowkey/vault";
import { desktopAccountKeyCustody, desktopMigrationCustody } from "../../local-vault/custody";
import { DocumentCaptureService, documentProfileActionsFactory } from "./document-capture.service";

import { InitService } from "./init.service";
import { NativeMessagingManifestService } from "./native-messaging-manifest.service";
import { DesktopSetInitialPasswordService } from "./set-initial-password/desktop-set-initial-password.service";

/**
 * Provider definitions used in the ngModule.
 * Add your provider definition here using the safeProvider function as a wrapper. This will give you type safety.
 * If you need help please ask for it, do NOT change the type of this array.
 */
const safeProviders: SafeProvider[] = [
  safeProvider({
    provide: LocalVaultService,
    useFactory: (storage: AbstractStorageService) => new LocalVaultService(
      ipc.localVault, storage, new NativeKeyProtector(
        () => ipc.localVault.readKey(), (key) => ipc.localVault.writeKey(key),
        () => ipc.localVault.clearKey(),
      ), desktopAccountKeyCustody(),
    ),
    deps: [AbstractStorageService],
  }),
  safeProvider({ provide: LOCAL_VAULT_CUSTODY, useFactory: desktopMigrationCustody,
    deps: [LocalVaultService] }),
  safeProvider({ provide: ProductInference, useFactory: productInferenceFactory,
    deps: [LocalVaultService, AccountService, TokenService, EnvironmentService] }),
  safeProvider({ provide: LocalVaultAttachService, useClass: LocalVaultAttachService,
    useAngularDecorators: true }),
  safeProvider({ provide: LOCAL_AGENT_MANAGEMENT, useValue: {
    pending: () => ipc.localVault.agent.pending() as Promise<LocalAgentState>,
    approve: (connectionId: string) => ipc.localVault.agent.approve(connectionId).then((): void => undefined),
    answer: (requestId: string, answer: "allow_once" | "always_allow" | "deny", selectedEntryIds: string[]) =>
      ipc.localVault.agent.answer(requestId, answer, selectedEntryIds).then((): void => undefined),
    revoke: (pairingId: string) => ipc.localVault.agent.revoke(pairingId).then((): void => undefined),
  } }),
  safeProvider({ provide: PROFILE_DOCUMENT_ACTIONS, useFactory: documentProfileActionsFactory,
    deps: [DocumentCaptureService] }),
  safeProvider(InitService),
  safeProvider({
    provide: VFO1_WALKTHROUGH_STEPS,
    useValue: [VFO1_VAULT_LIST_STEP, VFO1_SHARED_FOLDERS_STEP, VFO1_FILTERS_STEP],
  }),
  safeProvider({
    provide: CipherFormGenerationService,
    useClass: DesktopCredentialGenerationService,
    deps: [],
  }),
  safeProvider({
    provide: BiometricsService,
    useClass: RendererBiometricsService,
    deps: [TokenService, BiometricStateService, IpcService],
  }),
  safeProvider({
    provide: DesktopBiometricsService,
    useClass: RendererBiometricsService,
    deps: [TokenService, BiometricStateService, IpcService],
  }),
  safeProvider({
    provide: DeviceManagementComponentServiceAbstraction,
    useClass: DesktopDeviceManagementComponentService,
    deps: [],
  }),
  // Desktop-only automation capabilities.
  safeProvider({
    provide: AutomationCapability,
    useFactory: () => new ProcessReloadCapability(() => ipc.platform.reloadProcess()),
    deps: [],
    multi: true,
  }),
  safeProvider({
    provide: AutomationCapability,
    useFactory: (toastService: ToastService) =>
      new BiometricsCapability(
        {
          setStatus: (status) => ipc.keyManagement.automation.biometrics.setStatus(status),
          listPending: () => ipc.keyManagement.automation.biometrics.listPending(),
          approve: (id) => ipc.keyManagement.automation.biometrics.approve(id),
          deny: (id) => ipc.keyManagement.automation.biometrics.deny(id),
          onRequest: (callback) => ipc.keyManagement.automation.biometrics.onRequest(callback),
        },
        toastService,
      ),
    deps: [ToastService],
    multi: true,
  }),
  safeProvider({
    provide: AutomationCapability,
    useFactory: (messagingService: MessagingServiceAbstraction) =>
      new DesktopNavigationCapability(messagingService),
    deps: [MessagingServiceAbstraction],
    multi: true,
  }),
  safeProvider(NativeMessagingService),
  safeProvider(BiometricMessageHandlerService),
  safeProvider(DialogService),
  safeProvider({
    provide: APP_INITIALIZER as SafeInjectionToken<() => void>,
    useFactory: (initService: InitService) => initService.init(),
    deps: [InitService],
    multi: true,
  }),
  safeProvider({
    provide: LogServiceAbstraction,
    useFactory: (recorder: FlightRecorderLogRecorderService) =>
      new ElectronLogRendererService(null, recorder),
    deps: [FlightRecorderLogRecorderService],
  }),
  safeProvider({
    provide: PlatformUtilsServiceAbstraction,
    useClass: ElectronPlatformUtilsService,
    deps: [I18nServiceAbstraction, MessagingServiceAbstraction],
  }),
  safeProvider({
    // We manually override the value of SUPPORTS_SECURE_STORAGE here to avoid
    // the TokenService having to inject the PlatformUtilsService which introduces a
    // circular dependency on Desktop only.
    //
    // For Windows portable builds, we disable secure storage to ensure tokens are
    // stored on disk (in vowkey-appdata) rather than in Windows Credential
    // Manager, making them portable across machines. This allows users to move the USB drive
    // between computers while maintaining authentication.
    //
    // Note: Portable mode does not use secure storage for read/write/clear operations,
    // preventing any collision with tokens from a regular desktop installation.
    //
    // Setting the ACCESS_TOKEN_LOCATION=DISK environment variable forces the same disk-backed
    // behavior on any platform, for environments where the OS keyring is unavailable or
    // undesirable (see `accessTokenLocation` in apps/desktop/src/main/platform-utils.main.ts).
    provide: SUPPORTS_SECURE_STORAGE,
    useValue:
      ELECTRON_SUPPORTS_SECURE_STORAGE &&
      !ipc.platform.isWindowsPortable &&
      !ipc.platform.forceDiskAccessTokenStorage,
  }),
  safeProvider({
    provide: DEFAULT_VAULT_TIMEOUT,
    useValue: VaultTimeoutStringType.OnRestart,
  }),
  safeProvider({
    provide: I18nServiceAbstraction,
    useClass: I18nRendererService,
    deps: [SYSTEM_LANGUAGE, LOCALES_DIRECTORY, GlobalStateProvider],
  }),
  safeProvider({
    provide: MessageSender,
    useFactory: (subject: Subject<Message<Record<string, unknown>>>) =>
      MessageSender.combine(
        new ElectronRendererMessageSender(), // Communication with main process
        new SubjectMessageSender(subject), // Communication with ourself
      ),
    deps: [INTRAPROCESS_MESSAGING_SUBJECT],
  }),
  safeProvider({
    provide: MessageListener,
    useFactory: (subject: Subject<Message<Record<string, unknown>>>) =>
      new MessageListener(
        merge(
          subject.asObservable(), // For messages from the same context
          fromIpcMessaging(), // For messages from the main process
        ),
      ),
    deps: [INTRAPROCESS_MESSAGING_SUBJECT],
  }),
  safeProvider({
    provide: AbstractStorageService,
    useClass: ElectronRendererStorageService,
    deps: [],
  }),
  safeProvider({
    provide: SECURE_STORAGE,
    useClass: ElectronRendererSecureStorageService,
    deps: [],
  }),
  safeProvider({ provide: MEMORY_STORAGE, useClass: MemoryStorageService, deps: [] }),
  safeProvider({
    provide: OBSERVABLE_MEMORY_STORAGE,
    useClass: SerializedMemoryStorageService,
    deps: [],
  }),
  safeProvider({ provide: OBSERVABLE_DISK_STORAGE, useExisting: AbstractStorageService }),
  safeProvider({
    provide: SystemServiceAbstraction,
    useClass: SystemService,
    deps: [
      PlatformUtilsServiceAbstraction,
      AutofillSettingsServiceAbstraction,
      TaskSchedulerService,
    ],
  }),
  safeProvider({
    provide: ProcessReloadServiceAbstraction,
    useClass: DefaultProcessReloadService,
    deps: [
      PinServiceAbstraction,
      MessagingServiceAbstraction,
      VaultTimeoutSettingsService,
      AccountServiceAbstraction,
      LogService,
      AuthServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: FileDownloadService,
    useClass: DesktopFileDownloadService,
    deps: [],
  }),
  safeProvider({
    provide: SYSTEM_THEME_OBSERVABLE,
    useFactory: () => fromIpcSystemTheme(),
    deps: [],
  }),
  safeProvider({
    provide: EncryptedMessageHandlerService,
    deps: [
      AccountServiceAbstraction,
      AuthServiceAbstraction,
      CipherServiceAbstraction,
      PolicyServiceAbstraction,
      MessagingServiceAbstraction,
      PasswordGenerationServiceAbstraction,
      LocalVaultService,
    ],
  }),
  safeProvider({
    provide: DuckDuckGoMessageHandlerService,
    deps: [
      StateServiceAbstraction,
      EncryptService,
      CryptoFunctionServiceAbstraction,
      MessagingServiceAbstraction,
      EncryptedMessageHandlerService,
      DialogService,
      DesktopAutofillSettingsService,
    ],
  }),
  safeProvider({
    provide: CryptoFunctionServiceAbstraction,
    useClass: WebCryptoFunctionService,
    deps: [WINDOW],
  }),
  safeProvider({
    provide: KeyServiceAbstraction,
    useClass: DefaultKeyService,
    deps: [
      CryptoFunctionServiceAbstraction,
      EncryptService,
      PlatformUtilsServiceAbstraction,
      LogService,
      StateServiceAbstraction,
      StateProvider,
      AccountCryptographicStateService,
      BiometricsService,
    ],
  }),
  safeProvider({
    provide: DesktopSettingsService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: SharedUnlockSettingsService,
    useClass: DefaultSharedUnlockSettingsService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: SharedUnlockPeerService,
    useClass: DefaultSharedUnlockPeerService,
    deps: [
      IpcService,
      AccountService,
      LockService,
      PlatformUtilsServiceAbstraction,
      VaultTimeoutSettingsService,
      EnvironmentService,
      SharedUnlockSettingsService,
      UnlockService,
      ConfigService,
      StateProvider,
    ],
  }),
  safeProvider({
    provide: DesktopAutofillSettingsService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: DesktopAutofillService,
    deps: [
      LogService,
      CipherServiceAbstraction,
      ConfigService,
      Fido2AuthenticatorServiceAbstraction,
      AccountService,
      AuthService,
      EnvironmentService,
      PlatformUtilsService,
      DesktopFido2UserInterfaceService,
    ],
  }),
  safeProvider({
    provide: DesktopFido2UserVerificationService,
    useFactory: (
      platformUtilsService: PlatformUtilsServiceAbstraction,
      i18nService: I18nServiceAbstraction,
      logService: LogServiceAbstraction,
    ): DesktopFido2UserVerificationService => {
      switch (platformUtilsService.getDevice()) {
        case DeviceType.MacOsDesktop:
          return new DesktopFido2MacOsUserVerificationService(i18nService, logService);
        case DeviceType.WindowsDesktop:
          return new DesktopFido2WindowsUserVerificationService(i18nService, logService);
        default:
          return new DesktopFido2UnsupportedUserVerificationService(logService);
      }
    },
    deps: [PlatformUtilsServiceAbstraction, I18nServiceAbstraction, LogServiceAbstraction],
  }),
  safeProvider({
    provide: DesktopFido2UserInterfaceService,
    useClass: DesktopFido2UserInterfaceService,
    deps: [
      AuthServiceAbstraction,
      CipherServiceAbstraction,
      AccountService,
      LogService,
      MessagingServiceAbstraction,
      Router,
      DesktopSettingsService,
      DesktopFido2UserVerificationService,
      PasswordRepromptService,
      DomainSettingsService,
    ],
  }),
  safeProvider({
    provide: Fido2UserInterfaceServiceAbstraction, // We utilize desktop specific methods when wiring OS API's
    useExisting: DesktopFido2UserInterfaceService,
  }),
  safeProvider({
    provide: Fido2AuthenticatorServiceAbstraction,
    useClass: Fido2AuthenticatorService,
    deps: [
      CipherServiceAbstraction,
      Fido2UserInterfaceServiceAbstraction,
      SyncService,
      AccountService,
      LogService,
    ],
  }),
  safeProvider({
    provide: NativeMessagingManifestService,
    useClass: NativeMessagingManifestService,
    deps: [],
  }),
  safeProvider({
    provide: LockComponentService,
    useClass: DesktopLockComponentService,
    deps: [],
  }),
  safeProvider({
    provide: WebAuthnPrfUnlockService,
    useClass: DefaultWebAuthnPrfUnlockService,
    deps: [
      WebAuthnLoginPrfKeyServiceAbstraction,
      StateProvider,
      EncryptService,
      EnvironmentService,
      PlatformUtilsServiceAbstraction,
      WINDOW,
      LogServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: CLIENT_TYPE,
    useValue: ClientType.Desktop,
  }),
  safeProvider({
    provide: SetInitialPasswordService,
    useClass: DesktopSetInitialPasswordService,
    deps: [
      ApiService,
      EncryptService,
      I18nServiceAbstraction,
      KdfConfigService,
      KeyService,
      LegacyCompatKeyService,
      MasterPasswordApiService,
      InternalMasterPasswordServiceAbstraction,
      OrganizationApiServiceAbstraction,
      OrganizationUserApiService,
      InternalUserDecryptionOptionsServiceAbstraction,
      MessagingServiceAbstraction,
      AccountCryptographicStateService,
      RegisterSdkService,
      UnlockService,
    ],
  }),
  safeProvider({
    provide: SsoUrlService,
    useClass: SsoUrlService,
    deps: [],
  }),
  safeProvider({
    provide: LoginComponentService,
    useClass: DesktopLoginComponentService,
    deps: [
      CryptoFunctionServiceAbstraction,
      EnvironmentService,
      PasswordGenerationServiceAbstraction,
      PlatformUtilsServiceAbstraction,
      SsoLoginServiceAbstraction,
      I18nServiceAbstraction,
      ToastService,
      SsoUrlService,
    ],
  }),
  safeProvider({
    provide: TwoFactorAuthDuoComponentService,
    useClass: DesktopTwoFactorAuthDuoComponentService,
    deps: [
      MessageListener,
      EnvironmentService,
      I18nServiceAbstraction,
      PlatformUtilsServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: SdkClientFactory,
    useClass: flagEnabled("sdk") ? DefaultSdkClientFactory : NoopSdkClientFactory,
    deps: [],
  }),
  safeProvider({
    provide: SdkLoadService,
    useClass: flagEnabled("sdk") ? DefaultSdkLoadService : NoopSdkLoadService,
    deps: [],
  }),
  safeProvider({
    provide: LoginEmailService,
    useClass: LoginEmailService,
    deps: [AccountService, AuthService, StateProvider],
  }),
  safeProvider({
    provide: SsoComponentService,
    useClass: DefaultSsoComponentService,
    deps: [],
  }),
  safeProvider({
    provide: VaultNavService,
    useClass: DefaultVaultNavService,
    deps: [],
  }),
  safeProvider({
    provide: SshImportPromptService,
    useClass: DefaultSshImportPromptService,
    deps: [
      DialogService,
      ToastService,
      PlatformUtilsServiceAbstraction,
      I18nServiceAbstraction,
      ConfigService,
      LogService,
    ],
  }),
  safeProvider({
    provide: DesktopAutotypeMvpService,
    useClass: DesktopAutotypeMvpService,
    deps: [
      AccountService,
      AuthService,
      CipherServiceAbstraction,
      ConfigService,
      GlobalStateProvider,
      PlatformUtilsServiceAbstraction,
      BillingAccountProfileStateService,
      DesktopAutotypeDefaultSettingPolicy,
      LogService,
    ],
  }),
  safeProvider({
    provide: DesktopAutotypeService,
    useClass: DesktopAutotypeService,
    deps: [
      AccountService,
      AuthService,
      CipherServiceAbstraction,
      ConfigService,
      GlobalStateProvider,
      PlatformUtilsServiceAbstraction,
      BillingAccountProfileStateService,
    ],
  }),
  // Autotype MVP only: must only be consumed within the Autotype MVP scope
  safeProvider({
    provide: DesktopAutotypeDefaultSettingPolicy,
    useClass: DesktopAutotypeDefaultSettingPolicy,
    deps: [AccountServiceAbstraction, AuthServiceAbstraction, InternalPolicyService, ConfigService],
  }),
  safeProvider({
    provide: SessionTimeoutTypeService,
    useClass: DesktopSessionTimeoutTypeService,
    deps: [],
  }),
  safeProvider({
    provide: SessionTimeoutSettingsComponentService,
    useClass: SessionTimeoutSettingsComponentService,
    deps: [I18nServiceAbstraction, SessionTimeoutTypeService, PolicyServiceAbstraction],
  }),
  safeProvider({
    provide: VaultFilterServiceAbstraction,
    useClass: VaultFilterService,
    deps: [
      OrganizationService,
      FolderService,
      CipherServiceAbstraction,
      PolicyServiceAbstraction,
      I18nServiceAbstraction,
      StateProvider,
      CollectionService,
      AccountServiceAbstraction,
      ConfigService,
      Vfo1TerminologyService,
    ],
  }),
  safeProvider({
    provide: VAULT_FILTER_BASE_ROUTE,
    useValue: "/vault",
  }),
  safeProvider({
    provide: RoutedVaultFilterService,
    useClass: RoutedVaultFilterService,
    deps: [ActivatedRoute],
  }),
  safeProvider({
    provide: RoutedVaultFilterBridgeService,
    useClass: RoutedVaultFilterBridgeService,
    deps: [Router, RoutedVaultFilterService, VaultFilterServiceAbstraction],
  }),
  safeProvider({
    provide: COPY_CLICK_LISTENER,
    useClass: DesktopCopyListenerService,
    deps: [MessagingServiceAbstraction],
  }),
  safeProvider({
    provide: AuthRequestAnsweringService,
    useClass: DesktopAuthRequestAnsweringService,
    deps: [
      AccountServiceAbstraction,
      AuthService,
      MasterPasswordServiceAbstraction,
      MessagingServiceAbstraction,
      PendingAuthRequestsStateService,
      I18nServiceAbstraction,
      LogService,
      ConfigService,
    ],
  }),
  safeProvider({
    provide: ServerCommunicationConfigService,
    useFactory: (
      stateProvider: StateProvider,
      platformUtilsService: PlatformUtilsService,
      messageListener: MessageListener,
      logService: LogService,
      configService: ConfigService,
      apiService: ApiService,
      dialogService: DialogService,
    ) =>
      new DefaultServerCommunicationConfigService(
        new ServerCommunicationConfigRepository(stateProvider),
        new ServerCommunicationConfigPlatformApiService(
          platformUtilsService,
          messageListener,
          logService,
          dialogService,
        ),
        configService,
        apiService,
      ),
    deps: [
      StateProvider,
      PlatformUtilsService,
      MessageListener,
      LogService,
      ConfigService,
      ApiService,
      DialogService,
    ],
  }),
  safeProvider({
    provide: IpcService,
    useClass: IpcRendererService,
    deps: [],
  }),
  safeProvider({
    provide: NudgesService,
    useFactory: () =>
      ({
        showNudgeSpotlight$: () => of(false),
        showNudgeBadge$: () => of(false),
        showNudgeStatus$: () => of({ hasBadgeDismissed: true, hasSpotlightDismissed: true }),
        dismissNudge: async () => {},
        hasActiveBadges$: () => of(false),
      }) as unknown as NudgesService,
    deps: [],
  }),
  // Sharing and the Vault layer reach each other through tokens rather than imports, because
  // `@vowkey/tools-share` already depends on `@vowkey/vault` through `@vowkey/send-ui`
  // and importing it back would close a package cycle. The app sits above both, so it is the one
  // place the two can be introduced.
  safeProvider({
    provide: SHARE_ITEM_ENTRY_POINT,
    useValue: ShareButtonComponent,
  }),
  safeProvider({
    provide: SHARE_PASSWORD_REPROMPT,
    useExisting: PasswordRepromptService,
    deps: [],
  }),
  safeProvider(DesktopShareItemPresenter),
  safeProvider({
    provide: SHARE_ITEM_PRESENTER,
    useExisting: DesktopShareItemPresenter,
    deps: [],
  }),
];

@NgModule({
  imports: [JslibServicesModule, KeyManagementUiModule, GeneratorServicesModule],
  declarations: [],
  // Do not register your dependency here! Add it to the typesafeProviders array using the helper function
  providers: safeProviders,
})
export class ServicesModule {}
