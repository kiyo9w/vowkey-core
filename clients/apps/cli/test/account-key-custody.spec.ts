import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipcMain } from "electron";
import { mock } from "jest-mock-extended";
import { PureCrypto } from "@vowkey/sdk-internal";

import * as cliDirectory from "@vowkey/common/platform/misc/node/cli-data-directory";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { MemoryStorageService } from "@vowkey/common/platform/services/memory-storage.service";
import { AgentExecutor } from "@vowkey/common/vault/agent/executor";
import * as brokerFiles from "@vowkey/common/vault/agent/node/broker";
import { AgentVaultAuthority } from "@vowkey/common/vault/agent/authority";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { LocalVaultMigration, MigrationHttpError, MigrationTransport } from "@vowkey/common/vault/local/migration";
import { NativeLocalVaultStore } from "@vowkey/common/vault/local/node/store";
import { PageKeyProtector } from "@vowkey/common/vault/local/protection";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";

import { desktopAccountKeyCustody } from "../../desktop/src/local-vault/custody";
import { LocalVaultCustodyMain } from "../../desktop/src/local-vault/custody.main";

import { makeCoseKey } from "./crypto-keys";

jest.mock("electron", () => ({ ipcMain: { handle: jest.fn() } }));

class NodeSdkLoadService extends SdkLoadService {
  protected async load(): Promise<void> {}
}

