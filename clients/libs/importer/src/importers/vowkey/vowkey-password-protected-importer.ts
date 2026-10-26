// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { KeyService } from "@vowkey/key-management";
// eslint-disable-next-line no-restricted-imports
import {
  EncryptService,
  EncString,
  KdfConfig,
  KeyGenerationService,
  SymmetricCryptoKey,
} from "@vowkey/legacy-crypto";
import {
  VowkeyJsonExport,
  VowkeyPasswordProtectedFileFormat,
  isPasswordProtected,
} from "@vowkey/vault-export-core";

import { ImportResult } from "../../models/import-result";
import { Importer } from "../importer";

import { VowkeyEncryptedJsonImporter } from "./vowkey-encrypted-json-importer";
import { kdfConfigFromPasswordProtectedExport } from "./password-protected-kdf-config";

export class VowkeyPasswordProtectedImporter
  extends VowkeyEncryptedJsonImporter
  implements Importer
{
  private key: SymmetricCryptoKey;

  constructor(
    keyService: KeyService,
    encryptService: EncryptService,
    i18nService: I18nService,
    cipherService: CipherService,
    private keyGenerationService: KeyGenerationService,
    accountService: AccountService,
    private promptForPassword_callback: () => Promise<string>,
  ) {
    super(keyService, encryptService, i18nService, cipherService, accountService);
  }

  async parse(data: string): Promise<ImportResult> {
    const result = new ImportResult();
    const parsedData: VowkeyPasswordProtectedFileFormat | VowkeyJsonExport = JSON.parse(data);

    if (!parsedData) {
      result.success = false;
      return result;
    }

    if (!isPasswordProtected(parsedData)) {
      return await super.parse(data);
    }

    if (this.cannotParseFile(parsedData)) {
      result.success = false;
      return result;
    }

    // Bound the attacker-controlled KDF parameters before any key derivation allocates for them.
    const kdfConfig = kdfConfigFromPasswordProtectedExport(parsedData);
    if (kdfConfig == null) {
      result.success = false;
      result.errorMessage = this.i18nService.t("importUnsupportedKdfSettings");
      return result;
    }

    // File is password-protected
    const password = await this.promptForPassword_callback();
    if (!(await this.checkPassword(parsedData, password, kdfConfig))) {
      result.success = false;
      result.errorMessage = this.i18nService.t("invalidFilePassword");
      return result;
    }

    const encData = new EncString(parsedData.data);
    const clearTextData = await this.encryptService.decryptString(encData, this.key);
    return await super.parse(clearTextData);
  }

  private async checkPassword(
    jdoc: VowkeyPasswordProtectedFileFormat,
    password: string,
    kdfConfig: KdfConfig,
  ): Promise<boolean> {
    if (this.isNullOrWhitespace(password)) {
      return false;
    }

    this.key = await this.keyGenerationService.deriveVaultExportKey(password, jdoc.salt, kdfConfig);

    const encKeyValidation = new EncString(jdoc.encKeyValidation_DO_NOT_EDIT);

    try {
      await this.encryptService.decryptString(encKeyValidation, this.key);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Checks the fields that are not KDF parameters; those are validated by
   * {@link kdfConfigFromPasswordProtectedExport}.
   */
  private cannotParseFile(jdoc: VowkeyPasswordProtectedFileFormat): boolean {
    return (
      !jdoc ||
      !jdoc.encrypted ||
      !jdoc.passwordProtected ||
      !jdoc.salt ||
      !jdoc.encKeyValidation_DO_NOT_EDIT ||
      !jdoc.data
    );
  }
}
