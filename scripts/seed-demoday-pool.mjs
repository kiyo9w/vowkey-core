#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  VK_META_FIELD,
  assertValidProfileEnvelope,
  buildTranFamilyProfiles,
  projectProfileEnvelope,
} from "./demoday-family-dataset.mjs";
import { buildLinhProfile } from "./linh-profile.mjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadWasm() {
  const candidates = [
    path.resolve(__dirname, "../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js"),
    path.resolve(__dirname, "./wasm/vowkey_wasm_internal.js"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return require(candidate);
    }
  }
  throw new Error(`Could not find vowkey_wasm_internal.js in: ${candidates.join(", ")}`);
}

const { PureCrypto } = loadWasm();

const KDF_ITERATIONS = 600000;
const KDF_WASM = { pBKDF2: { iterations: KDF_ITERATIONS } };
const KDF_API = { kdfType: 0, iterations: KDF_ITERATIONS, memory: null, parallelism: null };
const CIPHER_TYPE_IDENTITY = 4;
const FIELD_TYPE_TEXT = 0;
const FIELD_TYPE_HIDDEN = 1;
const REPROMPT_NONE = 0;

export function deriveMasterPasswordAuthHash(password, saltEmail) {
  const normalizedSalt = saltEmail.trim().toLowerCase();
  const masterKey = crypto.pbkdf2Sync(
    Buffer.from(password, "utf8"),
    Buffer.from(normalizedSalt, "utf8"),
    KDF_ITERATIONS,
    32,
    "sha256",
  );
  const authHash = crypto
    .pbkdf2Sync(masterKey, Buffer.from(password, "utf8"), 1, 32, "sha256")
    .toString("base64");
  return { normalizedSalt, authHash };
}

export function generateAccountKeyBundle(password, saltEmail, precomputedAuth = null) {
  const { normalizedSalt, authHash } =
    precomputedAuth ?? deriveMasterPasswordAuthHash(password, saltEmail);
  const userKey = PureCrypto.make_user_key_aes256_cbc_hmac();
  const masterKeyWrappedUserKey = PureCrypto.encrypt_user_key_with_master_password(
    userKey,
    password,
    normalizedSalt,
    KDF_WASM,
  );
  const privateKeyDer = PureCrypto.rsa_generate_keypair();
  const publicKeyDer = PureCrypto.rsa_extract_public_key(privateKeyDer);
  const publicKey = Buffer.from(publicKeyDer).toString("base64");
  const encryptedPrivateKey = PureCrypto.wrap_decapsulation_key(privateKeyDer, userKey);
  return {
    normalizedSalt,
    authHash,
    userKey,
    masterKeyWrappedUserKey,
    privateKeyDer,
    publicKey,
    encryptedPrivateKey,
  };
}

export function buildProfileCipherView({ id, key, name, favorite, meta, attachments = [] }) {
  assertValidProfileEnvelope(meta);
  const { identity, text } = projectProfileEnvelope(meta);
  const fields = [];
  for (const [fieldName, fieldValue] of text.entries()) {
    fields.push({
      name: fieldName,
      value: fieldValue,
      type: FIELD_TYPE_TEXT,
    });
  }
  fields.push({
    name: VK_META_FIELD,
    value: JSON.stringify(meta),
    type: FIELD_TYPE_HIDDEN,
  });

  const now = new Date().toISOString();
  const view = {
    collectionIds: [],
    name,
    type: CIPHER_TYPE_IDENTITY,
    identity,
    favorite: Boolean(favorite),
    reprompt: REPROMPT_NONE,
    organizationUseTotp: false,
    edit: true,
    permissions: { delete: true, restore: true },
    viewPassword: true,
    attachments,
    fields,
    passwordHistory: [],
    creationDate: now,
    revisionDate: now,
  };
  if (id) view.id = id;
  if (key) view.key = key;
  return view;
}

