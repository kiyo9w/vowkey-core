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
} from "./demoday-family-dataset.mjs";
import {
  deriveMasterPasswordAuthHash,
  normalizeServerCipherForWasm,
} from "./seed-demoday-pool.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { PureCrypto } = require(
  path.resolve(__dirname, "../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js"),
);

const KDF_WASM = { pBKDF2: { iterations: 600000 } };

function decodeJwt(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
}

async function fetchRetry(url, init = {}, retries = 4) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function reqJson(url, { method = "GET", headers = {}, body, expectOk = true } = {}) {
  const finalHeaders = { Accept: "application/json", ...headers };
  let payload = body;
  if (
    body !== undefined &&
    typeof body !== "string" &&
    !Buffer.isBuffer(body) &&
    !(body instanceof FormData)
  ) {
    finalHeaders["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetchRetry(url, { method, headers: finalHeaders, body: payload });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (expectOk && !res.ok) {
    throw new Error(`HTTP ${res.status} ${method} ${url}: ${text.slice(0, 400)}`);
  }
  return { status: res.status, headers: res.headers, json, text };
}

async function loginClient({
  identityBase,
  apiBase,
  email,
  password,
  deviceId,
  deviceName,
  clientId = "web",
  deviceType = "10",
}) {
  const pre = await reqJson(`${identityBase}/accounts/prelogin`, {
    method: "POST",
    body: { email },
  });
  const kdfIter = pre.json.kdfIterations ?? pre.json.KdfIterations;
  assert.equal(kdfIter, 600000, `Unexpected kdfIterations for ${email}: ${kdfIter}`);

  const { authHash } = deriveMasterPasswordAuthHash(password, email);
  const form = new URLSearchParams({
    grant_type: "password",
    username: email,
    password: authHash,
    scope: "api offline_access",
    client_id: clientId,
    deviceType,
    deviceIdentifier: deviceId,
    deviceName,
  });
  const tok = await reqJson(`${identityBase}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const accessToken = tok.json.access_token;
  const claims = decodeJwt(accessToken);
  const unlock = tok.json.MasterPasswordUnlock ?? tok.json.masterPasswordUnlock;
  const salt = unlock?.Salt ?? unlock?.salt ?? email;
  const wrappedKey = unlock?.MasterKeyWrappedUserKey ?? unlock?.masterKeyWrappedUserKey ?? tok.json.Key;

  const userKey = PureCrypto.decrypt_user_key_with_master_password(
    wrappedKey,
    password,
    salt,
    KDF_WASM,
  );

  const sync = await reqJson(`${apiBase}/sync`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    accessToken,
    claims,
    userId: claims.sub,
    salt,
    userKey,
    sync: sync.json,
  };
}

async function verifyAllProfilesAndAttachments({
  label,
  apiBase,
  session,
  expectedShaSet,
  corsOrigin,
}) {
  const { accessToken, userKey, sync } = session;
  assert.equal(sync.ciphers.length, 4, `[${label}] Expected 4 ciphers, got ${sync.ciphers.length}`);

  const seenNames = new Set();
  const seenAttachmentShas = new Set();
  let totalBoxes = 0;

  for (const rawCipher of sync.ciphers) {
    const wasmCipher = normalizeServerCipherForWasm(rawCipher);
    const view = PureCrypto.decrypt_legacy_cipher(wasmCipher, userKey);
    seenNames.add(view.name);

    const metaField = view.fields.find((f) => f.name === VK_META_FIELD);
    assert.ok(metaField?.value, `[${label}] Missing vk.meta on ${view.name}`);
    const meta = JSON.parse(metaField.value);
    assertValidProfileEnvelope(meta);

    assert.equal(
      wasmCipher.attachments?.length ?? 0,
      meta.sources.length,
      `[${label}] Cipher attachment count mismatch on ${view.name}`,
    );

    for (const d of meta.details) {
      for (const v of d.variants) {
        if (v.sourceId) {
          assert.equal(v.locator?.kind, "page");
          totalBoxes++;
        }
      }
    }

    for (const src of meta.sources) {
      assert.ok(src.attachmentId, `[${label}] Null attachmentId on ${src.fileName}`);
      const attMetaRes = await reqJson(
        `${apiBase}/ciphers/${rawCipher.id}/attachment/${src.attachmentId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Origin: corsOrigin,
          },
        },
      );
      if (corsOrigin) {
        assert.equal(
          attMetaRes.headers.get("access-control-allow-origin"),
          corsOrigin,
          `[${label}] Missing CORS header on attachment metadata for origin ${corsOrigin}`,
        );
      }

      const dlUrl = attMetaRes.json.url;
      assert.ok(dlUrl, `[${label}] Missing download url on attachment ${src.attachmentId}`);
      const dlRes = await fetchRetry(dlUrl, {
        headers: corsOrigin ? { Origin: corsOrigin } : {},
      });
      assert.equal(dlRes.status, 200, `[${label}] Attachment download HTTP ${dlRes.status} at ${dlUrl}`);
      if (corsOrigin) {
        assert.equal(
          dlRes.headers.get("access-control-allow-origin"),
          corsOrigin,
          `[${label}] Missing CORS header on attachment binary for origin ${corsOrigin}`,
        );
      }

      const encBytes = new Uint8Array(await dlRes.arrayBuffer());
      const srvAtt = wasmCipher.attachments.find((a) => a.id === src.attachmentId);
      assert.ok(srvAtt, `[${label}] Attachment ${src.attachmentId} missing on cipher`);
      const plainBytes = PureCrypto.decrypt_legacy_attachment(
        wasmCipher,
        srvAtt,
        encBytes,
        userKey,
      );
      const sha256 = crypto.createHash("sha256").update(plainBytes).digest("hex");
      assert.equal(sha256, src.sha256, `[${label}] Decrypted SHA-256 mismatch vs vk.meta on ${src.fileName}`);
      assert.ok(expectedShaSet.has(sha256), `[${label}] Unknown source SHA-256 for ${src.fileName}`);
      seenAttachmentShas.add(sha256);
    }
  }

  for (const expectedName of ["Trần Minh Khoa", "Nguyễn Thị Lan Anh", "Trần Bảo Ngọc", "Nguyễn Thị Linh"]) {
    assert.ok(seenNames.has(expectedName), `[${label}] Missing profile ${expectedName}`);
  }
  assert.equal(seenAttachmentShas.size, 22, `[${label}] Expected 22 unique documents, got ${seenAttachmentShas.size}`);
  console.log(
    `[verify] ${label}: OK (4 profiles, 22/22 documents downloaded & decrypted byte-for-byte, ${totalBoxes} OCR/MRZ bounding boxes, Origin=${corsOrigin})`,
  );
}

