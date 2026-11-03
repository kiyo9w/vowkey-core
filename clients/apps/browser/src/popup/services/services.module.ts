// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { APP_INITIALIZER, NgModule, NgZone } from "@angular/core";
import {
  LOCAL_VAULT_CUSTODY,
  LocalVaultAttachService,
} from "@vowkey/angular/services/local-vault-attach.service";
import { productInferenceFactory } from "@vowkey/angular/services/product-inference.factory";
import { WebLocalVaultCustody } from "@vowkey/angular/services/web-local-vault-custody";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";
import { IndexedDbCryptoKeyProtector } from "@vowkey/common/vault/local/protection";
import { IndexedDbLocalVaultStore } from "@vowkey/common/vault/local/store";
import { merge, of, Subject } from "rxjs";

import { CollectionService } from "@vowkey/admin-console/common";
import { DeviceManagementComponentServiceAbstraction } from "@vowkey/angular/auth/device-management/device-management-component.service.abstraction";
import { LoginViaWebAuthnComponentService } from "@vowkey/angular/auth/login-via-webauthn/login-via-webauthn-component.service";
import { ChangePasswordService } from "@vowkey/angular/auth/password-management/change-password";
import { AngularThemingService } from "@vowkey/angular/platform/services/theming/angular-theming.service";
import { SafeProvider, safeProvider } from "@vowkey/angular/platform/utils/safe-provider";
import { ViewCacheService } from "@vowkey/angular/platform/view-cache";
import {
  CLIENT_TYPE,
  DEFAULT_VAULT_TIMEOUT,
  ENV_ADDITIONAL_REGIONS,
  INTRAPROCESS_MESSAGING_SUBJECT,
  MEMORY_STORAGE,
  OBSERVABLE_DISK_STORAGE,
  OBSERVABLE_MEMORY_STORAGE,
  SafeInjectionToken,
  SECURE_STORAGE,
  SYSTEM_THEME_OBSERVABLE,
  WINDOW,
} from "@vowkey/angular/services/injection-tokens";
import { JslibServicesModule } from "@vowkey/angular/services/jslib-services.module";
import { NudgesService } from "@vowkey/angular/vault";
import {
  LoginComponentService,
  TwoFactorAuthComponentService,
  TwoFactorAuthDuoComponentService,
  TwoFactorAuthWebAuthnComponentService,
  SsoComponentService,
  NewDeviceVerificationComponentService,
} from "@vowkey/auth/angular";
import {
  LoginEmailService,
  SsoUrlService,
  LogoutService,
  UserDecryptionOptionsServiceAbstraction,
} from "@vowkey/auth/common";
import { ExtensionAuthRequestAnsweringService } from "@vowkey/browser/auth/services/auth-request-answering/extension-auth-request-answering.service";
import { ExtensionNewDeviceVerificationComponentService } from "@vowkey/browser/auth/services/new-device-verification/extension-new-device-verification-component.service";
import { BrowserRouterService } from "@vowkey/browser/platform/popup/services/browser-router.service";
import { BrowserShareItemPresenter } from "@vowkey/browser/tools/popup/share/browser-share-item.presenter";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import {
  InternalPolicyService,
  PolicyService,
} from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import {
  AccountService,
  AccountService as AccountServiceAbstraction,
} from "@vowkey/common/auth/abstractions/account.service";
import { AuthRequestAnsweringService } from "@vowkey/common/auth/abstractions/auth-request-answering/auth-request-answering.service.abstraction";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { SsoLoginServiceAbstraction } from "@vowkey/common/auth/abstractions/sso-login.service.abstraction";
import { TokenService } from "@vowkey/common/auth/abstractions/token.service";
import { UserVerificationService } from "@vowkey/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { WebAuthnLoginPrfKeyServiceAbstraction } from "@vowkey/common/auth/abstractions/webauthn/webauthn-login-prf-key.service.abstraction";
import { OrganizationInviteService } from "@vowkey/common/auth/organization-invite";
import { PendingAuthRequestsStateService } from "@vowkey/common/auth/services/auth-request-answering/pending-auth-requests.state";
import {
  AutofillSettingsService,
  AutofillSettingsServiceAbstraction,
} from "@vowkey/common/autofill/services/autofill-settings.service";
import {
  DefaultDomainSettingsService,
  DomainSettingsService,
} from "@vowkey/common/autofill/services/domain-settings.service";
import {
  UserNotificationSettingsService,
  UserNotificationSettingsServiceAbstraction,
} from "@vowkey/common/autofill/services/user-notification-settings.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions/account/billing-account-profile-state.service";
import { EventCollectionService as EventCollectionServiceAbstraction } from "@vowkey/common/dirt/event-logs";
import { EventUploadService as EventUploadServiceAbstraction } from "@vowkey/common/dirt/event-logs/abstractions/event-upload.service";
import { PhishingDetectionSettingsServiceAbstraction } from "@vowkey/common/dirt/services/abstractions/phishing-detection-settings.service.abstraction";
import { PhishingDetectionSettingsService } from "@vowkey/common/dirt/services/phishing-detection/phishing-detection-settings.service";
import { ClientType } from "@vowkey/common/enums";
import { AccountCryptographicStateService } from "@vowkey/common/key-management/account-cryptography/account-cryptographic-state.service";
import { MasterPasswordUnlockService } from "@vowkey/common/key-management/master-password/abstractions/master-password-unlock.service";
import {
  InternalMasterPasswordServiceAbstraction,
  MasterPasswordServiceAbstraction,
} from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { PinServiceAbstraction } from "@vowkey/common/key-management/pin/pin.service.abstraction";
import { SessionTimeoutTypeService } from "@vowkey/common/key-management/session-timeout";
import {
  SharedUnlockSettingsService,
  DefaultSharedUnlockSettingsService,
} from "@vowkey/common/key-management/shared-unlock";
import { V2UpgradeTokenStateService } from "@vowkey/common/key-management/upgrade-token/abstractions/v2-upgrade-token-state.service.abstraction";
import {
  VaultTimeoutService,
  VaultTimeoutStringType,
} from "@vowkey/common/key-management/vault-timeout";
import {
  AnimationControlService,
  DefaultAnimationControlService,
} from "@vowkey/common/platform/abstractions/animation-control.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { I18nService as I18nServiceAbstraction } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import {
  MessagingService,
  MessagingService as MessagingServiceAbstraction,
} from "@vowkey/common/platform/abstractions/messaging.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { RegisterSdkService } from "@vowkey/common/platform/abstractions/sdk/register-sdk.service";
import { SdkClientFactory } from "@vowkey/common/platform/abstractions/sdk/sdk-client-factory";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { StateService } from "@vowkey/common/platform/abstractions/state.service";
import {
  AbstractStorageService,
  ObservableStorageService,
} from "@vowkey/common/platform/abstractions/storage.service";
import { ActionsService } from "@vowkey/common/platform/actions";
import { Message, MessageListener, MessageSender } from "@vowkey/common/platform/messaging";
// eslint-disable-next-line no-restricted-imports -- Used for dependency injection
import { SubjectMessageSender } from "@vowkey/common/platform/messaging/internal";
import { flagEnabled } from "@vowkey/common/platform/misc/flags";
import { TaskSchedulerService } from "@vowkey/common/platform/scheduling";
import { ServerNotificationsService } from "@vowkey/common/platform/server-notifications";
import { ConsoleLogService } from "@vowkey/common/platform/services/console-log.service";
import { ContainerService } from "@vowkey/common/platform/services/container.service";
import { DefaultSdkClientFactory } from "@vowkey/common/platform/services/sdk/default-sdk-client-factory";
import { NoopSdkClientFactory } from "@vowkey/common/platform/services/sdk/noop-sdk-client-factory";
import { StorageServiceProvider } from "@vowkey/common/platform/services/storage-service.provider";
import { PrimarySecondaryStorageService } from "@vowkey/common/platform/storage/primary-secondary-storage.service";
import { WindowStorageService } from "@vowkey/common/platform/storage/window-storage.service";
import { SyncService } from "@vowkey/common/platform/sync";
import { SystemNotificationsService } from "@vowkey/common/platform/system-notifications/system-notifications.service";
import { UnsupportedSystemNotificationsService } from "@vowkey/common/platform/system-notifications/unsupported-system-notifications.service";
import { SendApiService } from "@vowkey/common/tools/send/services/send-api.service.abstraction";
import { InternalSendService } from "@vowkey/common/tools/send/services/send.service.abstraction";
import { CipherArchiveService } from "@vowkey/common/vault/abstractions/cipher-archive.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderApiServiceAbstraction } from "@vowkey/common/vault/abstractions/folder/folder-api.service.abstraction";
import { InternalFolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { TotpService as TotpServiceAbstraction } from "@vowkey/common/vault/abstractions/totp.service";
import { DefaultCipherArchiveService } from "@vowkey/common/vault/services/default-cipher-archive.service";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";
import { TotpService } from "@vowkey/common/vault/services/totp.service";
import {
  AnonLayoutWrapperDataService,
  CompactModeService,
  DialogService,
  ToastService,
} from "@vowkey/components";
import { GeneratorServicesModule } from "@vowkey/generator-components";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";
import {
  BiometricsService,
  BiometricStateService,
  DefaultKeyService,
  KdfConfigService,
  KeyService,
} from "@vowkey/key-management";
import {
  LockComponentService,
  WebAuthnPrfUnlockService,
  DefaultWebAuthnPrfUnlockService,
  SessionTimeoutSettingsComponentService,
  KeyManagementUiModule,
} from "@vowkey/key-management-ui";
// eslint-disable-next-line no-restricted-imports
import {
  CryptoFunctionService,
  DefaultLegacyCompatKeyService,
  EncryptService,
  KeyGenerationService,
  LegacyCompatKeyService,
  WebCryptoFunctionService,
} from "@vowkey/legacy-crypto";
import { FlightRecorderLogRecorderService } from "@vowkey/logging-angular";
import { DerivedStateProvider, GlobalStateProvider, StateProvider } from "@vowkey/state";
import { InlineDerivedStateProvider } from "@vowkey/state-internal";
import { SHARE_ITEM_PRESENTER, SHARE_PASSWORD_REPROMPT } from "@vowkey/tools-share";
import {
  AutoUnlockService,
  ForegroundLockService,
  LockService,
  UnlockService,
} from "@vowkey/unlock";
import {
  DefaultSshImportPromptService,
  DefaultVaultNavService,
  PasswordRepromptService,
  SshImportPromptService,
  VAULT_BASE_ROUTE,
  VaultNavService,
} from "@vowkey/vault";

import { AccountSwitcherService } from "../../auth/popup/account-switching/services/account-switcher.service";
import { ExtensionChangePasswordService } from "../../auth/popup/change-password/extension-change-password.service";
import { ExtensionLoginComponentService } from "../../auth/popup/login/extension-login-component.service";
import { ExtensionLoginViaWebAuthnComponentService } from "../../auth/popup/login/extension-login-via-webauthn-component.service";
import { ExtensionSsoComponentService } from "../../auth/popup/login/extension-sso-component.service";
import { ExtensionLogoutService } from "../../auth/popup/logout/extension-logout.service";
import { ExtensionDeviceManagementComponentService } from "../../auth/services/extension-device-management-component.service";
import { ExtensionTwoFactorAuthComponentService } from "../../auth/services/extension-two-factor-auth-component.service";
import { ExtensionTwoFactorAuthDuoComponentService } from "../../auth/services/extension-two-factor-auth-duo-component.service";
import { ExtensionTwoFactorAuthWebAuthnComponentService } from "../../auth/services/extension-two-factor-auth-webauthn-component.service";
import { AutofillLifecycleService } from "../../autofill/services/abstractions/autofill-lifecycle.service";
import { AutofillService as AutofillServiceAbstraction } from "../../autofill/services/abstractions/autofill.service";
import { configureAutofillDetailEngine } from "../../autofill/services/autofill-detail-engine";
import AutofillService from "../../autofill/services/autofill.service";
import { BrowserAutofillSettingsService } from "../../autofill/services/browser-autofill-settings.service";
import { BrowserDomainSettingsService } from "../../autofill/services/browser-domain-settings.service";
import { InlineMenuFieldQualificationService } from "../../autofill/services/inline-menu-field-qualification.service";
import { NoopAutofillLifecycleService } from "../../autofill/services/noop-autofill-lifecycle.service";
import { WebmapperDraftService } from "../../autofill/services/webmapper-draft.service";
import { ForegroundEventUploadService } from "../../dirt/event-logs/foreground-event-upload.service";
import { ForegroundBrowserBiometricsService } from "../../key-management/biometrics/foreground-browser-biometrics";
import { ExtensionLockComponentService } from "../../key-management/lock/services/extension-lock-component.service";
import { BrowserSessionTimeoutSettingsComponentService } from "../../key-management/session-timeout/services/browser-session-timeout-settings-component.service";
import { BrowserSessionTimeoutTypeService } from "../../key-management/session-timeout/services/browser-session-timeout-type.service";
import { ForegroundUnlockService } from "../../key-management/unlock/foreground-unlock.service";
import { ForegroundVaultTimeoutService } from "../../key-management/vault-timeout/foreground-vault-timeout.service";
import { BrowserActionsService } from "../../platform/actions/browser-actions.service";
import { BrowserApi } from "../../platform/browser/browser-api";
import { runInsideAngular } from "../../platform/browser/run-inside-angular.operator";
/* eslint-disable no-restricted-imports */
import { ZonedMessageListenerService } from "../../platform/browser/zoned-message-listener.service";
import { ChromeMessageSender } from "../../platform/messaging/chrome-message.sender";
/* eslint-enable no-restricted-imports */
import { ForegroundServerNotificationsService } from "../../platform/notifications/foreground-server-notifications.service";
import { OffscreenDocumentService } from "../../platform/offscreen-document/abstractions/offscreen-document";
import { DefaultOffscreenDocumentService } from "../../platform/offscreen-document/offscreen-document.service";
import { PopupCompactModeService } from "../../platform/popup/layout/popup-compact-mode.service";
import { BrowserFileDownloadService } from "../../platform/popup/services/browser-file-download.service";
import { PopupViewCacheService } from "../../platform/popup/view-cache/popup-view-cache.service";
import { ScriptInjectorService } from "../../platform/services/abstractions/script-injector.service";
import { BrowserEnvironmentService } from "../../platform/services/browser-environment.service";
import BrowserLocalStorageService from "../../platform/services/browser-local-storage.service";
import BrowserMemoryStorageService from "../../platform/services/browser-memory-storage.service";
import { BrowserScriptInjectorService } from "../../platform/services/browser-script-injector.service";
import I18nService from "../../platform/services/i18n.service";
import { ForegroundPlatformUtilsService } from "../../platform/services/platform-utils/foreground-platform-utils.service";
import { BrowserSdkLoadService } from "../../platform/services/sdk/browser-sdk-load.service";
import { ForegroundTaskSchedulerService } from "../../platform/services/task-scheduler/foreground-task-scheduler.service";
import { BrowserStorageServiceProvider } from "../../platform/storage/browser-storage-service.provider";
import { ForegroundMemoryStorageService } from "../../platform/storage/foreground-memory-storage.service";
import { ForegroundSyncService } from "../../platform/sync/foreground-sync.service";
import {
  BrowserSystemNotificationService,
  isNotificationsSupported,
} from "../../platform/system-notifications/browser-system-notification.service";
import { fromChromeRuntimeMessaging } from "../../platform/utils/from-chrome-runtime-messaging";
import { Fido2UserVerificationService } from "../../vault/services/fido2-user-verification.service";
import { ExtensionAnonLayoutWrapperDataService } from "../components/extension-anon-layout-wrapper/extension-anon-layout-wrapper-data.service";

import { DebounceNavigationService } from "./debounce-navigation.service";
import { InitService } from "./init.service";
import { PopupCloseWarningService } from "./popup-close-warning.service";

const OBSERVABLE_LARGE_OBJECT_MEMORY_STORAGE = new SafeInjectionToken<
  AbstractStorageService & ObservableStorageService
>("OBSERVABLE_LARGE_OBJECT_MEMORY_STORAGE");

const DISK_BACKUP_LOCAL_STORAGE = new SafeInjectionToken<
  AbstractStorageService & ObservableStorageService
>("DISK_BACKUP_LOCAL_STORAGE");

/**
 * Provider definitions used in the ngModule.
 * Add your provider definition here using the safeProvider function as a wrapper. This will give you type safety.
 * If you need help please ask for it, do NOT change the type of this array.
 */
const safeProviders: SafeProvider[] = [
  safeProvider(InitService),
  safeProvider(DebounceNavigationService),
  safeProvider(DialogService),
  safeProvider({
    provide: LocalVaultService,
    useFactory: (storage: AbstractStorageService, memory: AbstractStorageService) =>
      new LocalVaultService(
        new IndexedDbLocalVaultStore(),
        storage,
        new IndexedDbCryptoKeyProtector(memory),
      ),
    deps: [AbstractStorageService, MEMORY_STORAGE],
  }),
  safeProvider({
    provide: LOCAL_VAULT_CUSTODY,
    useFactory: (vault: LocalVaultService) => new WebLocalVaultCustody(vault),
    deps: [LocalVaultService],
  }),
  safeProvider({
    provide: LocalVaultAttachService,
    useClass: LocalVaultAttachService,
    useAngularDecorators: true,
  }),
  safeProvider({
    provide: ProductInference,
    useFactory: (
      vault: LocalVaultService,
      accounts: AccountServiceAbstraction,
      tokens: TokenService,
      environments: EnvironmentService,
    ) => {
      const inference = productInferenceFactory(vault, accounts, tokens, environments);
      configureAutofillDetailEngine({ localVaultService: vault, productInference: inference });
      return inference;
    },
    deps: [LocalVaultService, AccountServiceAbstraction, TokenService, EnvironmentService],
  }),
  safeProvider(PopupCloseWarningService),
  safeProvider(InlineMenuFieldQualificationService),
  safeProvider({
    provide: DEFAULT_VAULT_TIMEOUT,
    useValue: VaultTimeoutStringType.OnRestart,
  }),
  safeProvider({
    provide: APP_INITIALIZER as SafeInjectionToken<() => Promise<void>>,
    useFactory: (initService: InitService) => initService.init(),
    deps: [InitService],
    multi: true,
  }),
  safeProvider({
    provide: CryptoFunctionService,
    useFactory: () => new WebCryptoFunctionService(window),
    deps: [],
  }),
  safeProvider({
    provide: LogService,
    useFactory: (recorder: FlightRecorderLogRecorderService) => {
      const isDev = process.env.ENV === "development";
      return new ConsoleLogService(isDev, null, recorder);
    },
    deps: [FlightRecorderLogRecorderService],
  }),
  safeProvider({
    provide: EnvironmentService,
    useExisting: BrowserEnvironmentService,
  }),
  safeProvider({
    provide: BrowserEnvironmentService,
    useClass: BrowserEnvironmentService,
    deps: [LogService, StateProvider, AccountServiceAbstraction, ENV_ADDITIONAL_REGIONS],
  }),
  safeProvider({
    provide: I18nServiceAbstraction,
    useFactory: (globalStateProvider: GlobalStateProvider) => {
      return new I18nService(BrowserApi.getUILanguage(), globalStateProvider);
    },
    deps: [GlobalStateProvider],
  }),
  safeProvider({
    provide: ActionsService,
    useClass: BrowserActionsService,
    deps: [LogService, PlatformUtilsService],
  }),
  safeProvider({
    provide: KeyService,
    useClass: DefaultKeyService,
    deps: [
      CryptoFunctionService,
      EncryptService,
      PlatformUtilsService,
      LogService,
      StateService,
      StateProvider,
      AccountCryptographicStateService,
      BiometricsService,
    ],
  }),
  safeProvider({
    // Also attaches the ContainerService to the global scope; this provider is where both key
    // services the container needs are first available together.
    provide: LegacyCompatKeyService,
    useFactory: (
      keyGenerationService: KeyGenerationService,
      cryptoFunctionService: CryptoFunctionService,
      encryptService: EncryptService,
      logService: LogService,
      accountService: AccountServiceAbstraction,
      kdfConfigService: KdfConfigService,
      keyService: KeyService,
    ) => {
      const legacyCompatKeyService = new DefaultLegacyCompatKeyService(
        keyGenerationService,
        cryptoFunctionService,
        encryptService,
        logService,
        accountService,
        kdfConfigService,
        keyService,
      );
      new ContainerService(keyService, encryptService, legacyCompatKeyService).attachToGlobal(self);
      return legacyCompatKeyService;
    },
    deps: [
      KeyGenerationService,
      CryptoFunctionService,
      EncryptService,
      LogService,
      AccountServiceAbstraction,
      KdfConfigService,
      KeyService,
    ],
  }),
  safeProvider({
    provide: TotpServiceAbstraction,
    useClass: TotpService,
    deps: [SdkService],
  }),
  safeProvider({
    provide: OffscreenDocumentService,
    useClass: DefaultOffscreenDocumentService,
    deps: [LogService],
  }),
  safeProvider({
    provide: PlatformUtilsService,
    useFactory: (
      toastService: ToastService,
      offscreenDocumentService: OffscreenDocumentService,
    ) => {
      return new ForegroundPlatformUtilsService(
        toastService,
        (clipboardValue: string, clearMs: number) => {
          void BrowserApi.sendMessage("clearClipboard", { clipboardValue, clearMs });
        },
        window,
        offscreenDocumentService,
      );
    },
    deps: [ToastService, OffscreenDocumentService],
  }),
  safeProvider({
    provide: BiometricsService,
    useClass: ForegroundBrowserBiometricsService,
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: SyncService,
    useClass: ForegroundSyncService,
    deps: [
      TokenService,
      InternalFolderService,
      FolderApiServiceAbstraction,
      MessageSender,
      LogService,
      CipherService,
      CollectionService,
      ApiService,
      AccountServiceAbstraction,
      AuthService,
      InternalSendService,
      SendApiService,
      MessageListener,
      StateProvider,
      ConfigService,
      SdkService,
    ],
  }),
  safeProvider({
    provide: DomainSettingsService,
    useClass: BrowserDomainSettingsService,
    deps: [
      StateProvider,
      PolicyService,
      AccountService,
      ConfigService,
      EnvironmentService,
      AuthService,
    ],
  }),
  safeProvider({
    provide: WebmapperDraftService,
    useClass: WebmapperDraftService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: AbstractStorageService,
    useClass: BrowserLocalStorageService,
    deps: [LogService],
  }),
  safeProvider({
    provide: AutofillServiceAbstraction,
    useExisting: AutofillService,
  }),
  safeProvider({
    provide: ViewCacheService,
    useExisting: PopupViewCacheService,
    deps: [],
  }),
  safeProvider({
    provide: AutofillLifecycleService,
    useClass: NoopAutofillLifecycleService,
    deps: [LogService],
  }),
  safeProvider({
    provide: AutofillService,
    deps: [
      CipherService,
      AutofillSettingsServiceAbstraction,
      TotpServiceAbstraction,
      EventCollectionServiceAbstraction,
      LogService,
      DomainSettingsService,
      UserVerificationService,
      BillingAccountProfileStateService,
      ScriptInjectorService,
      AccountServiceAbstraction,
      AuthService,
      UserNotificationSettingsServiceAbstraction,
      MessageListener,
      AnimationControlService,
      AutofillLifecycleService,
      LocalVaultService,
    ],
  }),
  safeProvider({
    provide: ScriptInjectorService,
    useClass: BrowserScriptInjectorService,
    deps: [DomainSettingsService, PlatformUtilsService, LogService],
  }),
  safeProvider({
    provide: VaultTimeoutService,
    useClass: ForegroundVaultTimeoutService,
    deps: [MessagingServiceAbstraction],
  }),
  safeProvider({
    provide: SECURE_STORAGE,
    useExisting: AbstractStorageService, // Secure storage is not available in the browser, so we use normal storage instead and warn users when it is used.
  }),
  safeProvider({
    provide: MEMORY_STORAGE,
    useFactory: (memoryStorage: AbstractStorageService) => memoryStorage,
    deps: [OBSERVABLE_MEMORY_STORAGE],
  }),
  safeProvider({
    provide: OBSERVABLE_MEMORY_STORAGE,
    useFactory: () => {
      if (BrowserApi.isManifestVersion(2)) {
        return new ForegroundMemoryStorageService();
      }

      return new BrowserMemoryStorageService();
    },
    deps: [],
  }),
  safeProvider({
    provide: OBSERVABLE_LARGE_OBJECT_MEMORY_STORAGE,
    useFactory: (
      regularMemoryStorageService: AbstractStorageService & ObservableStorageService,
    ) => {
      if (BrowserApi.isManifestVersion(2)) {
        return regularMemoryStorageService;
      }

      return new ForegroundMemoryStorageService();
    },
    deps: [OBSERVABLE_MEMORY_STORAGE],
  }),
  safeProvider({
    provide: OBSERVABLE_DISK_STORAGE,
    useExisting: AbstractStorageService,
  }),
  safeProvider({
    provide: FileDownloadService,
    useClass: BrowserFileDownloadService,
    deps: [],
  }),
  safeProvider({
    provide: SYSTEM_THEME_OBSERVABLE,
    useFactory: (platformUtilsService: PlatformUtilsService) => {
      // Safari doesn't properly handle the (prefers-color-scheme) media query in the popup window, it always returns light.
      // This means we have to use the background page instead, which comes with limitations like not dynamically
      // changing the extension theme when the system theme is changed. We also have issues with memory leaks when
      // holding the reference to the background page.
      const backgroundWindow = BrowserApi.getBackgroundPage();
      if (platformUtilsService.isSafari() && backgroundWindow) {
        return of(AngularThemingService.getSystemThemeFromWindow(backgroundWindow));
      } else {
        return AngularThemingService.createSystemThemeFromWindow(window);
      }
    },
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: DerivedStateProvider,
    useClass: InlineDerivedStateProvider,
    deps: [],
  }),
  safeProvider({
    provide: AuthRequestAnsweringService,
    useClass: ExtensionAuthRequestAnsweringService,
    deps: [
      AccountServiceAbstraction,
      AuthService,
      MasterPasswordServiceAbstraction,
      MessagingService,
      PendingAuthRequestsStateService,
      ActionsService,
      I18nServiceAbstraction,
      PlatformUtilsService,
      SystemNotificationsService,
      LogService,
    ],
  }),
  safeProvider({
    provide: AutofillSettingsServiceAbstraction,
    useClass: BrowserAutofillSettingsService,
    deps: [StateProvider, PolicyService, AccountService, RestrictedItemTypesService, ConfigService],
  }),
  safeProvider({
    provide: UserNotificationSettingsServiceAbstraction,
    useClass: UserNotificationSettingsService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: SharedUnlockSettingsService,
    useClass: DefaultSharedUnlockSettingsService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: PhishingDetectionSettingsServiceAbstraction,
    useClass: PhishingDetectionSettingsService,
    deps: [
      AccountService,
      BillingAccountProfileStateService,
      ConfigService,
      LogService,
      OrganizationService,
      PlatformUtilsService,
      StateProvider,
    ],
  }),
  safeProvider({
    provide: MessageListener,
    useFactory: (subject: Subject<Message<Record<string, unknown>>>, ngZone: NgZone) =>
      new MessageListener(
        merge(
          subject.asObservable(), // For messages in the same context
          fromChromeRuntimeMessaging().pipe(runInsideAngular(ngZone)), // For messages in the same context
        ),
      ),
    deps: [INTRAPROCESS_MESSAGING_SUBJECT, NgZone],
  }),
  safeProvider({
    provide: MessageSender,
    useFactory: (subject: Subject<Message<Record<string, unknown>>>, logService: LogService) =>
      MessageSender.combine(
        new SubjectMessageSender(subject), // For sending messages in the same context
        new ChromeMessageSender(logService), // For sending messages to different contexts
      ),
    deps: [INTRAPROCESS_MESSAGING_SUBJECT, LogService],
  }),
  safeProvider({
    provide: INTRAPROCESS_MESSAGING_SUBJECT,
    useFactory: () => new Subject<Message<Record<string, unknown>>>(),
    deps: [],
  }),
  safeProvider({
    provide: DISK_BACKUP_LOCAL_STORAGE,
    useFactory: (diskStorage: AbstractStorageService & ObservableStorageService) =>
      new PrimarySecondaryStorageService(diskStorage, new WindowStorageService(self.localStorage)),
    deps: [OBSERVABLE_DISK_STORAGE],
  }),
  safeProvider({
    provide: StorageServiceProvider,
    useClass: BrowserStorageServiceProvider,
    deps: [
      OBSERVABLE_DISK_STORAGE,
      OBSERVABLE_MEMORY_STORAGE,
      OBSERVABLE_LARGE_OBJECT_MEMORY_STORAGE,
      DISK_BACKUP_LOCAL_STORAGE,
    ],
  }),
  safeProvider({
    provide: CLIENT_TYPE,
    useValue: ClientType.Browser,
  }),
  safeProvider({
    provide: LockComponentService,
    useClass: ExtensionLockComponentService,
    deps: [
      UserDecryptionOptionsServiceAbstraction,
      BiometricsService,
      PinServiceAbstraction,
      BiometricStateService,
      BrowserRouterService,
      WebAuthnPrfUnlockService,
      SharedUnlockSettingsService,
      ConfigService,
    ],
  }),
  // TODO: PM-18182 - Refactor component services into lazy loaded modules
  safeProvider({
    provide: TwoFactorAuthComponentService,
    useClass: ExtensionTwoFactorAuthComponentService,
    deps: [WINDOW],
  }),
  safeProvider({
    provide: TwoFactorAuthWebAuthnComponentService,
    useClass: ExtensionTwoFactorAuthWebAuthnComponentService,
    deps: [],
  }),
  safeProvider({
    provide: TwoFactorAuthDuoComponentService,
    useClass: ExtensionTwoFactorAuthDuoComponentService,
    deps: [
      ZonedMessageListenerService,
      EnvironmentService,
      I18nServiceAbstraction,
      PlatformUtilsService,
      LogService,
    ],
  }),
  safeProvider({
    provide: ActionsService,
    useClass: BrowserActionsService,
    deps: [LogService, PlatformUtilsService],
  }),
  safeProvider({
    provide: SystemNotificationsService,
    useFactory: (platformUtilsService: PlatformUtilsService) => {
      if (isNotificationsSupported()) {
        return new BrowserSystemNotificationService(platformUtilsService);
      }

      return new UnsupportedSystemNotificationsService();
    },
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: Fido2UserVerificationService,
    useClass: Fido2UserVerificationService,
    deps: [
      PasswordRepromptService,
      UserDecryptionOptionsServiceAbstraction,
      DialogService,
      AccountServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: WebAuthnPrfUnlockService,
    useClass: DefaultWebAuthnPrfUnlockService,
    deps: [
      WebAuthnLoginPrfKeyServiceAbstraction,
      StateProvider,
      EncryptService,
      EnvironmentService,
      PlatformUtilsService,
      WINDOW,
      LogService,
    ],
  }),
  safeProvider({
    provide: ForegroundUnlockService,
    useClass: ForegroundUnlockService,
    deps: [
      RegisterSdkService,
      AccountCryptographicStateService,
      KdfConfigService,
      AccountServiceAbstraction,
      InternalMasterPasswordServiceAbstraction,
      StateProvider,
      LogService,
      BiometricsService,
      BiometricStateService,
      V2UpgradeTokenStateService,
      AutoUnlockService,
      MessageSender,
      MessageListener,
    ],
  }),
  safeProvider({
    provide: UnlockService,
    useExisting: ForegroundUnlockService,
  }),
  safeProvider({
    provide: AnimationControlService,
    useClass: DefaultAnimationControlService,
    deps: [GlobalStateProvider],
  }),
  safeProvider({
    provide: TaskSchedulerService,
    useExisting: ForegroundTaskSchedulerService,
  }),
  safeProvider({
    provide: ForegroundTaskSchedulerService,
    useClass: ForegroundTaskSchedulerService,
    deps: [LogService, StateProvider],
  }),
  safeProvider({
    provide: EventUploadServiceAbstraction,
    useClass: ForegroundEventUploadService,
    deps: [],
  }),
  safeProvider({
    provide: AnonLayoutWrapperDataService,
    useExisting: ExtensionAnonLayoutWrapperDataService,
    deps: [],
  }),
  safeProvider({
    provide: SsoUrlService,
    useClass: SsoUrlService,
    deps: [],
  }),
  safeProvider({
    provide: LoginComponentService,
    useClass: ExtensionLoginComponentService,
    deps: [
      CryptoFunctionService,
      EnvironmentService,
      PasswordGenerationServiceAbstraction,
      PlatformUtilsService,
      SsoLoginServiceAbstraction,
      ExtensionAnonLayoutWrapperDataService,
      SsoUrlService,
    ],
  }),
  safeProvider({
    provide: LoginViaWebAuthnComponentService,
    useClass: ExtensionLoginViaWebAuthnComponentService,
    deps: [],
  }),
  safeProvider({
    provide: LockService,
    useClass: ForegroundLockService,
    deps: [MessageSender, MessageListener],
  }),
  safeProvider({
    provide: SdkLoadService,
    useClass: BrowserSdkLoadService,
    deps: [LogService],
  }),
  safeProvider({
    provide: SdkClientFactory,
    useFactory: () =>
      flagEnabled("sdk") ? new DefaultSdkClientFactory() : new NoopSdkClientFactory(),
    deps: [],
  }),
  safeProvider({
    provide: LoginEmailService,
    useClass: LoginEmailService,
    deps: [AccountService, AuthService, StateProvider],
  }),
  safeProvider({
    provide: ExtensionAnonLayoutWrapperDataService,
    useClass: ExtensionAnonLayoutWrapperDataService,
    deps: [],
  }),
  safeProvider({
    provide: LogoutService,
    useClass: ExtensionLogoutService,
    deps: [MessagingServiceAbstraction, LogService, AccountSwitcherService],
  }),
  safeProvider({
    provide: CompactModeService,
    useExisting: PopupCompactModeService,
    deps: [],
  }),
  safeProvider({
    provide: SsoComponentService,
    useClass: ExtensionSsoComponentService,
    deps: [SyncService, AuthService, EnvironmentService, I18nServiceAbstraction, LogService],
  }),
  safeProvider({
    provide: SshImportPromptService,
    useClass: DefaultSshImportPromptService,
    deps: [
      DialogService,
      ToastService,
      PlatformUtilsService,
      I18nServiceAbstraction,
      ConfigService,
      LogService,
    ],
  }),
  safeProvider({
    provide: ChangePasswordService,
    useClass: ExtensionChangePasswordService,
    deps: [
      KeyService,
      MasterPasswordApiService,
      InternalMasterPasswordServiceAbstraction,
      MasterPasswordUnlockService,
      InternalPolicyService,
      OrganizationInviteService,
      WINDOW,
    ],
  }),
  safeProvider({
    provide: ServerNotificationsService,
    useClass: ForegroundServerNotificationsService,
    deps: [LogService],
  }),
  safeProvider({
    provide: DeviceManagementComponentServiceAbstraction,
    useClass: ExtensionDeviceManagementComponentService,
    deps: [],
  }),
  safeProvider({
    provide: CipherArchiveService,
    useClass: DefaultCipherArchiveService,
    deps: [CipherService, ApiService, BillingAccountProfileStateService],
  }),
  safeProvider({
    provide: NewDeviceVerificationComponentService,
    useClass: ExtensionNewDeviceVerificationComponentService,
    deps: [],
  }),
  safeProvider({
    provide: SessionTimeoutTypeService,
    useClass: BrowserSessionTimeoutTypeService,
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: SessionTimeoutSettingsComponentService,
    useClass: BrowserSessionTimeoutSettingsComponentService,
    deps: [
      I18nServiceAbstraction,
      SessionTimeoutTypeService,
      PolicyService,
      MessagingServiceAbstraction,
    ],
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
  safeProvider({
    // Reads the account's vaults for the header switcher and for `vaultScopeGuard`.
    provide: VaultNavService,
    useClass: DefaultVaultNavService,
    deps: [],
  }),
  safeProvider({
    provide: VAULT_BASE_ROUTE as SafeInjectionToken<string>,
    useValue: "/tabs/vault",
  }),
  // Sharing and the Vault layer reach each other through tokens rather than imports, because
  // `@vowkey/tools-share` already depends on `@vowkey/vault` through `@vowkey/send-ui`
  // and importing it back would close a package cycle. The app sits above both, so it is the one
  // place the two can be introduced.
  safeProvider({
    provide: SHARE_PASSWORD_REPROMPT,
    useExisting: PasswordRepromptService,
    deps: [],
  }),
  safeProvider(BrowserShareItemPresenter),
  safeProvider({
    provide: SHARE_ITEM_PRESENTER,
    useExisting: BrowserShareItemPresenter,
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