export function normalizeServerCipherForWasm(serverCipher) {
  const norm = {
    id: serverCipher.id ?? undefined,
    organizationId: serverCipher.organizationId ?? undefined,
    folderId: serverCipher.folderId ?? undefined,
    collectionIds: serverCipher.collectionIds ?? [],
    key: serverCipher.key ?? undefined,
    name: serverCipher.name ?? undefined,
    notes: serverCipher.notes ?? undefined,
    type: serverCipher.type,
    identity: serverCipher.identity
      ? Object.fromEntries(
          Object.entries(serverCipher.identity).filter(([k, v]) => k !== "response" && v != null),
        )
      : undefined,
    favorite: Boolean(serverCipher.favorite),
    reprompt: serverCipher.reprompt ?? 0,
    organizationUseTotp: Boolean(serverCipher.organizationUseTotp),
    edit: serverCipher.edit ?? true,
    permissions: serverCipher.permissions ?? { delete: true, restore: true },
    viewPassword: serverCipher.viewPassword ?? true,
    attachments: Array.isArray(serverCipher.attachments)
      ? serverCipher.attachments.map((a) => ({
          id: a.id ?? undefined,
          url: a.url ?? undefined,
          size: a.size != null ? String(a.size) : undefined,
          sizeName: a.sizeName ?? undefined,
          fileName: a.fileName ?? undefined,
          key: a.key ?? undefined,
        }))
      : undefined,
    fields: Array.isArray(serverCipher.fields)
      ? serverCipher.fields.map((f) => ({
          name: f.name ?? undefined,
          value: f.value ?? undefined,
          type: f.type ?? 0,
          linkedId: f.linkedId ?? undefined,
        }))
      : undefined,
    passwordHistory: Array.isArray(serverCipher.passwordHistory) ? serverCipher.passwordHistory : [],
    creationDate: serverCipher.creationDate ?? new Date().toISOString(),
    deletedDate: serverCipher.deletedDate ?? undefined,
    revisionDate: serverCipher.revisionDate ?? new Date().toISOString(),
    archivedDate: serverCipher.archivedDate ?? undefined,
  };
  return norm;
}

export function encryptedCipherToApiPayload(encCipher, userId) {
  return {
    type: encCipher.type,
    folderId: encCipher.folderId ?? null,
    organizationId: encCipher.organizationId ?? null,
    name: encCipher.name,
    notes: encCipher.notes ?? null,
    favorite: Boolean(encCipher.favorite),
    reprompt: encCipher.reprompt ?? 0,
    key: encCipher.key ?? null,
    encryptedFor: userId,
    identity: encCipher.identity ?? {},
    fields: (encCipher.fields ?? []).map((f) => ({
      name: f.name ?? null,
      value: f.value ?? null,
      type: f.type ?? 0,
      linkedId: f.linkedId ?? null,
    })),
    passwordHistory: [],
  };
}