describe("account broker key custody", () => {
  let directory: string;
  let smallState: MemoryStorageService;
  let currentKey: Uint8Array;
  let nextKey: Uint8Array;
  let vault: LocalVaultService;
  let ipcCustody: ReturnType<typeof desktopAccountKeyCustody>;
  let originalIpc: PropertyDescriptor | undefined;
  let broker: brokerFiles.AgentBroker | undefined;
  const userId = "7cf8fbca-57ed-47bf-86ac-abddfb5b73a7";

  beforeAll(async () => { await new NodeSdkLoadService().loadAndInit(); });
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "vowkey-key-custody-"));
    jest.spyOn(cliDirectory, "resolveCliDataDirectory").mockReturnValue(directory);
    const handlers = new Map<string, (...args: any[]) => unknown>();
    (ipcMain.handle as jest.Mock).mockImplementation((name, handler) => handlers.set(name, handler));
    const frame = {};
    const sender = { mainFrame: frame };
    new LocalVaultCustodyMain({ win: { webContents: sender } } as any).init();
    const invoke = (name: string, ...args: unknown[]) =>
      Promise.resolve().then(() => handlers.get(`agentCustody.${name}`)!({ sender, senderFrame: frame }, ...args));
    originalIpc = Object.getOwnPropertyDescriptor(globalThis, "ipc");
    Object.defineProperty(globalThis, "ipc", { configurable: true, value: { localVault: {
      custody: {
        quiesce: (...args: unknown[]) => invoke("quiesce", ...args),
        stage: (...args: unknown[]) => invoke("stage", ...args),
        finalize: (...args: unknown[]) => invoke("finalize", ...args),
      },
      agent: { changed: jest.fn(), ready: jest.fn() },
    } } });
    smallState = new MemoryStorageService();
    currentKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    nextKey = PureCrypto.make_user_key_aes256_cbc_hmac();
    ipcCustody = desktopAccountKeyCustody();
    vault = reopen();
  });
  afterEach(async () => {
    await broker?.stop().catch(() => undefined);
    broker = undefined;
    await vault.lock();
    currentKey.fill(0); nextKey.fill(0);
    jest.restoreAllMocks();
    if (originalIpc != null) { Object.defineProperty(globalThis, "ipc", originalIpc); }
    else { Reflect.deleteProperty(globalThis, "ipc"); }
    await rm(directory, { recursive: true, force: true });
  });

  function reopen() {
    return new LocalVaultService(new NativeLocalVaultStore(join(directory, "bulk")), smallState,
      new PageKeyProtector(), ipcCustody);
  }

  function authority(key: Uint8Array): AgentVaultAuthority {
    return {
      scopeIds: [userId],
      seal: async (value) => PureCrypto.symmetric_encrypt_string(value, key),
      open: async (value) => PureCrypto.symmetric_decrypt_string(value, key),
      resolve: async () => null, value: async () => "",
      targets: {
        collect: async () => [{ targetId: "tax.pdf", kind: "file", destinationKey: "file:tax.pdf",
          generation: "1", display: "納税証明書.pdf", sections: [], fields: [] }],
        write: async () => ({ entries: [] }),
      },
    };
  }

  async function savePairing(key = currentKey, append = false) {
    const options = {
      vaultScopeIds: [userId], protector: authority(key), resolve: async () => null,
      clock: { wall: () => Date.now(), mono: () => performance.now() },
    };
    const executor = append ? AgentExecutor.resume(JSON.parse(PureCrypto.symmetric_decrypt_string(
      fs.readFileSync(brokerFiles.agentStatePath(directory, [userId]), "utf8"), key,
    )), options) : new AgentExecutor(options);
    await executor.receive("connector", { type: "pair", displayName: "会計連携", vaultScopeId: userId });
    const paired = await executor.approve("connector");
    fs.mkdirSync(brokerFiles.agentDirectory(directory), { recursive: true });
    brokerFiles.writeOwnerFile(brokerFiles.agentStatePath(directory, [userId]),
      PureCrypto.symmetric_encrypt_string(JSON.stringify(executor.snapshot()), key));
    return paired!;
  }

  async function assertPairing(paired: Record<string, unknown>, key = nextKey) {
    broker = new brokerFiles.AgentBroker(directory, authority(key));
    await broker.start();
    const connection = await brokerFiles.AgentConnection.connect(broker.socketPath);
    try {
      connection.send({ type: "read_form", vaultScopeId: userId, pairingId: paired.pairingId,
        credential: paired.credential, targetId: "tax.pdf" });
      expect(await connection.next()).toMatchObject({ type: "form", display: "納税証明書.pdf" });
    } finally { connection.close(); }
    await broker.stop();
    broker = undefined;
  }

  async function attachLocalItem() {
    const item = new CipherView();
    item.type = CipherType.BankAccount; item.name = "民営協同組合";
    item.bankAccount.accountNumber = "00401872855";
    const bytes = new TextEncoder().encode("ដើម statement\u0000\u00ff");
    const saved = await vault.save(item, [{ id: "original", fileName: "証明.txt", bytes }]);
    const transport = mock<MigrationTransport>();
    transport.createCipher.mockRejectedValue(new MigrationHttpError(400, "Invalid cipher type"));
    await new LocalVaultMigration(vault, transport, {
      quiesce: (id) => vault.quiesce(id), rebind: async () => {},
    }).attach(userId, currentKey, "existing-account");
    return { saved, bytes };
  }

  it.each([
    ["complete", "CBC"], ["before-bulk", "CBC"], ["after-file", "CBC"], ["after-metadata", "CBC"], ["complete", "COSE"],
  ])(
    "retains the original credential and attachment after a %s %s rotation/restart", async (interruption, encryption) => {
      if (encryption === "COSE") { nextKey.fill(0); nextKey = makeCoseKey(); }
      const { saved, bytes } = await attachLocalItem();
      const paired = await savePairing();
      const foreignPath = brokerFiles.agentStatePath(directory, ["another-account"]);
      brokerFiles.writeOwnerFile(foreignPath, "foreign encrypted state");
      if (interruption === "complete" && encryption === "CBC") {
        broker = new brokerFiles.AgentBroker(directory, authority(currentKey));
        await broker.start();
      }
      await vault.rotateAccountKey(userId, currentKey, nextKey);
      await broker?.stop();
      broker = undefined;
      if (interruption === "after-file") {
        const write = brokerFiles.writeOwnerFile;
        jest.spyOn(brokerFiles, "writeOwnerFile").mockImplementationOnce((file, value) => write(file, value))
          .mockImplementationOnce(() => { throw new Error("intent interrupted"); });
      } else if (interruption === "after-metadata") {
        const commit = vault.store.commit.bind(vault.store);
        jest.spyOn(vault.store, "commit").mockImplementation(async (writes) => {
          if (writes.some((row) => row.id === "account-key-rotation" && row.value === undefined)) {
            throw new Error("cleanup interrupted");
          }
          await commit(writes);
        });
      }
      if (interruption === "complete") {
        await vault.completeAccountKeyRotation(userId, currentKey, nextKey);
      } else if (interruption !== "before-bulk") {
        await expect(vault.completeAccountKeyRotation(userId, currentKey, nextKey)).rejects.toThrow("interrupted");
      }
      jest.restoreAllMocks();
      await vault.lock();
      vault = reopen();
      await vault.unlockWithAccount(userId, nextKey);
      expect((await vault.list())[0].bankAccount.accountNumber).toBe("00401872855");
      expect(await vault.attachment(saved.attachments[0].id)).toEqual(bytes);
      expect((await vault.protectionMetadata())?.cutover).toBeUndefined();
      expect(await vault.store.list("migrations")).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "account-key-rotation" }),
      ]));
      expect(fs.readFileSync(foreignPath, "utf8")).toBe("foreign encrypted state");
      await assertPairing(paired);
    },
  );

  it.each([false, true])("recovers account-first custody while preserving foreign local metadata (%s)", async (foreignVault) => {
    nextKey.fill(0); nextKey = makeCoseKey();
    if (foreignVault) {
      await vault.ensureUnlocked();
      const foreignKey = await vault.key();
      try { await vault.finishAttach("another-account", foreignKey, false); }
      finally { foreignKey.fill(0); }
    }
    const metadata = await vault.protectionMetadata();
    const paired = await savePairing();
    await vault.rotateAccountKey(userId, currentKey, nextKey);
    await vault.lock();
    vault = reopen();
    await vault.recoverAccountKeyRotation(userId, nextKey);
    expect(await vault.protectionMetadata()).toEqual(metadata);
    await assertPairing(paired);
  });

  it("resumes the original credential after rejection and allows another rotation", async () => {
    await attachLocalItem();
    const paired = await savePairing();
    await vault.rotateAccountKey(userId, currentKey, nextKey);
    await vault.cancelAccountKeyRotation(userId);
    await assertPairing(paired, currentKey);
    await vault.rotateAccountKey(userId, currentKey, nextKey);
    await vault.completeAccountKeyRotation(userId, currentKey, nextKey);
    await assertPairing(paired);
  });

  it("keeps pairings added by another owner before the file replacement", async () => {
    await attachLocalItem();
    const original = await savePairing();
    await vault.rotateAccountKey(userId, currentKey, nextKey);
    const added = await savePairing(currentKey, true);
    await vault.completeAccountKeyRotation(userId, currentKey, nextKey);
    await assertPairing(original);
    await assertPairing(added);
  });

  it("keeps local edits usable while an uncertain POST retains both recovery keys", async () => {
    const { saved, bytes } = await attachLocalItem();
    const paired = await savePairing();
    await vault.rotateAccountKey(userId, currentKey, nextKey);
    await vault.resumeAccountKeyRotation(userId);
    const edited = (await vault.list())[0];
    edited.bankAccount.accountNumber = "00999321000";
    await vault.save(edited);
    await assertPairing(paired, currentKey);
    await vault.lock();
    vault = reopen();
    await vault.unlockWithAccount(userId, currentKey);
    expect((await vault.list())[0].bankAccount.accountNumber).toBe("00999321000");
    expect(vault.state$.value).toBe("attached-local-pending");
    expect((await vault.protectionMetadata())?.cutover?.rotation?.phase).toBe("staged");
    await vault.lock();
    vault = reopen();
    await vault.unlockWithAccount(userId, nextKey);
    expect((await vault.list())[0].bankAccount.accountNumber).toBe("00999321000");
    expect(await vault.attachment(saved.attachments[0].id)).toEqual(bytes);
    await assertPairing(paired);
  });
});
