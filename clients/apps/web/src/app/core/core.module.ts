// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { APP_INITIALIZER, NgModule, Optional, SkipSelf } from "@angular/core";
import { Router } from "@angular/router";

import {
  CollectionAdminService,
  CollectionService,
  DefaultCollectionAdminService,
  DefaultOrganizationUserService,
  OrganizationUserApiService,
  OrganizationUserService,
} from "@vowkey/admin-console/common";
import { DefaultLoginViaWebAuthnComponentService } from "@vowkey/angular/auth/login-via-webauthn/default-login-via-webauthn-component.service";
import { LoginViaWebAuthnComponentService } from "@vowkey/angular/auth/login-via-webauthn/login-via-webauthn-component.service";
import { ChangePasswordService } from "@vowkey/angular/auth/password-management/change-password";
import { SetInitialPasswordService } from "@vowkey/angular/auth/password-management/set-initial-password/set-initial-password.service.abstraction";
import { PremiumInterestStateService } from "@vowkey/angular/billing/services/premium-interest/premium-interest-state.service.abstraction";
import { SafeProvider, safeProvider } from "@vowkey/angular/platform/utils/safe-provider";
import {
  CLIENT_TYPE,
  DEFAULT_VAULT_TIMEOUT,
  ENV_ADDITIONAL_REGIONS,
  LOCALES_DIRECTORY,
  MEMORY_STORAGE,
  OBSERVABLE_DISK_LOCAL_STORAGE,
  OBSERVABLE_DISK_STORAGE,
  OBSERVABLE_MEMORY_STORAGE,
  SafeInjectionToken,
  SECURE_STORAGE,
  SYSTEM_LANGUAGE,
  WINDOW,
} from "@vowkey/angular/services/injection-tokens";
import { JslibServicesModule } from "@vowkey/angular/services/jslib-services.module";
import {
  LoginComponentService,
  LoginDecryptionOptionsService,
  RegistrationFinishService as RegistrationFinishServiceAbstraction,
  SsoComponentService,
  TwoFactorAuthDuoComponentService,
} from "@vowkey/auth/angular";
import {
  InternalUserDecryptionOptionsServiceAbstraction,
  LoginEmailService,
  LogoutService,
} from "@vowkey/auth/common";
import { AutomationCapability, ProcessReloadCapability } from "@vowkey/automation-driver";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { OrganizationApiServiceAbstraction } from "@vowkey/common/admin-console/abstractions/organization/organization-api.service.abstraction";
import { OrganizationService } from "@vowkey/common/admin-console/abstractions/organization/organization.service.abstraction";
import { PolicyApiServiceAbstraction } from "@vowkey/common/admin-console/abstractions/policy/policy-api.service.abstraction";
import {
  InternalPolicyService,
  PolicyService,
} from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountApiService as AccountApiServiceAbstraction } from "@vowkey/common/auth/abstractions/account-api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthRequestAnsweringService } from "@vowkey/common/auth/abstractions/auth-request-answering/auth-request-answering.service.abstraction";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { MasterPasswordApiService } from "@vowkey/common/auth/abstractions/master-password-api.service.abstraction";
import { SsoLoginServiceAbstraction } from "@vowkey/common/auth/abstractions/sso-login.service.abstraction";
import { WebAuthnLoginPrfKeyServiceAbstraction } from "@vowkey/common/auth/abstractions/webauthn/webauthn-login-prf-key.service.abstraction";
import { DeepLinkRedirectService } from "@vowkey/common/auth/deep-link-redirect";
import {
  DefaultOrganizationInviteService,
  OrganizationInviteService,
} from "@vowkey/common/auth/organization-invite";
import { NoopAuthRequestAnsweringService } from "@vowkey/common/auth/services/auth-request-answering/noop-auth-request-answering.service";
import { ChangeEmailService } from "@vowkey/common/auth/services/change-email/change-email.service";
import { DefaultChangeEmailService } from "@vowkey/common/auth/services/change-email/default-change-email.service";
import { BillingAccountProfileStateService } from "@vowkey/common/billing/abstractions/account/billing-account-profile-state.service";
import { ClientType } from "@vowkey/common/enums";
import { AccountCryptographicStateService } from "@vowkey/common/key-management/account-cryptography/account-cryptographic-state.service";
import { MasterPasswordUnlockService } from "@vowkey/common/key-management/master-password/abstractions/master-password-unlock.service";
import {
  InternalMasterPasswordServiceAbstraction,
  MasterPasswordServiceAbstraction,
} from "@vowkey/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { ProcessReloadServiceAbstraction } from "@vowkey/common/key-management/process-reload";
import { SessionTimeoutTypeService } from "@vowkey/common/key-management/session-timeout";
import {
  DefaultSharedUnlockSettingsService,
  SharedUnlockPeerService,
  SharedUnlockSettingsService,
} from "@vowkey/common/key-management/shared-unlock";
import { DefaultSharedUnlockPeerService } from "@vowkey/common/key-management/shared-unlock/default-shared-unlock-peer.service";
import {
  VaultTimeout,
  VaultTimeoutSettingsService,
  VaultTimeoutStringType,
} from "@vowkey/common/key-management/vault-timeout";
import { AppIdService } from "@vowkey/common/platform/abstractions/app-id.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import {
  EnvironmentService,
  Urls,
} from "@vowkey/common/platform/abstractions/environment.service";
import { FileDownloadService } from "@vowkey/common/platform/abstractions/file-download/file-download.service";
import { I18nService as I18nServiceAbstraction } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { RegisterSdkService } from "@vowkey/common/platform/abstractions/sdk/register-sdk.service";
import { SdkClientFactory } from "@vowkey/common/platform/abstractions/sdk/sdk-client-factory";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { AbstractStorageService } from "@vowkey/common/platform/abstractions/storage.service";
import { SystemService } from "@vowkey/common/platform/abstractions/system.service";
import { IpcService } from "@vowkey/common/platform/ipc";
// eslint-disable-next-line no-restricted-imports -- Needed for DI
import {
  UnsupportedWebPushConnectionService,
  WebPushConnectionService,
} from "@vowkey/common/platform/server-notifications/internal";
import { AppIdService as DefaultAppIdService } from "@vowkey/common/platform/services/app-id.service";
import { MemoryStorageService } from "@vowkey/common/platform/services/memory-storage.service";
import { MigrationBuilderService } from "@vowkey/common/platform/services/migration-builder.service";
import { MigrationRunner } from "@vowkey/common/platform/services/migration-runner";
import { DefaultSdkClientFactory } from "@vowkey/common/platform/services/sdk/default-sdk-client-factory";
import { NoopSdkClientFactory } from "@vowkey/common/platform/services/sdk/noop-sdk-client-factory";
import { NoopSdkLoadService } from "@vowkey/common/platform/services/sdk/noop-sdk-load.service";
import { StorageServiceProvider } from "@vowkey/common/platform/services/storage-service.provider";
import { GlobalStateProvider, StateProvider } from "@vowkey/common/platform/state";
import { WindowStorageService } from "@vowkey/common/platform/storage/window-storage.service";
import { SyncService } from "@vowkey/common/platform/sync/sync.service";
import {
  DefaultThemeStateService,
  ThemeStateService,
} from "@vowkey/common/platform/theming/theme-state.service";
import { PremiumUpgradePromptService } from "@vowkey/common/vault/abstractions/premium-upgrade-prompt.service";
import { DialogService, ToastService } from "@vowkey/components";
import { GeneratorServicesModule } from "@vowkey/generator-components";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";
import {
  BiometricsService,
  KdfConfigService,
  KeyService as KeyServiceAbstraction,
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
  EncryptService,
  LegacyCompatKeyService,
} from "@vowkey/legacy-crypto";
import { OrganizationInviteLinkApiService } from "@vowkey/organization-invite-link";
import { SerializedMemoryStorageService } from "@vowkey/storage-core";
import {
  SHARE_ITEM_PRESENTER,
  SHARE_PASSWORD_REPROMPT,
  ShareButtonComponent,
  ShareItemDrawerPresenter,
} from "@vowkey/tools-share";
import { LockService, UnlockService } from "@vowkey/unlock";
import {
  CipherFormGenerationService,
  DefaultSshImportPromptService,
  DefaultVaultNavService,
  PasswordRepromptService,
  SHARE_ITEM_ENTRY_POINT,
  SshImportPromptService,
  VAULT_NAV_ORGANIZATION_OPTIONS,
  VaultNavService,
  VFO1_FILTERS_STEP,
  VFO1_SHARED_FOLDERS_STEP,
  VFO1_SWITCH_PRODUCTS_STEP,
  VFO1_VAULT_LIST_STEP,
  VFO1_WALKTHROUGH_STEPS,
} from "@vowkey/vault";
import { WebVaultPremiumUpgradePromptService } from "@vowkey/web-vault/app/billing/services/web-premium-upgrade-prompt.service";
import { OrganizationOptionsComponent } from "@vowkey/web-vault/app/vault/individual-vault/vault-filter/components/organization-options.component";
import { WebCipherFormGenerationService } from "@vowkey/web-vault/app/vault/services/web-cipher-form-generation.service";

