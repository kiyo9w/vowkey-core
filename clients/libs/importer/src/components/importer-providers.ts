// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { inject } from "@angular/core";
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { CollectionService } from "@vowkey/admin-console/common";
import { safeProvider, SafeProvider } from "@vowkey/angular/platform/utils/safe-provider";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { PolicyService } from "@vowkey/common/admin-console/abstractions/policy/policy.service.abstraction";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { KeyServiceLegacyEncryptorProvider } from "@vowkey/common/tools/cryptography/key-service-legacy-encryptor-provider";
import { LegacyEncryptorProvider } from "@vowkey/common/tools/cryptography/legacy-encryptor-provider";
import { ExtensionRegistry } from "@vowkey/common/tools/extension/extension-registry.abstraction";
import { buildExtensionRegistry } from "@vowkey/common/tools/extension/factory";
import {
  createSystemServiceProvider,
  SystemServiceProvider,
} from "@vowkey/common/tools/providers";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, KeyGenerationService } from "@vowkey/legacy-crypto";
import { StateProvider } from "@vowkey/state";
import { SafeInjectionToken } from "@vowkey/ui-common";

import {
  ImportApiService,
  ImportApiServiceAbstraction,
  ImportService,
  ImportServiceAbstraction,
} from "../services";

// FIXME: unify with `SYSTEM_SERVICE_PROVIDER` when migrating it from the generator component module
//        to a general module.
export const SYSTEM_SERVICE_PROVIDER = new SafeInjectionToken<SystemServiceProvider>(
  "SystemServices",
);

/** Import service factories */
export const ImporterProviders: SafeProvider[] = [
  safeProvider({
    provide: ImportApiServiceAbstraction,
    useClass: ImportApiService,
    deps: [ApiService],
  }),
  safeProvider({
    provide: LegacyEncryptorProvider,
    useClass: KeyServiceLegacyEncryptorProvider,
    deps: [EncryptService, KeyService, SdkService],
  }),
  safeProvider({
    provide: ExtensionRegistry,
    useFactory: () => {
      return buildExtensionRegistry();
    },
    deps: [],
  }),
  safeProvider({
    provide: SYSTEM_SERVICE_PROVIDER,
    useFactory: createSystemServiceProvider,
    deps: [
      LegacyEncryptorProvider,
      StateProvider,
      PolicyService,
      ExtensionRegistry,
      LogService,
      PlatformUtilsService,
      ConfigService,
    ],
  }),
  safeProvider({
    provide: ImportServiceAbstraction,
    useFactory: (
      cipherService: CipherService,
      folderService: FolderService,
      importApiService: ImportApiServiceAbstraction,
      i18nService: I18nService,
      collectionService: CollectionService,
      keyService: KeyService,
      encryptService: EncryptService,
      keyGenerationService: KeyGenerationService,
      accountService: AccountService,
      restrictedItemTypesService: RestrictedItemTypesService,
      configService: ConfigService,
      sdkService: SdkService,
    ) =>
      new ImportService(
        cipherService,
        folderService,
        importApiService,
        i18nService,
        collectionService,
        keyService,
        encryptService,
        keyGenerationService,
        accountService,
        restrictedItemTypesService,
        configService,
        sdkService,
        inject(LocalVaultService, { optional: true }),
      ),
    deps: [
      CipherService,
      FolderService,
      ImportApiServiceAbstraction,
      I18nService,
      CollectionService,
      KeyService,
      EncryptService,
      KeyGenerationService,
      AccountService,
      RestrictedItemTypesService,
      ConfigService,
      SdkService,
    ],
  }),
];
