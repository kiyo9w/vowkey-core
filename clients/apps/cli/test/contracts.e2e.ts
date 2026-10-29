import { pbkdf2Sync, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Cipher as SdkCipher, PureCrypto } from "@vowkey/sdk-internal";
import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { MemoryStorageService } from "@vowkey/common/platform/services/memory-storage.service";
import { UserId } from "@vowkey/common/types/guid";
import { AccountAgentRecords, AgentAccountTransport } from "@vowkey/common/vault/agent/account-records";
import { AgentRecordProtector } from "@vowkey/common/vault/agent/authority";
import { AgentExecutor, AgentSnapshot } from "@vowkey/common/vault/agent/executor";
import { CipherType } from "@vowkey/common/vault/enums";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import { LocalVaultMigration, MigrationHttpError, MigrationTransport } from "@vowkey/common/vault/local/migration";
import { requestHash } from "@vowkey/common/vault/local/canonical-json";
import { NativeLocalVaultStore } from "@vowkey/common/vault/local/node/store";
import { PageKeyProtector } from "@vowkey/common/vault/local/protection";
import { CipherData } from "@vowkey/common/vault/models/data/cipher.data";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherResponse } from "@vowkey/common/vault/models/response/cipher.response";
import { CipherRequest } from "@vowkey/common/vault/models/request/cipher.request";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { newEnvelope, readEnvelope, recordCapture, writeEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import { makeCoseKey } from "./crypto-keys";

type Json = Record<string, unknown>;
class NodeSdkLoadService extends SdkLoadService {
  protected async load(): Promise<void> {}
}

const server = process.env.VOWKEY_TEST_SERVER!;
const email = process.env.VOWKEY_TEST_EMAIL!;
const password = process.env.VOWKEY_TEST_PASSWORD!;
const kdf = { pBKDF2: { iterations: 600000 } };
let key: Uint8Array;
let userId: string;
let first: AgentAccountTransport;
let second: AgentAccountTransport;
let executorDeviceId: string;
let secondDeviceId: string;

async function login() {
  const master = pbkdf2Sync(password, email, 600000, 32, "sha256");
  const hash = pbkdf2Sync(master, password, 1, 32, "sha256").toString("base64");
  const deviceId = randomUUID();
  const response = await fetch(`${server}/identity/connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username: email, password: hash,
      scope: "api offline_access", client_id: "web", deviceType: "9",
      deviceIdentifier: deviceId, deviceName: "contract verification" }),
  });
  expect(response.status).toBe(200);
  const token = await response.json() as { access_token: string; Key: string };
  const accountKey = PureCrypto.decrypt_user_key_with_master_password(token.Key, password, email, kdf);
  const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url").toString()) as { sub: string };
  const send: AgentAccountTransport = async (method, path, body) => {
    const reply = await fetch(`${server}/api${path}`, {
      method, headers: { authorization: `Bearer ${token.access_token}`, "content-type": "application/json" },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    const text = await reply.text();
    const value = text === "" ? null : JSON.parse(text);
    if (!reply.ok) { throw { statusCode: reply.status, response: value }; }
    return value;
  };
  return { send, key: accountKey, userId: claims.sub, deviceId, token: token.access_token };
}

function protector(): AgentRecordProtector {
  return { seal: async (plain) => PureCrypto.symmetric_encrypt_string(plain, key),
    open: async (ciphertext) => PureCrypto.symmetric_decrypt_string(ciphertext, key) };
}
function sdkCipher(response: unknown): SdkCipher {
  return new Cipher(new CipherData(new CipherResponse(response))).toSdkCipher();
}

async function migrationTransport(): Promise<MigrationTransport> {
  const account = await login();
  account.key.fill(0);
  const remove = async (path: string) => {
    try { await first("DELETE", path); }
    catch (error) {
      const failure = error as { statusCode: number; response: { message?: string } };
      if (![404, 410].includes(failure.statusCode) && !(failure.statusCode === 400 &&
        /^(?:Cipher|Attachment) doesn't exist\.?$/i.test(failure.response.message ?? ""))) { throw error; }
    }
  };
  return {
    createCipher: async (body) => await first("POST", "/ciphers", body) as Json,
    getCipher: async (id) => await first("GET", `/ciphers/${id}`) as Json,
    updateCipher: async (id, body) => await first("PUT", `/ciphers/${id}`, body) as Json,
    deleteCipher: (id) => remove(`/ciphers/${id}`),
    deleteAttachment: (id, attachment) => remove(`/ciphers/${id}/attachment/${attachment}`),
    createAttachment: async (id, body) => await first("POST", `/ciphers/${id}/attachment/v2`, body) as { attachmentId: string; url: string },
    uploadAttachment: async (url, bytes) => {
      const data = new FormData(); data.append("data", bytes, "attachment");
      const response = await fetch(`${server}/api${url}`, {
        method: "POST", headers: { authorization: `Bearer ${account.token}` }, body: data,
      });
      expect(response.ok).toBe(true);
    },
    downloadAttachment: async (id, attachment) => {
      const info = await first("GET", `/ciphers/${id}/attachment/${attachment}`) as { url: string };
      const response = await fetch(info.url);
      expect(response.ok).toBe(true);
      return new Uint8Array(await response.arrayBuffer());
    },
    putFormBinding: async (id, encryptedBinding, profileCipherId) => {
      const current = await first("GET", "/form-bindings") as { data: { bindingId: string; revision: number }[] };
      const existing = current.data.find((row) => row.bindingId === id);
      await first("PUT", `/form-bindings/${id}`, {
        bindingId: id, encryptedBinding, profileCipherId, revision: existing?.revision ?? 0,
      });
    },
  };
}

beforeAll(async () => {
  await new NodeSdkLoadService().loadAndInit();
  const one = await login();
  first = one.send; key = one.key; userId = one.userId; executorDeviceId = one.deviceId;
  const two = await login();
  second = two.send;
  secondDeviceId = two.deviceId;
  expect(two.key).toEqual(key);
  two.key.fill(0);
}, 30_000);
afterAll(() => { key?.fill(0); });

describe("contracts against the account server", () => {
  it("accepts offline edits between pending retries and recovers removed attachment allocations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vowkey-pending-retry-"));
    const vault = new LocalVaultService(new NativeLocalVaultStore(directory), new MemoryStorageService(), new PageKeyProtector());
    try {
      const item = new CipherView();
      item.type = CipherType.ApiKey; item.name = "Fieldwork endpoint"; item.apiKey.value = "first synthetic value";
      const oldAttachmentId = randomUUID();
      const saved = await vault.save(item, [{ id: oldAttachmentId, fileName: "old.txt", bytes: new TextEncoder().encode("old document") }]);
      const environment = new CipherView(); environment.type = CipherType.Environment; environment.name = "Fieldwork";
      environment.environment.members = [{ name: "FIELDWORK_KEY", itemId: saved.id }];
      await vault.save(environment);
      const real = await migrationTransport();
      let mode = "unsupported";
      let remoteId = "";
      let environmentId = "";
      const attempts: Json[] = [];
      const transport: MigrationTransport = {
        ...real,
        createCipher: async (body) => {
          if (mode === "unsupported" && body.type === CipherType.ApiKey) { throw new MigrationHttpError(400, "Invalid cipher type"); }
          if (body.type === CipherType.ApiKey) { attempts.push(body); }
          const response = await real.createCipher(body);
          if (body.type === CipherType.ApiKey) { remoteId = String(response.id); }
          else { environmentId = String(response.id); }
          if (mode === "lose-create" && body.type === CipherType.ApiKey) { throw new Error("create response lost"); }
          return response;
        },
        createAttachment: async (id, body) => {
          const response = await real.createAttachment(id, body);
          if (mode === "lose-attachment") { throw new Error("attachment response lost"); }
          return response;
        },
        deleteAttachment: async (id, attachment) => {
          await real.deleteAttachment(id, attachment);
          if (mode === "lose-attachment-delete") { throw new Error("attachment deletion response lost"); }
        },
      };
      const migration = new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      });
      expect(await migration.attach(userId, key, "existing-account")).toBe("attached-local-pending");
      mode = "lose-create";
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("create response lost");
      expect(vault.state$.value).toBe("attached-local-pending");
      const edited = (await vault.list())[0];
      edited.name = "Revised fieldwork endpoint"; edited.apiKey.value = "updated synthetic value";
      await vault.save(edited);
      mode = "lose-attachment";
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("attachment response lost");
      expect(attempts[1]).toEqual(attempts[0]);
      const replacement = new TextEncoder().encode("replacement document");
      const current = (await vault.list())[0];
      await vault.save(current, [{ id: randomUUID(), fileName: "replacement.txt", bytes: replacement }], [oldAttachmentId]);
      const currentEnvironment = await first("GET", `/ciphers/${environmentId}`) as Json;
      const environmentCipher = sdkCipher(currentEnvironment);
      const environmentBody: Json = JSON.parse(JSON.stringify(new CipherRequest({
        cipher: Cipher.fromSdkCipher(environmentCipher)!, encryptedFor: userId as UserId, encryptedByKeyId: null,
      })));
      const environmentKey = PureCrypto.unwrap_symmetric_key(environmentCipher.key!, key);
      try {
        await second("PUT", `/ciphers/${environmentId}`, { ...environmentBody,
          name: PureCrypto.symmetric_encrypt_string("Edited from another session", environmentKey),
          lastKnownRevisionDate: currentEnvironment.revisionDate, expectedRevision: currentEnvironment.vowkeyRevision,
        });
      } finally { environmentKey.fill(0); }
      mode = "lose-attachment-delete";
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("attachment deletion response lost");
      mode = "normal";
      expect(await migration.attach(userId, key, "existing-account")).toBe("attached");
      const remote = sdkCipher(await first("GET", `/ciphers/${remoteId}`));
      const view = PureCrypto.decrypt_legacy_cipher(remote, key);
      expect(view.name).toBe("Revised fieldwork endpoint");
      expect(view.apiKey?.value).toBe("updated synthetic value");
      const syncedEnvironment = PureCrypto.decrypt_legacy_cipher(sdkCipher(await first("GET", `/ciphers/${environmentId}`)), key);
      expect(syncedEnvironment.name).toBe("Edited from another session");
      expect(syncedEnvironment.environment?.members).toEqual([{ name: "FIELDWORK_KEY", itemId: remoteId }]);
      expect(remote.attachments).toHaveLength(1);
      const encrypted = await real.downloadAttachment(remoteId, remote.attachments![0].id!);
      expect(PureCrypto.decrypt_legacy_attachment(remote, remote.attachments![0], encrypted, key)).toEqual(replacement);
      expect(await vault.store.list("ciphers")).toEqual([]);
      expect(saved.id).not.toBe(remoteId);
    } finally { await vault.lock(); await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["permanent", "trash"])("settles an uncertain pending create after local %s deletion", async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), "vowkey-pending-delete-"));
    const vault = new LocalVaultService(new NativeLocalVaultStore(directory), new MemoryStorageService(), new PageKeyProtector());
    try {
      const item = new CipherView(); item.type = CipherType.ApiKey; item.name = "Disposable endpoint";
      item.apiKey.value = "synthetic disposable key";
      const saved = await vault.save(item);
      const real = await migrationTransport();
      let mode = "unsupported";
      let remoteId = "";
      const transport = { ...real, createCipher: async (body: Json) => {
        if (mode === "unsupported") { throw new MigrationHttpError(400, "Invalid cipher type"); }
        const response = await real.createCipher(body); remoteId = String(response.id);
        if (mode === "lost") { throw new Error("create response lost"); }
        return response;
      }, deleteCipher: async (id: string) => {
        await real.deleteCipher(id);
        if (mode === "lost-delete") { throw new Error("deletion response lost"); }
      } };
      const migration = new LocalVaultMigration(vault, transport, { quiesce: (id) => vault.quiesce(id), rebind: async () => {} });
      await migration.attach(userId, key, "existing-account");
      mode = "lost";
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("create response lost");
      if (kind === "permanent") { await vault.removePending(userId, saved.id); }
      else {
        const trashed = (await vault.list())[0]; trashed.deletedDate = new Date();
        await vault.save(trashed);
      }
      expect(await vault.list()).toEqual([]);
      mode = "lost-delete";
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("deletion response lost");
      mode = "normal";
      expect(await migration.attach(userId, key, "existing-account"))
        .toBe(kind === "permanent" ? "attached" : "attached-local-pending");
      const sync = await first("GET", "/sync") as { ciphers: Json[] };
      expect(sync.ciphers.some((row) => row.id === remoteId)).toBe(false);
      await expect(first("GET", `/ciphers/${remoteId}`)).rejects.toMatchObject({ statusCode: 400 });
      if (kind === "trash") {
        const restored = (await vault.pendingItems(userId))[0]; restored.deletedDate = undefined;
        await vault.save(restored);
        expect(await migration.attach(userId, key, "existing-account")).toBe("attached");
        expect(PureCrypto.decrypt_legacy_cipher(sdkCipher(await first("GET", `/ciphers/${remoteId}`)), key).name)
          .toBe("Disposable endpoint");
      }
    } finally { await vault.lock(); await rm(directory, { recursive: true, force: true }); }
  });

  it("resumes a lost create response, preserves ciphertext and remaps only physical joins", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vowkey-migration-"));
    const vault = new LocalVaultService(new NativeLocalVaultStore(directory), new MemoryStorageService(), new PageKeyProtector());
    try {
      const profile = new CipherView();
      profile.type = CipherType.Identity; profile.name = "Alina Rivera";
      profile.id = randomUUID();
      const envelope = newEnvelope(profile.id);
      const capture = recordCapture(envelope, {
        fileName: "professional-qualification.txt", mediaType: "text/plain", kind: "Professional qualification",
      }, [{ key: "professional.certification.number", value: "QU-4815", origin: "text", verified: false }]);
      const attachmentId = randomUUID();
      envelope.sources[0].attachmentId = attachmentId;
      writeEnvelope(profile, envelope);
      const sourceBytes = new TextEncoder().encode("Professional qualification QU-4815");
      const savedProfile = await vault.save(profile, [{ id: attachmentId, fileName: "qualification.txt", bytes: sourceBytes }]);
      const apiKey = new CipherView();
      apiKey.type = CipherType.ApiKey; apiKey.name = "Research endpoint";
      apiKey.apiKey.value = "test-laboratory-key-4815";
      apiKey.apiKey.sendStyle = "header"; apiKey.apiKey.headerName = "X-Lab-Key";
      apiKey.apiKey.allowedHosts = ["research.example"];
      const savedKey = await vault.save(apiKey);
      const environment = new CipherView();
      environment.type = CipherType.Environment; environment.name = "Laboratory";
      environment.environment.members = [{ name: "LAB_API_KEY", itemId: savedKey.id }];
      environment.notes = `Qualification: @vk:${savedProfile.id}/detail.${envelope.details[0].id}`;
      const savedEnvironment = await vault.save(environment);
      const installationId = await vault.installationId();
      const operationId = `document:${randomUUID()}`;
      await vault.saveOperation(installationId, operationId,
        await vault.seal(JSON.stringify({ v: 1, cipherId: savedProfile.id, sourceId: capture.sourceId })));
      const bindingId = randomUUID();
      await vault.store.commit([{ store: "formBindings", id: bindingId, value: await vault.seal(JSON.stringify({
        v: 1, formSignature: "professional-registration", sectionId: "registrant",
        profileCipherId: savedProfile.id, updatedAt: new Date().toISOString(),
        fields: [{ fieldSignature: "qualification", detailId: envelope.details[0].id,
          variantId: null, format: { label: "As printed on the certificate" }, correctedByPerson: true }],
      })) }]);
      const original = await vault.store.get<SdkCipher>("ciphers", savedKey.id);
      const created = new Map<string, string>();
      const attempts: Json[] = [];
      let loseResponse = true;
      let finalizedId: string | null = null;
      const transport: MigrationTransport = {
        createCipher: async (body) => {
          attempts.push(body);
          const response = await first("POST", "/ciphers", body) as Json;
          created.set(String(body.localResourceId), String(response.id));
          if (loseResponse) { loseResponse = false; throw new Error("response lost after commit"); }
          return response;
        },
        getCipher: async (id) => await first("GET", `/ciphers/${id}`) as Json,
        deleteCipher: async (id) => { await first("DELETE", `/ciphers/${id}`); },
        deleteAttachment: async (id, attachment) => { await first("DELETE", `/ciphers/${id}/attachment/${attachment}`); },
        updateCipher: async (id, body) => {
          const response = await first("PUT", `/ciphers/${id}`, body) as Json;
          const read = await first("GET", `/ciphers/${id}`) as Json;
          for (const field of ["type", "name", "notes", "key", "fields", "identity", "apiKey", "environment"]) {
            expect({ field, value: read[field] ?? null }).toEqual({ field, value: body[field] ?? null });
          }
          expect(read.migrationPending).toBe(false);
          if (finalizedId == null) {
            finalizedId = id;
            throw new Error("finalization response lost after commit");
          }
          return response;
        },
        createAttachment: async (id, body) => await first("POST", `/ciphers/${id}/attachment/v2`, body) as { attachmentId: string; url: string },
        uploadAttachment: async (url, bytes) => {
          const account = await login();
          const data = new FormData(); data.append("data", bytes, "attachment");
          const response = await fetch(`${server}/api${url}`, { method: "POST", headers: { authorization: `Bearer ${account.token}` }, body: data });
          account.key.fill(0);
          if (!response.ok) throw new MigrationHttpError(response.status, "attachment upload failed");
        },
        downloadAttachment: async (id, attachment) => {
          const info = await first("GET", `/ciphers/${id}/attachment/${attachment}`) as { url: string };
          const response = await fetch(info.url);
          expect(response.ok).toBe(true);
          return new Uint8Array(await response.arrayBuffer());
        },
        putFormBinding: async (id, encryptedBinding, profileCipherId) => {
          await first("PUT", `/form-bindings/${id}`, { bindingId: id, encryptedBinding, profileCipherId, revision: 0 });
        },
      };
      const migration = new LocalVaultMigration(vault, transport, {
        quiesce: (id) => vault.quiesce(id), rebind: async () => {},
      });
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("response lost after commit");
      expect((await vault.list()).length).toBe(3);
      await expect(migration.attach(userId, key, "existing-account")).rejects.toThrow("finalization response lost after commit");
      const current = sdkCipher(await first("GET", `/ciphers/${finalizedId}`));
      const ownerWrite: Json = JSON.parse(JSON.stringify(new CipherRequest({
        cipher: Cipher.fromSdkCipher(current)!, encryptedFor: userId as UserId, encryptedByKeyId: null,
      })));
      const contentKey = PureCrypto.unwrap_symmetric_key(current.key!, key);
      try { ownerWrite.name = PureCrypto.symmetric_encrypt_string("Later owner title", contentKey); }
      finally { contentKey.fill(0); }
      await first("PUT", `/ciphers/${finalizedId}`, ownerWrite);
      expect(await migration.attach(userId, key, "existing-account")).toBe("attached");
      expect(PureCrypto.decrypt_legacy_cipher(sdkCipher(await first("GET", `/ciphers/${finalizedId}`)), key).name)
        .toBe("Later owner title");
      expect(attempts[1]).toEqual(attempts[0]);
      const remoteKey = sdkCipher(await first("GET", `/ciphers/${created.get(savedKey.id)}`));
      expect(remoteKey.key).not.toBe(original!.key);
      expect(remoteKey.apiKey).toEqual(original!.apiKey);
      expect(PureCrypto.decrypt_legacy_cipher(remoteKey, key).apiKey?.value).toBe("test-laboratory-key-4815");
      const remoteProfile = CipherView.fromSdkCipherView(PureCrypto.decrypt_legacy_cipher(
        sdkCipher(await first("GET", `/ciphers/${created.get(savedProfile.id)}`)), key))!;
      const migrated = readEnvelope(remoteProfile)!;
      expect(migrated.profileId).toBe(remoteProfile.id);
      expect(migrated.details[0].id).toBe(envelope.details[0].id);
      expect(migrated.details[0].variants[0].id).toBe(envelope.details[0].variants[0].id);
      expect(migrated.sources[0].id).toBe(capture.sourceId);
      expect(migrated.sources[0].attachmentId).not.toBe(attachmentId);
      const remoteEnv = PureCrypto.decrypt_legacy_cipher(sdkCipher(await first("GET", `/ciphers/${created.get(savedEnvironment.id)}`)), key);
      expect(remoteEnv.environment?.members[0].itemId).toBe(created.get(savedKey.id));
      expect(remoteEnv.notes).toContain(`@vk:${remoteProfile.id}/detail.${envelope.details[0].id}`);
      expect(await vault.listOperations(installationId)).toEqual([]);
      const operations = await vault.listOperations(userId);
      expect(operations).toHaveLength(1);
      expect(JSON.parse(await vault.open(operations[0].value))).toEqual({
        v: 1, cipherId: remoteProfile.id, sourceId: capture.sourceId,
      });
      const accountRecords = new AccountAgentRecords(first, protector(), { executorDeviceId });
      const binding = (await accountRecords.sync()).formBindings.find((row) => row.bindingId === bindingId);
      expect(binding?.profileCipherId).toBe(remoteProfile.id);
      expect(binding?.binding.fields[0].detailId).toBe(envelope.details[0].id);
      const sync = await first("GET", "/sync") as { ciphers: Json[] };
      expect(sync.ciphers.filter((row) => [...created.values()].includes(String(row.id)))).toHaveLength(3);
      expect(await vault.list()).toEqual([]);
    } finally { await vault.lock(); await rm(directory, { recursive: true, force: true }); }
  }, 60_000);

  it("accepts one answer across two devices and only lets the elected device publish an outcome", async () => {
    const a = new AccountAgentRecords(first, protector(), { executorDeviceId });
    const b = new AccountAgentRecords(second, protector(), { executorDeviceId: secondDeviceId });
    const item = new CipherView();
    item.type = CipherType.SecureNote; item.name = "Independent research record";
    const body = new CipherRequest({
      cipher: Cipher.fromSdkCipher(PureCrypto.encrypt_legacy_cipher(item.toSdkCipherView(), key))!,
      encryptedFor: userId as UserId, encryptedByKeyId: null,
    });
    const saved = await first("POST", "/ciphers", JSON.parse(JSON.stringify(body))) as Json;
    const cipherId = String(saved.id);
    const executor = new AgentExecutor({ localExecutorId: randomUUID(), vaultScopeIds: [userId],
      protector: protector(), coordination: a, clock: { wall: () => Date.now(), mono: () => performance.now() },
      resolve: async () => ({ cipherId, fieldPath: "name", revisionDate: "", accessible: true,
        draft: false, agentRule: "ask" as const }) });
    await executor.receive("editor", { type: "pair", displayName: "Research editor", vaultScopeId: userId });
    const pairing = await executor.approve("editor");
    executor.observeTarget({ targetId: randomUUID(), kind: "web",
      destinationKey: "web:https://research.example", generation: randomUUID(), display: "research.example",
      formSignature: "qualification-form", sections: [{ id: "researcher", label: "Researcher" }],
      fields: [{ id: "qualification", sectionId: "researcher", label: "Qualification", type: "text", options: [] }] });
    const receipt = await executor.receive("editor", {
      type: "fill_request", pairingId: pairing!.pairingId, credential: pairing!.credential, vaultScopeId: userId,
      body: { goal: "Complete the qualification form", reason: "The form asks for the selected qualification",
        assignments: [{ fieldId: "qualification", reference: `@vk:${cipherId}/name` }] },
    });
    expect(receipt.status).toBe("pending");
    const requestId = String(receipt.requestId);
    const remote = (await b.sync()).requests.find((row) => row.requestId === requestId);
    expect(remote?.note?.goal).toBe("Complete the qualification form");
    const entryId = remote!.routing.entries[0].entryId;
    const [one, two] = await Promise.all([
      a.answer(requestId, "allow_once", [entryId]), b.answer(requestId, "deny", []),
    ]);
    expect(one.answer).toEqual(two.answer);
    const result = { type: "result", requestId, status: "not_written",
      entries: [{ entryId, reference: `@vk:${cipherId}/name`, outcome: "not_written" }] };
    await expect(b.result(requestId, result)).rejects.toMatchObject({ code: "not_executor" });
    await expect(second("PUT", `/agent/requests/${requestId}/result`, {
      revision: 0, result: await protector().seal(JSON.stringify({ v: 1, ...result })),
    })).rejects.toMatchObject({ statusCode: 403 });
    await a.result(requestId, result);
    await a.result(requestId, result);
    expect((await b.sync()).requests.find((row) => row.requestId === requestId)?.result?.status).toBe("not_written");
  }, 30_000);

  it("honors a changed denial after an interrupted Allow and excludes never details from approval", async () => {
    let interruptAnswer = false;
    const records = new AccountAgentRecords(async (method, path, body) => {
      if (interruptAnswer && path.endsWith("/answer")) {
        interruptAnswer = false;
        throw { statusCode: 503, code: "unavailable" };
      }
      return first(method, path, body);
    }, protector(), { executorDeviceId });
    const pairingId = randomUUID();
    await records.pairing({ pairingId, vaultScopeId: userId, displayName: "Retry editor",
      createdAt: new Date().toISOString(), revokedAt: null }, randomUUID());
    const item = new CipherView(); item.type = CipherType.SecureNote; item.name = "Approval retry";
    const saved = await first("POST", "/ciphers", JSON.parse(JSON.stringify(new CipherRequest({
      cipher: Cipher.fromSdkCipher(PureCrypto.encrypt_legacy_cipher(item.toSdkCipherView(), key))!,
      encryptedFor: userId as UserId, encryptedByKeyId: null,
    })))) as Json;
    const cipherId = String(saved.id), requestId = randomUUID(), entryId = randomUUID();
    const entry = { entryId, fieldId: "qualification", reference: `@vk:${cipherId}/name`, cipherId,
      fieldPath: "name", revisionDate: "", policyFieldPath: "name", resolvePath: "name",
      profileId: null, sectionId: "researcher", label: "Qualification", decision: "ask" as const,
      askReason: "rule_ask" as const };
    await records.receive({ requestId, pairingId, vaultScopeId: userId, targetId: randomUUID(),
      destinationKey: "web:https://retry.example", generation: randomUUID(), targetDisplay: "retry.example",
      sections: [{ id: "researcher", label: "Researcher" }],
      deadline: { wallDeadline: Date.now() + 600_000, remainingMs: 600_000, stampedMono: performance.now(), stampedWall: Date.now() },
      entries: [entry, { ...entry, entryId: randomUUID(), fieldId: "private-detail", decision: "deny", askReason: null }],
      note: { goal: "Complete the form", reason: "The form asks for the qualification" },
      answer: null, selectedEntryIds: null, status: "pending" });
    expect((await records.sync()).requests.find((row) => row.requestId === requestId)?.routing.entries.map((row) => row.entryId)).toEqual([entryId]);
    interruptAnswer = true;
    await expect(records.answer(requestId, "allow_once", [entryId])).rejects.toMatchObject({ statusCode: 503 });
    expect((await records.answer(requestId, "deny", [])).answer).toMatchObject({ answer: "deny", selectedEntryIds: [] });
    const otherDevice = new AccountAgentRecords(second, protector(), { executorDeviceId: secondDeviceId });
    expect((await otherDevice.sync()).requests.find((row) => row.requestId === requestId)?.answer)
      .toMatchObject({ answer: "deny", selectedEntryIds: [] });
  }, 30_000);

  it("rejects a stale finalization token even when its display date matches the current item", async () => {
    const item = new CipherView(); item.type = CipherType.SecureNote; item.name = "Revision probe";
    const body: Json = JSON.parse(JSON.stringify(new CipherRequest({
      cipher: Cipher.fromSdkCipher(PureCrypto.encrypt_legacy_cipher(item.toSdkCipherView(), key))!,
      encryptedFor: userId as UserId, encryptedByKeyId: null,
    })));
    body.migrationPending = true;
    const saved = await first("POST", "/ciphers", { ...body, migrationId: randomUUID(),
      localResourceId: randomUUID(), requestHash: await requestHash(body) }) as Json;
    const final = { ...body, migrationPending: false, expectedRevision: saved.vowkeyRevision,
      lastKnownRevisionDate: saved.revisionDate };
    const completed = await first("PUT", `/ciphers/${saved.id}`, final) as Json;
    expect(completed.vowkeyRevision).toBe(Number(saved.vowkeyRevision) + 1);
    await expect(first("PUT", `/ciphers/${saved.id}`, {
      ...final, lastKnownRevisionDate: completed.revisionDate,
    })).rejects.toMatchObject({ statusCode: 409 });
    expect((await first("GET", `/ciphers/${saved.id}`) as Json).vowkeyRevision).toBe(completed.vowkeyRevision);
  });

  it("reseals activity after its source changes instead of storing it under a stale owner snapshot", async () => {
    const item = new CipherView(); item.type = CipherType.SecureNote; item.name = "Activity source";
    const body: Json = JSON.parse(JSON.stringify(new CipherRequest({
      cipher: Cipher.fromSdkCipher(PureCrypto.encrypt_legacy_cipher(item.toSdkCipherView(), key))!,
      encryptedFor: userId as UserId, encryptedByKeyId: null,
    })));
    const saved = await first("POST", "/ciphers", body) as Json;
    let race = true;
    const records = new AccountAgentRecords(first, protector(), { executorDeviceId,
      sealSource: async (id, plain) => {
        const current = await first("GET", `/ciphers/${id}`) as Json;
        const ciphertext = PureCrypto.symmetric_encrypt_string(plain, key);
        if (race) {
          race = false;
          await first("PUT", `/ciphers/${id}`, { ...body, lastKnownRevisionDate: current.revisionDate });
        }
        return { ciphertext, organizationId: null, revision: Number(current.vowkeyRevision) };
      },
      openSource: async (_id, organizationId, encrypted) => {
        expect(organizationId).toBeNull();
        return PureCrypto.symmetric_decrypt_string(encrypted, key);
      },
    });
    const activity = { v: 1 as const, kind: "proxy" as const, eventId: randomUUID(),
      sourceCipherId: String(saved.id), method: "GET", host: "research.example", port: 443,
      outcome: "confirmed", at: Date.now() };
    await expect(records.proxyActivity(activity)).rejects.toMatchObject({ statusCode: 409 });
    await records.proxyActivity(activity);
    const synced = (await records.sync()).activity.filter((row) => row.eventId === activity.eventId);
    expect(synced).toHaveLength(1);
    expect(synced[0].activity).toEqual(activity);
  });

  it("stores the SDK's COSE-encrypted agent metadata without downgrading its format", async () => {
    const coseKey = makeCoseKey();
    const pairingId = randomUUID();
    const localExecutorId = randomUUID();
    const raw = JSON.stringify({ v: 1, pairingId, displayName: "Conference editor", localExecutorId,
      executorDeviceId, createdAt: new Date().toISOString(), revokedAt: null });
    try {
      const encryptedMetadata = PureCrypto.symmetric_encrypt_string(raw, coseKey);
      expect(encryptedMetadata.startsWith("7.")).toBe(true);
      const saved = await first("POST", "/agent/pairings", {
        pairingId, localExecutorId, executorDeviceId, encryptedMetadata,
      }) as Json;
      expect(saved.encryptedMetadata).toBe(encryptedMetadata);
      expect(PureCrypto.symmetric_decrypt_string(String(saved.encryptedMetadata), coseKey)).toBe(raw);
    } finally { coseKey.fill(0); }
  });
});