import { flagEnabled } from "../../utils/flags";
import {
  ossPolicyEditRegister,
  POLICY_EDIT_REGISTER,
} from "../admin-console/organizations/policies";
import {
  LinkSsoService,
  WebChangePasswordService,
  WebDeepLinkRedirectService,
  WebLoginComponentService,
  WebLoginDecryptionOptionsService,
  WebRegistrationFinishService,
  WebSetInitialPasswordService,
  WebTwoFactorAuthDuoComponentService,
} from "../auth";
import { WebSsoComponentService } from "../auth/core/services/login/web-sso-component.service";
import { WebPremiumInterestStateService } from "../billing/services/premium-interest/web-premium-interest-state.service";
import { HtmlStorageService } from "../core/html-storage.service";
import { I18nService } from "../core/i18n.service";
import { WebFileDownloadService } from "../core/web-file-download.service";
import { EventService } from "../dirt/event-logs";
import { UserKeyRotationService } from "../key-management/key-rotation/user-key-rotation.service";
import { WebLockComponentService } from "../key-management/lock/services/web-lock-component.service";
import { WebProcessReloadService } from "../key-management/services/web-process-reload.service";
import { WebSessionTimeoutTypeService } from "../key-management/session-timeout/services/web-session-timeout-type.service";
import { WebBiometricsService } from "../key-management/web-biometric.service";
import { WebIpcService } from "../platform/ipc/web-ipc.service";
import { WebEnvironmentService } from "../platform/web-environment.service";
import { WebMigrationRunner } from "../platform/web-migration-runner";
import { WebSdkLoadService } from "../platform/web-sdk-load.service";
import { WebStorageServiceProvider } from "../platform/web-storage-service.provider";
import { WebSystemService } from "../platform/web-system.service";

