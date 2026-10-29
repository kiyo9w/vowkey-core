import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "jest-mock-extended";
import { PureCrypto } from "@vowkey/sdk-internal";
import { of } from "rxjs";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { ApiService } from "@vowkey/common/abstractions/api.service";
import { UserId } from "@vowkey/common/types/guid";
import { KeyService } from "@vowkey/key-management";
import { SymmetricCryptoKey } from "@vowkey/legacy-crypto";
import { CipherService } from "@vowkey/common/vault/services/cipher.service";
import { AccountAgentAuthority } from "@vowkey/common/vault/agent/account-authority";

import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { MemoryStorageService } from "@vowkey/common/platform/services/memory-storage.service";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { NativeLocalVaultStore } from "@vowkey/common/vault/local/node/store";
import { NativeKeyProtector, PageKeyProtector } from "@vowkey/common/vault/local/protection";
import { LocalVaultMigration, MigrationHttpError, MigrationTransport } from "@vowkey/common/vault/local/migration";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";

class NodeSdkLoadService extends SdkLoadService {
  protected async load(): Promise<void> {}
}

describe("local vault on disk", () => {
  let directory: string;
  let smallState: MemoryStorageService;
  let vault: LocalVaultService;

  beforeAll(async () => { await new NodeSdkLoadService().loadAndInit(); });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vowkey-local-vault-"));
    smallState = new MemoryStorageService();
    vault = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, new PageKeyProtector());
  });
  afterEach(async () => {
    await vault.lock();
    await rm(directory, { recursive: true, force: true });
  });

  it("saves and reads an encrypted item and attachment without an account or password", async () => {
    const item = new CipherView();
    item.type = CipherType.SecureNote;
    item.name = "Private laboratory record";
    item.notes = "The instrument code is blue-orchid-37";
    const contents = new TextEncoder().encode("Original laboratory document");
    const saved = await vault.save(item, [{
      id: "original", fileName: "laboratory.txt", bytes: contents,
    }]);
    expect(saved.id).not.toBe("");
    expect(saved.edit).toBe(true);
    expect((await vault.list())[0].edit).toBe(true);
    expect((await vault.list())[0].notes).toBe(item.notes);
    expect(await vault.attachment("original")).toEqual(contents);
    expect(await vault.afterFillOffer()).toEqual({ show: false, canSetPassword: true, hasPassword: false });
    for (const file of await readdir(directory)) {
      const disk = (await readFile(join(directory, file))).toString("utf8");
      expect(disk).not.toContain(item.name);
      expect(disk).not.toContain(item.notes);
      expect(disk).not.toContain("Original laboratory document");
    }
    await vault.lock();
    await expect(vault.list()).rejects.toThrow("locked");
  });

  it("recovers a protected web vault after page-key loss and refuses the wrong password", async () => {
    const item = new CipherView();
    item.name = "Saved before signup";
    item.notes = "A local secret";
    await vault.save(item);
    await vault.setPassword("a local recovery phrase");
    await vault.lock();
    vault = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, new PageKeyProtector());
    await vault.initialize();
    expect(vault.state$.value).toBe("persisted-locked");
    await expect(vault.unlock("wrong recovery phrase")).rejects.toThrow();
    await expect(vault.list()).rejects.toThrow("locked");
    await vault.unlock("a local recovery phrase");
    expect((await vault.list())[0].notes).toBe(item.notes);
    await vault.markFirstFill();
    expect((await vault.afterFillOffer()).show).toBe(true);
    await vault.dismissProtectionOffer();
    expect((await vault.afterFillOffer()).show).toBe(false);
  });

  it("keeps unsupported keys usable under account protection and removes the guest protector", async () => {
    let protectedKey: Uint8Array | null = null;
    const protector = new NativeKeyProtector(
      async () => protectedKey?.slice() ?? null,
      async (value) => { protectedKey = value.slice(); },
      async () => { protectedKey?.fill(0); protectedKey = null; },
    );
    vault = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, protector);
    const item = new CipherView();
    item.type = CipherType.ApiKey; item.name = "Research endpoint";
    item.apiKey.value = "laboratory-test-key";
    const saved = await vault.save(item, [{
      id: "key-document", fileName: "key.txt", bytes: new TextEncoder().encode("Original key document"),
    }]);
    const accountKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const installationId = await vault.installationId();
    const foreignKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const foreignOperation = PureCrypto.symmetric_encrypt_string(JSON.stringify({ cipherId: "other-account-item" }), foreignKey);
    foreignKey.fill(0);
    await vault.saveOperation(`local:${installationId}`, "guest", await vault.seal(JSON.stringify({
      cipherId: saved.id, scopeId: `local:${installationId}`,
    })));
    await vault.saveOperation(installationId, "legacy-guest", await vault.seal(JSON.stringify({
      cipherId: saved.id, scopeId: installationId,
    })));
    await vault.saveOperation("account-1", "account", PureCrypto.symmetric_encrypt_string(JSON.stringify({
      cipherId: saved.id, scopeId: "account-1",
    }), accountKey));
    await vault.saveOperation("another-account", "foreign", foreignOperation);
    const transport = mock<MigrationTransport>();
    transport.createCipher.mockRejectedValue(new MigrationHttpError(400, "Invalid cipher type"));
    const migration = new LocalVaultMigration(vault, transport, {
      quiesce: (id) => vault.quiesce(id), rebind: async () => {},
    });
    try {
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached-local-pending");
      expect((await vault.list())[0].apiKey.value).toBe("laboratory-test-key");
      expect((await vault.list())[0].id).toBe(saved.id);
      for (const operation of await vault.listOperations("account-1")) {
        expect(JSON.parse(PureCrypto.symmetric_decrypt_string(operation.value, accountKey)))
          .toEqual({ cipherId: saved.id, scopeId: "account-1" });
      }
      expect((await vault.listOperations("account-1")).map((row) => row.id).sort()).toEqual(["account", "guest", "legacy-guest"]);
      expect(await vault.listOperations("another-account")).toEqual([{ id: "foreign", value: foreignOperation }]);
      const ciphers = new CipherService(mock(), mock(), mock(), mock(), mock(), mock(), mock(),
        mock(), mock(), mock(), mock(), mock(), mock(), mock(), mock(), vault);
      const accounts = mock<AccountService>();
      accounts.activeAccount$ = of({
        id: "account-1" as UserId, email: "lab@example.test", emailVerified: true, name: undefined, creationDate: undefined,
      });
      const keys = mock<KeyService>();
      keys.userKey$.mockReturnValue(of(new SymmetricCryptoKey(accountKey)));
      const api = mock<ApiService>();
      const authority = new AccountAgentAuthority("account-1" as UserId, accounts, keys, ciphers, api, {
        collect: async () => [], write: async () => ({ entries: [] }),
      }, crypto.randomUUID());
      expect(await authority.value(saved.id, "key.value")).toBe("laboratory-test-key");
      expect(api.getCipher).not.toHaveBeenCalled();
      expect(protectedKey).toBeNull();
      await vault.lock();
      await expect(vault.unlock()).rejects.toThrow("Unlock the account");
      await vault.unlockWithAccount("account-1", accountKey);
      expect((await vault.list())[0].apiKey.value).toBe("laboratory-test-key");
      expect(protectedKey).toBeNull();
      transport.createCipher.mockRejectedValueOnce(new Error("Network unavailable"));
      await expect(migration.attach("account-1", accountKey, "existing-account")).rejects.toThrow("Network unavailable");
      expect(vault.state$.value).toBe("attached-local-pending");
      const offlineEdit = (await vault.list())[0];
      offlineEdit.name = "Edited offline";
      await vault.save(offlineEdit);
      expect((await vault.list())[0].name).toBe("Edited offline");
      const folderId = crypto.randomUUID();
      await ciphers.moveManyWithServer([saved.id], folderId, "account-1" as UserId);
      expect((await ciphers.getLocalCipherView(saved.id, "account-1" as UserId))?.folderId).toBe(folderId);
      await ciphers.softDeleteManyWithServer([saved.id], "account-1" as UserId);
      expect(await vault.list()).toEqual([]);
      transport.createCipher.mockClear();
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached-local-pending");
      expect(transport.createCipher).toHaveBeenCalledTimes(1);
      expect((await ciphers.getLocalCipherView(saved.id, "account-1" as UserId))?.deletedDate).toBeDefined();
      await ciphers.restoreManyWithServer([saved.id], "account-1" as UserId);
      expect((await vault.list())[0].apiKey.value).toBe("laboratory-test-key");
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached-local-pending");
      expect(transport.createCipher).toHaveBeenCalledTimes(2);
      await ciphers.deleteManyWithServer([saved.id], "account-1" as UserId);
      expect(await vault.store.list("attachments")).toEqual([]);
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached");
      expect(transport.createCipher).toHaveBeenCalledTimes(2);
      expect(await vault.store.list("ciphers")).toEqual([]);
    } finally { accountKey.fill(0); }
  });

  it("retains pre-signup trash and its form binding without publishing a live item", async () => {
    const item = new CipherView();
    item.type = CipherType.Identity; item.name = "Deleted local profile";
    item.deletedDate = new Date();
    const saved = await vault.save(item);
    await vault.store.commit([{ store: "formBindings", id: "saved-form", value: await vault.seal(JSON.stringify({
      profileCipherId: saved.id, sectionId: "applicant",
    })) }]);
    const transport = mock<MigrationTransport>();
    const accountKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    try {
      const migration = new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      });
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached-local-pending");
      expect(transport.createCipher).not.toHaveBeenCalled();
      expect(transport.putFormBinding).not.toHaveBeenCalled();
      const stored = await vault.store.get<string>("formBindings", "saved-form");
      expect(JSON.parse(PureCrypto.symmetric_decrypt_string(stored!, accountKey)).profileCipherId).toBe(saved.id);
      await vault.removePending("account-1", saved.id);
      expect(await vault.store.list("formBindings")).toEqual([]);
      expect(await migration.attach("account-1", accountKey, "existing-account")).toBe("attached");
    } finally { accountKey.fill(0); }
  });

  it("rewraps account-retained local rows so the replacement key unlocks after restart", async () => {
    const item = new CipherView();
    item.type = CipherType.BankAccount;
    item.name = "Cooperative settlement account";
    item.bankAccount.accountNumber = "403927106";
    const saved = await vault.save(item, [{
      id: "statement", fileName: "statement.txt",
      bytes: new TextEncoder().encode("Original cooperative statement"),
    }]);
    const accountKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const nextKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const foreignKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const foreign = PureCrypto.symmetric_encrypt_string("other-account", foreignKey);
    foreignKey.fill(0);
    try {
      const transport = mock<MigrationTransport>();
      transport.createCipher.mockRejectedValue(new MigrationHttpError(400, "Invalid cipher type"));
      await new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      }).attach("account-1", accountKey, "existing-account");
      await vault.saveOperation("account-1", "local", PureCrypto.symmetric_encrypt_string("kept", accountKey));
      await vault.saveOperation("other-account", "foreign", foreign);
      await vault.rotateAccountKey("account-1", accountKey, nextKey);
      await expect(new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      }).attach("account-1", accountKey, "existing-account")).rejects.toThrow("Finish the account key rotation");
      await vault.lock();
      const restarted = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, new PageKeyProtector());
      await restarted.unlockWithAccount("account-1", accountKey);
      expect((await restarted.list())[0].bankAccount.accountNumber).toBe("403927106");
      await restarted.lock();
      await restarted.unlockWithAccount("account-1", nextKey);
      expect((await restarted.list())[0].bankAccount.accountNumber).toBe("403927106");
      expect(await restarted.attachment(saved.attachments[0].id)).toEqual(
        new TextEncoder().encode("Original cooperative statement"),
      );
      expect(PureCrypto.symmetric_decrypt_string(
        (await restarted.listOperations("account-1"))[0].value, nextKey,
      )).toBe("kept");
      expect(await restarted.listOperations("other-account")).toEqual([{ id: "foreign", value: foreign }]);
      vault = restarted;
    } finally {
      accountKey.fill(0);
      nextKey.fill(0);
    }
  });

  it("recovers an interrupted account rotation with either key and leaves another account untouched", async () => {
    const item = new CipherView();
    item.type = CipherType.BankAccount;
    item.name = "Interrupted settlement account";
    item.bankAccount.accountNumber = "880144203";
    const saved = await vault.save(item, [{
      id: "statement", fileName: "statement.txt",
      bytes: new TextEncoder().encode("Interrupted cooperative statement"),
    }]);
    const accountKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const nextKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    const wrongKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    try {
      const transport = mock<MigrationTransport>();
      transport.createCipher.mockRejectedValue(new MigrationHttpError(400, "Invalid cipher type"));
      await new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      }).attach("account-1", accountKey, "existing-account");
      const intent = {
        v: 1, source: PureCrypto.symmetric_encrypt_string("handoff", accountKey),
      };
      await vault.saveOperation("account-1", "local", PureCrypto.symmetric_encrypt_string("kept", accountKey));
      await vault.store.commit([{ store: "migrations", id: "migration-1:web-custody", value: intent }]);
      const failing = Object.create(smallState) as MemoryStorageService;
      let interruptMetadata = false;
      failing.save = async (...args) => {
        if (interruptMetadata) { throw new Error("metadata interrupted"); }
        await smallState.save(...args);
      };
      const interrupted = new LocalVaultService(new NativeLocalVaultStore(directory), failing, new PageKeyProtector());
      await interrupted.unlockWithAccount("account-1", accountKey);
      await interrupted.rotateAccountKey("account-1", accountKey, nextKey);
      interruptMetadata = true;
      await expect(interrupted.completeAccountKeyRotation("account-1", accountKey, nextKey)).rejects.toThrow("metadata interrupted");
      await interrupted.lock();
      const oldSession = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, new PageKeyProtector());
      await oldSession.unlockWithAccount("account-1", accountKey);
      expect((await oldSession.list())[0].bankAccount.accountNumber).toBe("880144203");
      expect(oldSession.state$.value).toBe("migrating");
      await oldSession.lock();
      const resumed = new LocalVaultService(new NativeLocalVaultStore(directory), smallState, new PageKeyProtector());
      await resumed.unlockWithAccount("account-1", nextKey);
      expect((await resumed.list())[0].bankAccount.accountNumber).toBe("880144203");
      expect(await resumed.attachment(saved.attachments[0].id)).toEqual(
        new TextEncoder().encode("Interrupted cooperative statement"),
      );
      const stored = await resumed.store.get<typeof intent>("migrations", "migration-1:web-custody");
      expect(PureCrypto.symmetric_decrypt_string(stored!.source, nextKey)).toBe("handoff");
      expect(PureCrypto.symmetric_decrypt_string(
        (await resumed.listOperations("account-1"))[0].value, nextKey,
      )).toBe("kept");
      await expect(resumed.unlockWithAccount("other-account", wrongKey)).rejects.toThrow();
      expect((await resumed.protectionMetadata())?.cutover).toBeUndefined();
      vault = resumed;
    } finally {
      accountKey.fill(0);
      nextKey.fill(0);
      wrongKey.fill(0);
    }
  });
});