async function main() {
  const familyDir = "/Users/ngotrung/Documents/Projects/vowkey/Demo/live/family/clean";
  const linhDir = "/Users/ngotrung/Documents/Projects/vowkey/Demo/live/linh";
  const linh = JSON.parse(fs.readFileSync(path.join(linhDir, "linh.json"), "utf8"));
  const sourceFiles = [
    ...fs.readdirSync(familyDir).filter((file) => file.endsWith(".jpg")).map((file) => path.join(familyDir, file)),
    ...linh.documents.map((document) => path.join(linhDir, document.path)),
  ];
  const expectedShaSet = new Set(sourceFiles.map((file) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")));
  assert.equal(expectedShaSet.size, 22, "Expected 17 family originals and the 5 listed Linh originals");

  const vaultUrl = process.env.VOWKEY_VAULT_URL ?? "https://vault.vowkey.app";
  const publicEmail = process.env.VOWKEY_PUBLIC_EMAIL ?? "demo@vowkey.app";
  const publicPassword = process.env.VOWKEY_PUBLIC_PASSWORD ?? "123456";
  const presenterPassword = process.env.VOWKEY_PRESENTER_PASSWORD ?? publicPassword;
  const devA = `verify-att-a-${crypto.randomUUID()}`;
  const devB = `verify-att-b-${crypto.randomUUID()}`;
  const devC = `verify-att-c-${crypto.randomUUID()}`;
  const devStage1 = `verify-stage-1-${crypto.randomUUID()}`;
  const devStage2 = `verify-stage-2-${crypto.randomUUID()}`;

  console.log(`[verify] 1. Logging in Attendee A (${publicEmail}) on vault.vowkey.app (Web Vault surface)...`);
  const attA = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: publicEmail,
    password: publicPassword,
    deviceId: devA,
    deviceName: "verify-demoday-client",
  });
  assert.equal(attA.claims.email, publicEmail);
  assert.equal(attA.salt, publicEmail);
  assert.equal(attA.sync.profile.email, publicEmail);
  assert.equal(
    attA.sync.userDecryption?.masterPasswordUnlock?.salt,
    publicEmail,
  );
  await verifyAllProfilesAndAttachments({
    label: "Attendee A (Web Vault)",
    apiBase: `${vaultUrl}/api`,
    session: attA,
    expectedShaSet,
    corsOrigin: "chrome-extension://abcdefghijklmnop",
  });

  console.log("[verify] 2. Logging in Attendee B on vault.vowkey.app (Desktop .dmg surface)...");
  const attB = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: publicEmail,
    password: publicPassword,
    deviceId: devB,
    deviceName: "verify-demoday-client",
    clientId: "desktop",
    deviceType: "7",
  });
  assert.notEqual(attB.userId, attA.userId, "Attendee A and Attendee B MUST get isolated User UUIDs!");
  assert.equal(
    Buffer.from(attB.userKey).equals(Buffer.from(attA.userKey)),
    false,
    "Attendee A and Attendee B MUST have distinct user encryption keys!",
  );
  assert.equal(attB.claims.email, publicEmail);
  await verifyAllProfilesAndAttachments({
    label: "Attendee B (Desktop .dmg)",
    apiBase: `${vaultUrl}/api`,
    session: attB,
    expectedShaSet,
    corsOrigin: "bw-desktop-file://bundle",
  });

  console.log("[verify] 3. Logging in Presenter on two stage devices (presenter@vowkey.app)...");
  const stage1 = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: "presenter@vowkey.app",
    password: presenterPassword,
    deviceId: devStage1,
    deviceName: "verify-demoday-client",
    clientId: "desktop",
    deviceType: "7",
  });
  const stage2 = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: "presenter@vowkey.app",
    password: presenterPassword,
    deviceId: devStage2,
    deviceName: "verify-demoday-client",
  });
  assert.equal(stage1.userId, stage2.userId, "Presenter stage devices MUST share the same workspace!");
  assert.notEqual(stage1.userId, attA.userId);
  assert.notEqual(stage1.userId, attB.userId);
  await verifyAllProfilesAndAttachments({
    label: "Presenter Stage",
    apiBase: `${vaultUrl}/api`,
    session: stage1,
    expectedShaSet,
    corsOrigin: "bw-desktop-file://bundle",
  });

  console.log("[verify] 4. Testing account-mutation guards & destructive workspace isolation on Attendee A...");
  const delAttempt = await reqJson(`${vaultUrl}/api/accounts/delete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${attA.accessToken}` },
    body: { masterPasswordHash: "fake" },
    expectOk: false,
  });
  assert.equal(delAttempt.status, 400, `Expected 400 on account delete, got ${delAttempt.status}`);

  // Rename first cipher and delete second cipher in Attendee A's workspace
  const targetEdit = normalizeServerCipherForWasm(attA.sync.ciphers[0]);
  const editView = PureCrypto.decrypt_legacy_cipher(targetEdit, attA.userKey);
  editView.name = "ATTENDEE_A_EDITED_PROFILE";
  const reEnc = PureCrypto.encrypt_legacy_cipher(editView, attA.userKey);
  await reqJson(`${vaultUrl}/api/ciphers/${targetEdit.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${attA.accessToken}` },
    body: {
      type: reEnc.type,
      folderId: reEnc.folderId ?? null,
      organizationId: null,
      name: reEnc.name,
      notes: reEnc.notes ?? null,
      favorite: Boolean(reEnc.favorite),
      reprompt: 0,
      key: reEnc.key,
      encryptedFor: attA.userId,
      identity: reEnc.identity ?? {},
      fields: (reEnc.fields ?? []).map((f) => ({
        name: f.name ?? null,
        value: f.value ?? null,
        type: f.type ?? 0,
        linkedId: f.linkedId ?? null,
      })),
      passwordHistory: [],
    },
  });

  const targetDeleteId = attA.sync.ciphers[1].id;
  await reqJson(`${vaultUrl}/api/ciphers/${targetDeleteId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${attA.accessToken}` },
  });

  // Re-login Attendee A with the same deviceId -> sticky slot must preserve A's edits!
  const attARelogin = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: publicEmail,
    password: publicPassword,
    deviceId: devA,
    deviceName: "verify-demoday-client",
  });
  assert.equal(attARelogin.userId, attA.userId, "Attendee A sticky device slot did not persist!");
  assert.equal(attARelogin.sync.ciphers.length, 3, "Attendee A deletion did not persist in A's own workspace!");
  const reloginNames = attARelogin.sync.ciphers.map(
    (c) => PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(c), attARelogin.userKey).name,
  );
  assert.ok(reloginNames.includes("ATTENDEE_A_EDITED_PROFILE"));

  // Verify Attendee B, fresh Attendee C, and Presenter are 100% UNTOUCHED!
  const attBResync = await reqJson(`${vaultUrl}/api/sync`, {
    headers: { Authorization: `Bearer ${attB.accessToken}` },
  });
  attB.sync = attBResync.json;
  await verifyAllProfilesAndAttachments({
    label: "Attendee B after A's edits",
    apiBase: `${vaultUrl}/api`,
    session: attB,
    expectedShaSet,
    corsOrigin: "bw-desktop-file://bundle",
  });

  const attC = await loginClient({
    identityBase: `${vaultUrl}/identity`,
    apiBase: `${vaultUrl}/api`,
    email: publicEmail,
    password: publicPassword,
    deviceId: devC,
    deviceName: "verify-demoday-client",
  });
  assert.notEqual(attC.userId, attA.userId);
  assert.notEqual(attC.userId, attB.userId);
  await verifyAllProfilesAndAttachments({
    label: "New Attendee C after A's edits",
    apiBase: `${vaultUrl}/api`,
    session: attC,
    expectedShaSet,
    corsOrigin: "https://vault.vowkey.app",
  });

  const stageResync = await reqJson(`${vaultUrl}/api/sync`, {
    headers: { Authorization: `Bearer ${stage1.accessToken}` },
  });
  stage1.sync = stageResync.json;
  await verifyAllProfilesAndAttachments({
    label: "Presenter after A's edits",
    apiBase: `${vaultUrl}/api`,
    session: stage1,
    expectedShaSet,
    corsOrigin: "bw-desktop-file://bundle",
  });

  console.log("\n[verify] ALL CHECKS PASSED: Multi-attendee isolation, presenter isolation, sticky sessions, CORS, and 22/22 original document decryptions verified!");
}

main().catch((err) => {
  console.error("[verify] FAILED:", err);
  process.exit(1);
});