import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { TokenService } from "@vowkey/common/auth/abstractions/token.service";
import { ProductInference } from "@vowkey/common/vault/local/product-inference";
import { productInferenceFactory } from "@vowkey/angular/services/product-inference.factory";
import { IndexedDbLocalVaultStore } from "@vowkey/common/vault/local/store";
import { PageKeyProtector } from "@vowkey/common/vault/local/protection";
import { LocalVaultAttachService, LOCAL_VAULT_CUSTODY } from "@vowkey/angular/services/local-vault-attach.service";
import { WebLocalVaultCustody } from "@vowkey/angular/services/web-local-vault-custody";

import { InitService } from "./init.service";
import { ENV_URLS } from "./injection-tokens";
import { RouterService } from "./router.service";
import { WebPlatformUtilsService } from "./web-platform-utils.service";

/**
 * Provider definitions used in the ngModule.
 * Add your provider definition here using the safeProvider function as a wrapper. This will give you type safety.
 * If you need help please ask for it, do NOT change the type of this array.
 */
const safeProviders: SafeProvider[] = [
  safeProvider({
    provide: LocalVaultService,
    useFactory: (storage: AbstractStorageService) =>
      new LocalVaultService(new IndexedDbLocalVaultStore(), storage, new PageKeyProtector()),
    deps: [AbstractStorageService],
  }),
  safeProvider({ provide: LOCAL_VAULT_CUSTODY, useFactory: (vault: LocalVaultService) =>
    new WebLocalVaultCustody(vault), deps: [LocalVaultService] }),
  safeProvider({ provide: ProductInference, useFactory: productInferenceFactory,
    deps: [LocalVaultService, AccountService, TokenService, EnvironmentService] }),
  safeProvider({ provide: LocalVaultAttachService, useClass: LocalVaultAttachService,
    useAngularDecorators: true }),
  safeProvider(InitService),
  safeProvider(RouterService),
  safeProvider({
    provide: DeepLinkRedirectService,
    useClass: WebDeepLinkRedirectService,
    deps: [RouterService],
  }),
  // Web-only override of the shared noop binding. Only web has routes that
  // populate invite state or drive the accept flows; other clients use the noop.
  safeProvider({
    provide: OrganizationInviteService,
    useClass: DefaultOrganizationInviteService,
    deps: [
      ApiService,
      LogoutService,
      KeyServiceAbstraction,
      LegacyCompatKeyService,
      EncryptService,
      PolicyApiServiceAbstraction,
      InternalPolicyService,
      LogService,
      OrganizationApiServiceAbstraction,
      OrganizationUserApiService,
      OrganizationInviteLinkApiService,
      I18nServiceAbstraction,
      GlobalStateProvider,
      SdkService,
      ConfigService,
      DeepLinkRedirectService,
    ],
  }),
  safeProvider(EventService),
  safeProvider({
    provide: POLICY_EDIT_REGISTER,
    useValue: ossPolicyEditRegister,
  }),
  safeProvider({
    provide: DEFAULT_VAULT_TIMEOUT,
    deps: [PlatformUtilsService],
    useFactory: (platformUtilsService: PlatformUtilsService): VaultTimeout =>
      platformUtilsService.isDev() ? VaultTimeoutStringType.Never : 15,
  }),
  safeProvider({
    provide: APP_INITIALIZER as SafeInjectionToken<() => void>,
    useFactory: (initService: InitService) => initService.init(),
    deps: [InitService],
    multi: true,
  }),
  // Web-only automation capability.
  safeProvider({
    provide: AutomationCapability,
    useFactory: (win: Window) => new ProcessReloadCapability(() => win.location.reload()),
    deps: [WINDOW],
    multi: true,
  }),
  safeProvider({
    provide: I18nServiceAbstraction,
    useClass: I18nService,
    deps: [SYSTEM_LANGUAGE, LOCALES_DIRECTORY, GlobalStateProvider],
  }),
  safeProvider({ provide: AbstractStorageService, useClass: HtmlStorageService, deps: [] }),
  safeProvider({
    provide: SECURE_STORAGE,
    // TODO: platformUtilsService.isDev has a helper for this, but using that service here results in a circular dependency.
    // We have a tech debt item in the backlog to break up platformUtilsService, but in the meantime simply checking the environment here is less cumbersome.
    useClass: process.env.NODE_ENV === "development" ? HtmlStorageService : MemoryStorageService,
    deps: [],
  }),
  safeProvider({
    provide: MEMORY_STORAGE,
    useClass: MemoryStorageService,
    deps: [],
  }),
  safeProvider({
    provide: OBSERVABLE_MEMORY_STORAGE,
    useClass: SerializedMemoryStorageService,
    deps: [],
  }),
  safeProvider({
    provide: OBSERVABLE_DISK_STORAGE,
    useFactory: () => new WindowStorageService(window.sessionStorage),
    deps: [],
  }),
  safeProvider({
    provide: PlatformUtilsService,
    useClass: WebPlatformUtilsService,
    useAngularDecorators: true,
  }),
  safeProvider({
    provide: FileDownloadService,
    useClass: WebFileDownloadService,
    useAngularDecorators: true,
  }),
  safeProvider({
    provide: WindowStorageService,
    useFactory: () => new WindowStorageService(window.localStorage),
    deps: [],
  }),
  safeProvider({
    provide: OBSERVABLE_DISK_LOCAL_STORAGE,
    useExisting: WindowStorageService,
  }),
  safeProvider({
    provide: StorageServiceProvider,
    useClass: WebStorageServiceProvider,
    deps: [OBSERVABLE_DISK_STORAGE, OBSERVABLE_MEMORY_STORAGE, OBSERVABLE_DISK_LOCAL_STORAGE],
  }),
  safeProvider({
    provide: MigrationRunner,
    useClass: WebMigrationRunner,
    deps: [AbstractStorageService, LogService, MigrationBuilderService, WindowStorageService],
  }),
  safeProvider({
    provide: ENV_URLS,
    useValue: process.env.URLS as Urls,
  }),
  safeProvider({
    provide: EnvironmentService,
    useClass: WebEnvironmentService,
    deps: [WINDOW, StateProvider, AccountService, ENV_ADDITIONAL_REGIONS, Router, ENV_URLS],
  }),
  safeProvider({
    provide: BiometricsService,
    useClass: WebBiometricsService,
    deps: [],
  }),
  safeProvider({
    provide: ThemeStateService,
    useClass: DefaultThemeStateService,
    deps: [GlobalStateProvider],
  }),
  safeProvider({
    provide: CLIENT_TYPE,
    useValue: ClientType.Web,
  }),
  safeProvider({
    provide: RegistrationFinishServiceAbstraction,
    useClass: WebRegistrationFinishService,
    deps: [
      LegacyCompatKeyService,
      AccountApiServiceAbstraction,
      MasterPasswordServiceAbstraction,
      ConfigService,
      SdkService,
      OrganizationInviteService,
    ],
  }),
  safeProvider({
    provide: WebPushConnectionService,
    // We can support web in the future by creating a worker
    useClass: UnsupportedWebPushConnectionService,
    deps: [],
  }),
  safeProvider({
    provide: LockComponentService,
    useClass: WebLockComponentService,
    deps: [],
  }),
  safeProvider({
    provide: SetInitialPasswordService,
    useClass: WebSetInitialPasswordService,
    deps: [
      ApiService,
      EncryptService,
      I18nServiceAbstraction,
      KdfConfigService,
      KeyServiceAbstraction,
      LegacyCompatKeyService,
      MasterPasswordApiService,
      InternalMasterPasswordServiceAbstraction,
      OrganizationApiServiceAbstraction,
      OrganizationUserApiService,
      InternalUserDecryptionOptionsServiceAbstraction,
      OrganizationInviteService,
      RouterService,
      AccountCryptographicStateService,
      RegisterSdkService,
      UnlockService,
    ],
  }),
  safeProvider({
    provide: AppIdService,
    useClass: DefaultAppIdService,
    deps: [OBSERVABLE_DISK_LOCAL_STORAGE, LogService],
  }),
  safeProvider({
    provide: LoginViaWebAuthnComponentService,
    useClass: DefaultLoginViaWebAuthnComponentService,
    deps: [],
  }),
  safeProvider({
    provide: LoginComponentService,
    useClass: WebLoginComponentService,
    deps: [
      OrganizationInviteService,
      LogService,
      InternalPolicyService,
      RouterService,
      CryptoFunctionService,
      EnvironmentService,
      PasswordGenerationServiceAbstraction,
      PlatformUtilsService,
      SsoLoginServiceAbstraction,
      Router,
      ToastService,
      I18nServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: CollectionAdminService,
    useClass: DefaultCollectionAdminService,
    deps: [
      ApiService,
      KeyServiceAbstraction,
      EncryptService,
      CollectionService,
      OrganizationService,
    ],
  }),
  safeProvider({
    provide: OrganizationUserService,
    useClass: DefaultOrganizationUserService,
    deps: [
      KeyServiceAbstraction,
      EncryptService,
      OrganizationUserApiService,
      AccountService,
      I18nServiceAbstraction,
    ],
  }),
  safeProvider({
    provide: SdkLoadService,
    useClass: flagEnabled("sdk") ? WebSdkLoadService : NoopSdkLoadService,
    deps: [],
  }),
  safeProvider({
    provide: SdkClientFactory,
    useClass: flagEnabled("sdk") ? DefaultSdkClientFactory : NoopSdkClientFactory,
    deps: [],
  }),
  safeProvider({
    provide: ProcessReloadServiceAbstraction,
    useClass: WebProcessReloadService,
    deps: [WINDOW],
  }),
  safeProvider({
    provide: LoginEmailService,
    useClass: LoginEmailService,
    deps: [AccountService, AuthService, StateProvider],
  }),
  safeProvider({
    provide: SsoComponentService,
    useClass: WebSsoComponentService,
    deps: [I18nServiceAbstraction],
  }),
  safeProvider({
    provide: LinkSsoService,
    useClass: LinkSsoService,
    deps: [
      SsoLoginServiceAbstraction,
      ApiService,
      CryptoFunctionService,
      EnvironmentService,
      PasswordGenerationServiceAbstraction,
      PlatformUtilsService,
    ],
  }),
  safeProvider({
    provide: TwoFactorAuthDuoComponentService,
    useClass: WebTwoFactorAuthDuoComponentService,
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: LoginDecryptionOptionsService,
    useClass: WebLoginDecryptionOptionsService,
    deps: [RouterService, OrganizationInviteService],
  }),
  safeProvider({
    provide: IpcService,
    useClass: WebIpcService,
    deps: [],
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
      PlatformUtilsService,
      VaultTimeoutSettingsService,
      EnvironmentService,
      SharedUnlockSettingsService,
      UnlockService,
      ConfigService,
      StateProvider,
    ],
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
    useClass: WebChangePasswordService,
    deps: [
      KeyServiceAbstraction,
      MasterPasswordApiService,
      InternalMasterPasswordServiceAbstraction,
      MasterPasswordUnlockService,
      InternalPolicyService,
      OrganizationInviteService,
      SyncService,
      UserKeyRotationService,
      RouterService,
    ],
  }),
  safeProvider({
    provide: CipherFormGenerationService,
    useClass: WebCipherFormGenerationService,
    deps: [],
  }),
  safeProvider({
    provide: VaultNavService,
    useClass: DefaultVaultNavService,
    deps: [],
  }),
  safeProvider({
    provide: VAULT_NAV_ORGANIZATION_OPTIONS,
    useValue: OrganizationOptionsComponent,
  }),
  safeProvider({
    provide: PremiumUpgradePromptService,
    useClass: WebVaultPremiumUpgradePromptService,
    deps: [
      DialogService,
      AccountService,
      SyncService,
      BillingAccountProfileStateService,
      PlatformUtilsService,
      Router,
    ],
  }),
  safeProvider({
    provide: PremiumInterestStateService,
    useClass: WebPremiumInterestStateService,
    deps: [StateProvider],
  }),
  safeProvider({
    provide: SystemService,
    useClass: WebSystemService,
    deps: [],
  }),
  safeProvider({
    provide: SessionTimeoutTypeService,
    useClass: WebSessionTimeoutTypeService,
    deps: [PlatformUtilsService],
  }),
  safeProvider({
    provide: SessionTimeoutSettingsComponentService,
    useClass: SessionTimeoutSettingsComponentService,
    deps: [I18nServiceAbstraction, SessionTimeoutTypeService, PolicyService],
  }),
  safeProvider({
    provide: AuthRequestAnsweringService,
    useClass: NoopAuthRequestAnsweringService,
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
      PlatformUtilsService,
      WINDOW,
      LogService,
    ],
  }),
  safeProvider({
    provide: ChangeEmailService,
    useClass: DefaultChangeEmailService,
    deps: [
      ConfigService,
      InternalMasterPasswordServiceAbstraction,
      KdfConfigService,
      ApiService,
      KeyServiceAbstraction,
      LegacyCompatKeyService,
    ],
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
    provide: VFO1_WALKTHROUGH_STEPS,
    useValue: [
      VFO1_SWITCH_PRODUCTS_STEP,
      VFO1_VAULT_LIST_STEP,
      VFO1_SHARED_FOLDERS_STEP,
      VFO1_FILTERS_STEP,
    ],
  }),
  safeProvider({
    provide: SHARE_PASSWORD_REPROMPT,
    useExisting: PasswordRepromptService,
    deps: [],
  }),
  safeProvider({
    provide: SHARE_ITEM_PRESENTER,
    useExisting: ShareItemDrawerPresenter,
    deps: [],
  }),
];

@NgModule({
  declarations: [],
  imports: [CommonModule, JslibServicesModule, KeyManagementUiModule, GeneratorServicesModule],
  // Do not register your dependency here! Add it to the typesafeProviders array using the helper function
  providers: safeProviders,
})
export class CoreModule {
  constructor(@Optional() @SkipSelf() parentModule?: CoreModule) {
    if (parentModule) {
      throw new Error("CoreModule is already loaded. Import it in the AppModule only");
    }
  }
}
