import { firstValueFrom } from "rxjs";

import { KeyService } from "@vowkey/key-management";
import { PureCrypto } from "@vowkey/sdk-internal";

import { ApiService } from "../../abstractions/api.service";
import { AccountService } from "../../auth/abstractions/account.service";
import { ErrorResponse } from "../../models/response/error.response";
import { OrganizationId, UserId } from "../../types/guid";
import { CipherService } from "../abstractions/cipher.service";
import { CipherData } from "../models/data/cipher.data";
import { Cipher } from "../models/domain/cipher";
import { CipherView } from "../models/view/cipher.view";
import { migrateLegacyProfileReference, ProfileMigrationRequiredError } from "../profile/vk-meta";
import { readFieldPath } from "../reference";

import { AccountAgentRecords } from "./account-records";
import { AgentRecordProtector, AgentVaultAuthority } from "./authority";
import { ReferenceFacts, referenceFacts } from "./executor";
import { readOwnerSecrets, type OwnerSecretsQuery, type OwnerSecretsResult } from "./owner-secrets";
import { AgentTargetAdapter } from "./targets";

export class AccountAgentAccess implements AgentRecordProtector {
  readonly scopeIds: string[];
  readonly coordination: AccountAgentRecords;

  constructor(
    private readonly userId: UserId,
    private readonly accounts: AccountService,
    private readonly keys: KeyService,
    private readonly ciphers: CipherService,
    private readonly api: ApiService,
    executorDeviceId: string,
  ) {
    this.scopeIds = [userId];
    this.coordination = new AccountAgentRecords(
      async (method, path, body) => {
        await this.key();
        return this.api.send(method, path, body, this.userId, true);
      }, this, {
        executorDeviceId,
        sealSource: async (cipherId, plain) => {
          await this.key();
          const response = await this.api.getCipher(cipherId);
          const cipher = new Cipher(new CipherData(response));
          const revision = response.vowkeyRevision;
          if (cipher.deletedDate != null || cipher.migrationPending || typeof revision !== "number" || !Number.isSafeInteger(revision)) {
            throw new Error("no_access");
          }
          await this.ciphers.decrypt(cipher, this.userId);
          const ciphertext = await this.withRecordKey(cipher.organizationId, (key) =>
            PureCrypto.symmetric_encrypt_string(plain, key));
          return { ciphertext, organizationId: cipher.organizationId ?? null, revision };
        },
        openSource: async (_cipherId, organizationId, ciphertext) =>
          this.withRecordKey(organizationId, (key) =>
            PureCrypto.symmetric_decrypt_string(ciphertext, key)),
      },
    );
  }

  async seal(plain: string): Promise<string> {
    return this.withRecordKey(null, (key) => PureCrypto.symmetric_encrypt_string(plain, key));
  }

  async open(ciphertext: string): Promise<string> {
    return this.withRecordKey(null, (key) => PureCrypto.symmetric_decrypt_string(ciphertext, key));
  }

  resolve = async (itemId: string, fieldPath: string): Promise<ReferenceFacts | null> => {
    const view = await this.view(itemId);
    if (view == null) {
      return null;
    }
    try {
      return referenceFacts(view, fieldPath);
    } catch (error) {
      if (!(error instanceof ProfileMigrationRequiredError) || !view.edit) {
        throw error;
      }
      const stablePath = migrateLegacyProfileReference(view, fieldPath);
      if (stablePath == null) {
        return null;
      }
      const saved = await this.ciphers.updateWithServer(view, this.userId);
      return referenceFacts(saved, stablePath);
    }
  };

  async value(itemId: string, fieldPath: string): Promise<string> {
    const view = await this.view(itemId);
    if (view == null) {
      throw new Error("no_access");
    }
    const facts = referenceFacts(view, fieldPath);
    if (facts == null || !facts.accessible || facts.draft || facts.agentRule === "never") {
      throw new Error("no_access");
    }
    return readFieldPath(view, facts.resolvePath ?? facts.fieldPath);
  }

  async secrets(query: OwnerSecretsQuery): Promise<OwnerSecretsResult> {
    await this.key();
    const result = await readOwnerSecrets(query, this.userId, (id) => this.view(id),
      async () => {
        await this.key();
        const items = await this.ciphers.getAllDecrypted(this.userId);
        await this.key();
        return items;
      });
    await this.key();
    return result;
  }

  private async key() {
    const active = await firstValueFrom(this.accounts.activeAccount$);
    if (active?.id !== this.userId) {
      throw new Error("account_changed");
    }
    const key = await firstValueFrom(this.keys.userKey$(this.userId));
    if (key == null) {
      throw new Error("locked");
    }
    return key;
  }

  private async withRecordKey<T>(
    organizationId: string | null | undefined,
    operation: (key: Uint8Array) => T,
  ): Promise<T> {
    const userKey = await this.key();
    const key = organizationId == null ? userKey :
      (await firstValueFrom(this.keys.orgKeys$(this.userId)))?.[organizationId as OrganizationId];
    if (key == null) {
      throw new Error("no_access");
    }
    await this.key();
    const bytes = key.toEncoded();
    try {
      return operation(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  private async view(id: string): Promise<CipherView | null> {
    await this.key();
    const pending = await this.ciphers.getLocalCipherView(id, this.userId);
    if (pending != null) {
      await this.key();
      return pending.isDeleted ? null : pending;
    }
    let cipher: Cipher | null;
    try {
      const response = await this.api.getCipher(id);
      await this.key();
      cipher = new Cipher(new CipherData(response));
    } catch (error) {
      if (error instanceof ErrorResponse && (error.statusCode === 403 || error.statusCode === 404)) {
        return null;
      }
      if (!(error instanceof ErrorResponse) || error.statusCode !== 0) {
        throw error;
      }
      cipher = await this.ciphers.get(id, this.userId);
    }
    if (cipher == null || cipher.deletedDate != null || cipher.migrationPending) {
      return null;
    }
    const decrypted = await this.ciphers.decrypt(cipher, this.userId);
    await this.key();
    return decrypted;
  }
}

export class AccountAgentAuthority extends AccountAgentAccess implements AgentVaultAuthority {
  constructor(
    userId: UserId,
    accounts: AccountService,
    keys: KeyService,
    ciphers: CipherService,
    api: ApiService,
    readonly targets: AgentTargetAdapter,
    executorDeviceId: string,
  ) {
    super(userId, accounts, keys, ciphers, api, executorDeviceId);
  }
}
