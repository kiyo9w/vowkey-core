// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
// This import has been flagged as unallowed for this class. It may be involved in a circular dependency loop.
// eslint-disable-next-line no-restricted-imports
import { CollectionService } from "@vowkey/admin-console/common";
import { CollectionView } from "@vowkey/common/admin-console/models/collections";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ConfigService } from "@vowkey/common/platform/abstractions/config/config.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { SdkService } from "@vowkey/common/platform/abstractions/sdk/sdk.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { OrganizationId } from "@vowkey/common/types/guid";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderService } from "@vowkey/common/vault/abstractions/folder/folder.service.abstraction";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { RestrictedItemTypesService } from "@vowkey/common/vault/services/restricted-item-types.service";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, KeyGenerationService } from "@vowkey/legacy-crypto";

import { UpgradeVowkeyPasswordProtectedImporter } from "../importers/vowkey-upgrade/upgrade-vowkey-password-protected-importer";
import { Importer } from "../importers/importer";
import { ImportOption, ImportType, importOptionsById } from "../models/import-options";
import { ImportResult } from "../models/import-result";
import { importUpgradeOptionsById, UpgradeImportType } from "../models/import-upgrade-options";
import { ImportResultError, ImportUpgradeResult } from "../models/import-upgrade-result";

import { ImportApiServiceAbstraction } from "./import-api.service.abstraction";
import { ImportUpgradeServiceAbstraction } from "./import-upgrade.service.abstraction";
import { ImportService } from "./import.service";

const isImportType = (id: string): id is ImportType =>
  Object.prototype.hasOwnProperty.call(importOptionsById, id);

/** `ImportService` for the upgraded import flow: reads the upgrade options table, uses importers
 *  that report a failure key, and throws errors that carry it. The legacy flow keeps using
 *  `ImportService` unchanged.
 *
 *  TODO: remove once pm-35053-import-upgrade is retired */
export class ImportUpgradeService extends ImportService implements ImportUpgradeServiceAbstraction {
  private readonly vowkeyImporterDeps: {
    keyService: KeyService;
    encryptService: EncryptService;
    i18nService: I18nService;
    cipherService: CipherService;
    keyGenerationService: KeyGenerationService;
    accountService: AccountService;
  };

  constructor(
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
  ) {
    super(
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
    );
    this.vowkeyImporterDeps = {
      keyService,
      encryptService,
      i18nService,
      cipherService,
      keyGenerationService,
      accountService,
    };
  }

  override getImportOption(id: UpgradeImportType): ImportOption | undefined {
    const option = importUpgradeOptionsById[id];
    return option ? { id, ...option } : undefined;
  }

  override getImporter(
    format: UpgradeImportType | "vowkeypasswordprotected",
    promptForPassword_callback: () => Promise<string>,
    organizationId?: OrganizationId,
  ): Importer {
    if (format !== "vowkeyjson" && format !== "vowkeypasswordprotected") {
      // A picker vendor id (e.g. "keepass") has no importer of its own.
      return isImportType(format)
        ? super.getImporter(format, promptForPassword_callback, organizationId)
        : null;
    }
    if (promptForPassword_callback == null) {
      return null;
    }

    const deps = this.vowkeyImporterDeps;
    const importer = new UpgradeVowkeyPasswordProtectedImporter(
      deps.keyService,
      deps.encryptService,
      deps.i18nService,
      deps.cipherService,
      deps.keyGenerationService,
      deps.accountService,
      promptForPassword_callback,
    );
    importer.organizationId = organizationId;
    return importer;
  }

  override async importImportResult(
    importResult: ImportResult,
    organizationId: OrganizationId = null,
    selectedImportTarget: FolderView | CollectionView = null,
    canAccessImportExport: boolean = false,
  ): Promise<ImportResult> {
    if (!importResult.success && !Utils.isNullOrWhitespace(importResult.errorMessage)) {
      throw new ImportResultError(
        importResult.errorMessage,
        importResult instanceof ImportUpgradeResult ? importResult.errorKey : undefined,
      );
    }
    return super.importImportResult(
      importResult,
      organizationId,
      selectedImportTarget,
      canAccessImportExport,
    );
  }
}