function decodeJwtPayload(jwt) {
  const parts = jwt.split(".");
  if (parts.length < 2) throw new Error("Invalid JWT");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

async function runSelfTest(cleanDir) {
  console.log(`[self-test] Loading Tran family dataset from ${cleanDir}...`);
  const profiles = buildTranFamilyProfiles(cleanDir);
  assert.equal(profiles.length, 3, "Expected 3 family profiles");

  const totalDocs = profiles.reduce((acc, p) => acc + p.attachments.length, 0);
  assert.equal(totalDocs, 17, "Expected 17 total document attachments across family");

  const bundle = generateAccountKeyBundle("fixture-roundtrip-only", "demoday@vowkey.app");
  const recoveredUserKey = PureCrypto.decrypt_user_key_with_master_password(
    bundle.masterKeyWrappedUserKey,
    "fixture-roundtrip-only",
    "demoday@vowkey.app",
    KDF_WASM,
  );
  assert.deepEqual(
    Buffer.from(recoveredUserKey),
    Buffer.from(bundle.userKey),
    "User key round-trip mismatch",
  );
  const recoveredPrivKey = PureCrypto.unwrap_decapsulation_key(
    bundle.encryptedPrivateKey,
    recoveredUserKey,
  );
  assert.deepEqual(
    Buffer.from(recoveredPrivKey),
    Buffer.from(bundle.privateKeyDer),
    "RSA private key round-trip mismatch",
  );

  let verifiedAttachments = 0;
  let verifiedVariantsWithBoxes = 0;

  for (const profile of profiles) {
    const meta = structuredClone(profile.meta);
    const initialView = buildProfileCipherView({
      name: profile.name,
      favorite: profile.favorite,
      meta,
    });
    const initialEnc = PureCrypto.encrypt_legacy_cipher(initialView, bundle.userKey);
    const fakeCipherId = crypto.randomUUID();
    const serverCreated = normalizeServerCipherForWasm({
      ...encryptedCipherToApiPayload(initialEnc, crypto.randomUUID()),
      id: fakeCipherId,
      creationDate: new Date().toISOString(),
      revisionDate: new Date().toISOString(),
    });
    const decryptedCreated = PureCrypto.decrypt_legacy_cipher(serverCreated, recoveredUserKey);
    assert.ok(decryptedCreated.key, "Expected per-cipher symmetric key on decrypted cipher");

    const simulatedServerAttachments = [];
    const encryptedPayloads = new Map();

    for (let i = 0; i < profile.attachments.length; i++) {
      const { source, bytes } = profile.attachments[i];
      const metaSource = meta.sources[i];
      const encAtt = PureCrypto.encrypt_legacy_attachment(
        serverCreated,
        { id: metaSource.id, fileName: source.fileName },
        new Uint8Array(bytes),
        bundle.userKey,
      );
      const attId = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
      const encBytes = Uint8Array.from(encAtt.contents);
      metaSource.attachmentId = attId;
      simulatedServerAttachments.push({
        id: attId,
        fileName: encAtt.attachment.fileName,
        key: encAtt.attachment.key,
        size: String(encBytes.byteLength),
        sizeName: `${Math.round(encBytes.byteLength / 1024)} KB`,
        url: `https://vault.vowkey.app/attachments/${fakeCipherId}/${attId}`,
      });
      encryptedPayloads.set(attId, { encBytes, plainBytes: bytes, sha256: source.sha256 });
    }

    const finalView = buildProfileCipherView({
      id: fakeCipherId,
      key: decryptedCreated.key,
      name: profile.name,
      favorite: profile.favorite,
      meta,
    });
    const finalEnc = PureCrypto.encrypt_legacy_cipher(finalView, bundle.userKey);
    const serverUpdated = normalizeServerCipherForWasm({
      ...encryptedCipherToApiPayload(finalEnc, crypto.randomUUID()),
      id: fakeCipherId,
      attachments: simulatedServerAttachments,
      creationDate: new Date().toISOString(),
      revisionDate: new Date().toISOString(),
    });

    const roundTripView = PureCrypto.decrypt_legacy_cipher(serverUpdated, recoveredUserKey);
    assert.equal(roundTripView.name, profile.name);
    const vkMetaField = roundTripView.fields.find((f) => f.name === VK_META_FIELD);
    assert.ok(vkMetaField?.value, `Missing vk.meta on ${profile.name}`);
    const parsedMeta = JSON.parse(vkMetaField.value);
    assertValidProfileEnvelope(parsedMeta);

    for (const d of parsedMeta.details) {
      for (const v of d.variants) {
        if (v.sourceId) {
          assert.ok(v.locator && v.locator.kind === "page", `Missing locator on ${d.label}`);
          verifiedVariantsWithBoxes++;
        }
      }
    }

    for (const srvAtt of serverUpdated.attachments) {
      const { encBytes, plainBytes, sha256 } = encryptedPayloads.get(srvAtt.id);
      const decBytes = PureCrypto.decrypt_legacy_attachment(
        serverUpdated,
        srvAtt,
        encBytes,
        recoveredUserKey,
      );
      const actualSha = crypto.createHash("sha256").update(decBytes).digest("hex");
      assert.equal(actualSha, sha256, `Attachment SHA-256 mismatch for ${srvAtt.id}`);
      assert.equal(decBytes.byteLength, plainBytes.byteLength);
      verifiedAttachments++;
    }
  }

  console.log(
    `[self-test] PASS: 3 profiles, ${verifiedAttachments}/17 encrypted attachments round-tripped byte-for-byte, ${verifiedVariantsWithBoxes} source-linked OCR/MRZ boxes verified.`,
  );
}

async function httpJson(url, { method = "GET", headers = {}, body } = {}, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const finalHeaders = { Accept: "application/json", ...headers };
    let payload = body;
    if (
      body !== undefined &&
      !(body instanceof FormData) &&
      typeof body !== "string" &&
      !Buffer.isBuffer(body)
    ) {
      finalHeaders["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res;
    let text;
    try {
      res = await fetch(url, { method, headers: finalHeaders, body: payload });
      text = await res.text();
    } catch (netErr) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 150 * attempt));
        continue;
      }
      throw netErr;
    }
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (res.ok) {
      return json;
    }
    if (res.status >= 500 && attempt < retries) {
      await new Promise((r) => setTimeout(r, 150 * attempt));
      continue;
    }
    const err = new Error(`HTTP ${res.status} ${method} ${url}: ${text.slice(0, 400)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
}

export async function ensureAccountAndLogin({
  baseUrl,
  accountEmail,
  saltEmail,
  displayName,
  password,
  precomputedAuth,
}) {
  const deviceId = crypto.randomUUID();
  const bundle = generateAccountKeyBundle(password, saltEmail, precomputedAuth);

  let registeredFresh = false;
  try {
    const verifyToken = await httpJson(
      `${baseUrl}/identity/accounts/register/send-verification-email`,
      {
        method: "POST",
        body: { email: accountEmail, name: displayName },
      },
    );
    await httpJson(`${baseUrl}/identity/accounts/register/finish`, {
      method: "POST",
      body: {
        email: accountEmail,
        emailVerificationToken:
          typeof verifyToken === "string" ? verifyToken : String(verifyToken),
        masterPasswordAuthentication: {
          kdf: KDF_API,
          salt: bundle.normalizedSalt,
          masterPasswordAuthenticationHash: bundle.authHash,
        },
        masterPasswordUnlock: {
          kdf: KDF_API,
          salt: bundle.normalizedSalt,
          masterKeyWrappedUserKey: bundle.masterKeyWrappedUserKey,
        },
        userAsymmetricKeys: {
          publicKey: bundle.publicKey,
          encryptedPrivateKey: bundle.encryptedPrivateKey,
        },
      },
    });
    registeredFresh = true;
  } catch (err) {
    const msg = typeof err.body === "string" ? err.body : JSON.stringify(err.body ?? err.message);
    if (!msg.includes("already exists") && !msg.includes("Registration not allowed")) {
      throw err;
    }
  }

  const form = new URLSearchParams({
    grant_type: "password",
    username: accountEmail,
    password: bundle.authHash,
    scope: "api offline_access",
    client_id: "web",
    deviceType: "10",
    deviceIdentifier: deviceId,
    deviceName: "demoday-seeder",
  });
  const loginRes = await httpJson(`${baseUrl}/identity/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const accessToken = loginRes.access_token;
  const claims = decodeJwtPayload(accessToken);
  const userId = claims.sub;
  const wrappedKey =
    loginRes.MasterPasswordUnlock?.MasterKeyWrappedUserKey ?? loginRes.Key;
  const userKey = registeredFresh
    ? bundle.userKey
    : PureCrypto.decrypt_user_key_with_master_password(
        wrappedKey,
        password,
        bundle.normalizedSalt,
        KDF_WASM,
      );

  return { accessToken, userId, userKey, registeredFresh };
}

