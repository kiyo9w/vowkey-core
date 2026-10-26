// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { CollectionService } from "@vowkey/admin-console/common";
import { safeProvider, SafeProvider } from "@vowkey/angular/platform/utils/safe-provider";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, KeyGenerationService } from "@vowkey/legacy-crypto";

import {
  ImportApiServiceAbstraction,
  ImportUpgradeService,
  ImportUpgradeServiceAbstraction,
} from "../services";

import { ImporterProviders } from "./importer-providers";

/** `ImporterProviders` plus the upgraded flow's import service. Provided only by the upgraded
 *  import hosts.
 *
 *  TODO: remove once pm-35053-import-upgrade is retired */
export const ImportUpgradeProviders: SafeProvider[] = [
  ...ImporterProviders,
  safeProvider({
    provide: ImportUpgradeServiceAbstraction,
    useClass: ImportUpgradeService,
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
