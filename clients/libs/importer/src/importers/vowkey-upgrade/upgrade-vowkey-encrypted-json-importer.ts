// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { filter, firstValueFrom } from "rxjs";

import { Collection } from "@vowkey/common/admin-console/models/collections";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import {
  CipherWithIdExport,
  CollectionWithIdExport,
  FolderWithIdExport,
} from "@vowkey/common/models/export";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { OrgKey, UserKey } from "@vowkey/common/types/key";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { FolderView } from "@vowkey/common/vault/models/view/folder.view";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import { EncryptService, EncString } from "@vowkey/legacy-crypto";
import { UserId } from "@vowkey/user-core";
import {
  VowkeyEncryptedIndividualJsonExport,
  VowkeyEncryptedJsonExport,
  VowkeyEncryptedOrgJsonExport,
  VowkeyJsonExport,
  VowkeyPasswordProtectedFileFormat,
  isOrgEncrypted,
  isPasswordProtected,
  isUnencrypted,
} from "@vowkey/vault-export-core";

import { ImportResult } from "../../models/import-result";
import { ImportResultErrorKey, ImportUpgradeResult } from "../../models/import-upgrade-result";
import { VowkeyJsonImporter } from "../vowkey/vowkey-json-importer";
import { Importer } from "../importer";

// TODO: remove once pm-35053-import-upgrade is retired
export class UpgradeVowkeyEncryptedJsonImporter
  extends VowkeyJsonImporter
  implements Importer
{
  constructor(
    protected keyService: KeyService,
    protected encryptService: EncryptService,
    protected i18nService: I18nService,
    private cipherService: CipherService,
    private accountService: AccountService,
  ) {
    super();
  }

  async parse(data: string): Promise<ImportResult> {
    const results: VowkeyPasswordProtectedFileFormat | VowkeyJsonExport = JSON.parse(data);

    if (isPasswordProtected(results)) {
      throw new Error(
        "Data is password-protected. Use VowkeyPasswordProtectedImporter instead.",
      );
    }

    if (results == null || results.items == null) {
      const result = new ImportResult();
      result.success = false;
      return result;
    }

    if (isUnencrypted(results)) {
      return super.parse(data);
    }

    return await this.parseEncrypted(results);
  }

  private async parseEncrypted(data: VowkeyEncryptedJsonExport): Promise<ImportResult> {
    const result = new ImportUpgradeResult();
    const account = await firstValueFrom(this.accountService.activeAccount$);

    if (this.isNullOrWhitespace(data.encKeyValidation_DO_NOT_EDIT)) {
      result.success = false;
      result.errorMessage = this.i18nService.t("importEncKeyError");
      return result;
    }

    const orgKeys = await firstValueFrom(this.keyService.orgKeys$(account.id));
    let keyForDecryption: OrgKey | UserKey | null | undefined = orgKeys?.[this.organizationId];
    if (!keyForDecryption) {
      keyForDecryption = await firstValueFrom(this.keyService.userKey$(account.id));
    }

    if (!keyForDecryption) {
      result.success = false;
      result.errorMessage = this.i18nService.t("importEncKeyError");
      return result;
    }
    const encKeyValidation = new EncString(data.encKeyValidation_DO_NOT_EDIT);
    try {
      await this.encryptService.decryptString(encKeyValidation, keyForDecryption);
    } catch {
      result.success = false;
      result.errorMessage = this.i18nService.t("importEncKeyError");
      result.errorKey = ImportResultErrorKey.AccountMismatch;
      return result;
    }

    let groupingsMap: Map<string, number> | null = null;
    if (isOrgEncrypted(data)) {
      groupingsMap = await this.parseEncryptedCollections(account.id, data, result);
    } else {
      groupingsMap = await this.parseEncryptedFolders(account.id, data, result);
    }

    for (const c of data.items) {
      const cipher = CipherWithIdExport.toDomain(c);
      // reset ids in case they were set for some reason
      cipher.id = null;
      cipher.organizationId = this.organizationId;
      cipher.collectionIds = null;

      // make sure password history is limited
      if (cipher.passwordHistory != null && cipher.passwordHistory.length > 5) {
        cipher.passwordHistory = cipher.passwordHistory.slice(0, 5);
      }

      if (!this.organization && c.folderId != null && groupingsMap.has(c.folderId)) {
        result.folderRelationships.push([result.ciphers.length, groupingsMap.get(c.folderId)]);
      } else if (this.organization && c.collectionIds != null) {
        c.collectionIds.forEach((cId) => {
          if (groupingsMap.has(cId)) {
            result.collectionRelationships.push([result.ciphers.length, groupingsMap.get(cId)]);
          }
        });
      }

      const view = await this.cipherService.decrypt(cipher, account.id);
      this.cleanupCipher(view);
      result.ciphers.push(view);
    }

    result.success = true;
    return result;
  }

  private async parseEncryptedFolders(
    userId: UserId,
    data: VowkeyEncryptedIndividualJsonExport,
    importResult: ImportResult,
  ): Promise<Map<string, number>> {
    const groupingsMap = new Map<string, number>();

    if (data.folders == null) {
      return groupingsMap;
    }

    const userKey = await firstValueFrom(this.keyService.userKey$(userId));

    for (const f of data.folders) {
      let folderView: FolderView;
      const folder = FolderWithIdExport.toDomain(f);
      if (folder != null) {
        folderView = await folder.decrypt(userKey);
      }

      if (folderView != null) {
        groupingsMap.set(f.id, importResult.folders.length);
        importResult.folders.push(folderView);
      }
    }
    return groupingsMap;
  }

  private async parseEncryptedCollections(
    userId: UserId,
    data: VowkeyEncryptedOrgJsonExport,
    importResult: ImportResult,
  ): Promise<Map<string, number>> {
    const groupingsMap = new Map<string, number>();
    if (data.collections == null) {
      return groupingsMap;
    }

    const orgKeys = await firstValueFrom(
      this.keyService.orgKeys$(userId).pipe(filter((orgKeys) => orgKeys != null)),
    );

    for (const c of data.collections) {
      const collection = CollectionWithIdExport.toDomain(
        c,
        new Collection({
          id: c.id,
          name: new EncString(c.name),
          organizationId: this.organizationId,
        }),
      );

      const orgKey = orgKeys[c.organizationId];
      const collectionView = await collection.decrypt(orgKey, this.encryptService);

      if (collectionView != null) {
        groupingsMap.set(c.id, importResult.collections.length);
        importResult.collections.push(collectionView);
      }
    }
    return groupingsMap;
  }
}