/** Adds encrypted profiles and originals without changing existing vault items. */
export async function appendWorkspaceProfiles({
  baseUrl,
  accessToken,
  userId,
  userKey,
  profilesTemplate,
}) {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  // Create in reverse order or chronological order so Tran Minh Khoa is top/favorite
  for (const profile of profilesTemplate) {
    const meta = structuredClone(profile.meta);
    const initialView = buildProfileCipherView({
      name: profile.name,
      favorite: profile.favorite,
      meta,
    });
    const initialEnc = PureCrypto.encrypt_legacy_cipher(initialView, userKey);
    const createdCipher = await httpJson(`${baseUrl}/api/ciphers`, {
      method: "POST",
      headers: authHeaders,
      body: encryptedCipherToApiPayload(initialEnc, userId),
    });

    const wasmCipher = normalizeServerCipherForWasm(createdCipher);
    const decryptedCreated = PureCrypto.decrypt_legacy_cipher(wasmCipher, userKey);

    for (let i = 0; i < profile.attachments.length; i++) {
      const { source, bytes } = profile.attachments[i];
      const metaSource = meta.sources[i];
      const encAtt = PureCrypto.encrypt_legacy_attachment(
        wasmCipher,
        { id: metaSource.id, fileName: source.fileName },
        new Uint8Array(bytes),
        userKey,
      );
      const encBytes = Uint8Array.from(encAtt.contents);

      const v2Res = await httpJson(
        `${baseUrl}/api/ciphers/${createdCipher.id}/attachment/v2`,
        {
          method: "POST",
          headers: authHeaders,
          body: {
            fileName: encAtt.attachment.fileName,
            key: encAtt.attachment.key,
            fileSize: encBytes.byteLength,
          },
        },
      );

      const form = new FormData();
      form.set("data", new Blob([encBytes], { type: "application/octet-stream" }), "data");
      await httpJson(
        `${baseUrl}/api/ciphers/${createdCipher.id}/attachment/${v2Res.attachmentId}`,
        {
          method: "POST",
          headers: authHeaders,
          body: form,
        },
      );

      metaSource.attachmentId = v2Res.attachmentId;
    }

    const finalView = buildProfileCipherView({
      id: createdCipher.id,
      key: decryptedCreated.key,
      name: profile.name,
      favorite: profile.favorite,
      meta,
    });
    const finalEnc = PureCrypto.encrypt_legacy_cipher(finalView, userKey);
    await httpJson(`${baseUrl}/api/ciphers/${createdCipher.id}`, {
      method: "PUT",
      headers: authHeaders,
      body: encryptedCipherToApiPayload(finalEnc, userId),
    });
  }
}

async function seedSingleWorkspace({
  baseUrl,
  accountEmail,
  saltEmail,
  displayName,
  password,
  precomputedAuth,
  profilesTemplate,
}) {
  const { accessToken, userId, userKey } = await ensureAccountAndLogin({
    baseUrl,
    accountEmail,
    saltEmail,
    displayName,
    password,
    precomputedAuth,
  });
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  // Wipe any existing ciphers on this account so re-runs are 100% clean and idempotent
  const syncRes = await httpJson(`${baseUrl}/api/sync`, { headers: authHeaders });
  if (Array.isArray(syncRes.ciphers) && syncRes.ciphers.length > 0) {
    for (const existing of syncRes.ciphers) {
      await httpJson(`${baseUrl}/api/ciphers/${existing.id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
    }
  }
  await appendWorkspaceProfiles({
    baseUrl, accessToken, userId, userKey, profilesTemplate,
  });

  return { accountEmail, userId };
}

function parseArgs(argv) {
  const opts = {
    selfTest: false,
    baseUrl: "http://127.0.0.1:8000",
    cleanDir: "/Users/ngotrung/Documents/Projects/vowkey/Demo/live/family/clean",
    linhDir: "/Users/ngotrung/Documents/Projects/vowkey/Demo/live/linh",
    poolSize: 200,
    skipCoreAccounts: false,
    publicEmail: "demo@vowkey.app",
    password: "123456",
    presenterPassword: "123456",
    concurrency: 8,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") opts.selfTest = true;
    else if (a === "--base-url") opts.baseUrl = argv[++i];
    else if (a === "--clean-dir") opts.cleanDir = argv[++i];
    else if (a === "--linh-dir") opts.linhDir = argv[++i];
    else if (a === "--pool-size") opts.poolSize = Number(argv[++i]);
    else if (a === "--slots") {
      opts.slots = argv[++i]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    } else if (a === "--skip-core") opts.skipCoreAccounts = true;
    else if (a === "--public-email") opts.publicEmail = argv[++i].trim().toLowerCase();
    else if (a === "--password") {
      opts.password = argv[++i];
      opts.presenterPassword = opts.password;
    } else if (a === "--presenter-password") opts.presenterPassword = argv[++i];
    else if (a === "--concurrency") opts.concurrency = Number(argv[++i]);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) {
    await runSelfTest(opts.cleanDir);
    return;
  }

  const [localPart, domainPart] = opts.publicEmail.split("@");
  assert(localPart && domainPart, `Invalid --public-email: ${opts.publicEmail}`);

  const profilesTemplate = [...buildTranFamilyProfiles(opts.cleanDir), buildLinhProfile(opts.linhDir)];
  const demoAuth = deriveMasterPasswordAuthHash(opts.password, opts.publicEmail);
  const presenterAuth = deriveMasterPasswordAuthHash(opts.presenterPassword, "presenter@vowkey.app");

  const startTime = Date.now();

  if (!opts.skipCoreAccounts && !opts.slots) {
    console.log(`[seed] Seeding template account ${opts.publicEmail} (before pool slots)...`);
    const tpl = await seedSingleWorkspace({
      baseUrl: opts.baseUrl,
      accountEmail: opts.publicEmail,
      saltEmail: opts.publicEmail,
      displayName: "Vowkey Demo Day",
      password: opts.password,
      precomputedAuth: demoAuth,
      profilesTemplate,
    });
    console.log(`[seed] Ready: ${tpl.accountEmail} (${tpl.userId})`);

    console.log("[seed] Seeding isolated stage account presenter@vowkey.app...");
    const pres = await seedSingleWorkspace({
      baseUrl: opts.baseUrl,
      accountEmail: "presenter@vowkey.app",
      saltEmail: "presenter@vowkey.app",
      displayName: "Trần Minh Khoa (Stage)",
      password: opts.presenterPassword,
      precomputedAuth: presenterAuth,
      profilesTemplate,
    });
    console.log(`[seed] Ready: ${pres.accountEmail} (${pres.userId})`);
  }

  const slotNumbers =
    opts.slots ?? Array.from({ length: opts.poolSize }, (_, idx) => idx + 1);
  console.log(
    `[seed] Seeding ${slotNumbers.length} isolated attendee pool workspaces for ${opts.publicEmail} (concurrency=${opts.concurrency})...`,
  );

  let cursor = 0;
  let completed = 0;
  const workers = Array.from(
    { length: Math.min(opts.concurrency, slotNumbers.length) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= slotNumbers.length) break;
        const n = slotNumbers[idx];
        const slotTag = String(n).padStart(4, "0");
        const email = `${localPart}+p${slotTag}@${domainPart}`;
        await seedSingleWorkspace({
          baseUrl: opts.baseUrl,
          accountEmail: email,
          saltEmail: opts.publicEmail,
          displayName: "Vowkey Demo Day",
          password: opts.password,
          precomputedAuth: demoAuth,
          profilesTemplate,
        });
        completed++;
        if (completed % 20 === 0 || completed === slotNumbers.length) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[seed] Progress: ${completed}/${slotNumbers.length} pool slots (${elapsed}s)`);
        }
      }
    },
  );

  await Promise.all(workers);
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[seed] DONE in ${totalSec}s.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[seed] FATAL:", err);
    process.exit(1);
  });
}
