#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
import {
  deriveMasterPasswordAuthHash,
  encryptedCipherToApiPayload,
  appendWorkspaceProfiles,
  normalizeServerCipherForWasm,
} from "./seed-demoday-pool.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PureCrypto = require("../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js").PureCrypto;

const FAMILY_MARK = {
  "Residence Card (Front) — Trần Minh Khoa.jpg": "Trần Minh Khoa",
  "Residence Card (Front) — Nguyễn Thị Lan Anh.jpg": "Nguyễn Thị Lan Anh",
  "Residence Card (Front) — Trần Bảo Ngọc.jpg": "Trần Bảo Ngọc",
};
const LINH_FILES = new Set(["residence-front.jpg", "passport.jpg", "enrollment.jpg"]);
const FORM_ATTRIBUTES = [
  "household.head.name", "household.head.national_id", "household.relationship",
  "address.registered_domicile",
];
const FILL_ON_SEED = new Set([
  "id.national.number", "id.residence_card.number", "id.passport.number",
  "id.health_insurance.number", "bank.account.number",
]);

function argsOf(argv) {
  const value = (flag) => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null;
  const base = (value("--base-url") ?? process.env.VOWKEY_VAULT_URL ?? "https://vault.vowkey.app").replace(/\/$/, "");
  const password = value("--password") ?? process.env.VOWKEY_DEMO_PASSWORD;
  const emails = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--email") emails.push(argv[++i]);
  }
  if (!emails.length && process.env.VOWKEY_DEMO_EMAIL) emails.push(process.env.VOWKEY_DEMO_EMAIL);
  return {
    base,
    password,
    emails,
    concurrency: Number(value("--concurrency") ?? 6),
    publicEmail: value("--public-email") ?? "demo@vowkey.app",
    poolSize: Number(value("--pool-size") ?? 200),
    presenter: argv.includes("--presenter"),
    pool: argv.includes("--pool"),
    apply: argv.includes("--apply"),
    familyDir: value("--family-dir") ?? path.resolve(root, "../../vowkey/Demo/live/family/clean"),
    linhDir: value("--linh-dir") ?? path.resolve(root, "../../vowkey/Demo/live/linh"),
  };
}

function saltFor(email, publicEmail) {
  const [local, domain] = email.split("@");
  const [publicLocal] = publicEmail.split("@");
  return local.startsWith(`${publicLocal}+p`) && domain === publicEmail.split("@")[1]
    ? publicEmail : email;
}

function accountsOf(opts) {
  const emails = [...opts.emails];
  if (opts.presenter) emails.push("presenter@vowkey.app");
  if (opts.pool) {
    const [local, domain] = opts.publicEmail.split("@");
    for (let n = 1; n <= opts.poolSize; n++) {
      emails.push(`${local}+p${String(n).padStart(4, "0")}@${domain}`);
    }
  }
  return [...new Set(emails)];
}

async function json(url, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (options.body instanceof URLSearchParams) headers["Content-Type"] = "application/x-www-form-urlencoded";
  else if (options.body != null && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body instanceof URLSearchParams ? options.body.toString()
      : options.body != null && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : null;
}

function knownModel(view, models) {
  const files = new Set((view.attachments ?? []).map((item) => item.fileName).filter(Boolean));
  const metaField = view.fields.find((field) => field.name === VK_META_FIELD);
  if (metaField?.value) {
    for (const source of JSON.parse(metaField.value).sources ?? []) files.add(source.fileName);
  }
  for (const [fileName, name] of Object.entries(FAMILY_MARK)) {
    if (files.has(fileName)) return models.family.get(name) ?? null;
  }
  if ([...LINH_FILES].every((name) => files.has(name))) return models.linh;
  return null;
}

/** Adds missing typed form facts. Never changes an existing value, rule, or attachment. */
export function mergeFormFacts(meta, model) {
  const attributes = new Set(meta.details.map((detail) => detail.attribute));
  const added = [];
  for (const source of model.meta.details) {
    if (FILL_ON_SEED.has(source.attribute)) {
      const current = meta.details.find((detail) => detail.attribute === source.attribute);
      if (current?.agentRule === "ask") {
        current.agentRule = "fill";
        added.push(`${source.attribute}:ask->fill`);
      }
    }
    if (attributes.has(source.attribute) || !FORM_ATTRIBUTES.includes(source.attribute)) continue;
    if (source.variants.some((variant) => variant.sourceId != null || variant.origin !== "typed")) continue;
    meta.details.push(structuredClone(source));
    attributes.add(source.attribute);
    added.push(source.attribute);
  }
  return added;
}

function preloginKdf(pre) {
  const iterations = pre.kdfIterations ?? pre.KdfIterations;
  if ((pre.kdf ?? pre.Kdf) === 1) {
    return { argon2id: {
      iterations,
      memory: pre.kdfMemory ?? pre.KdfMemory,
      parallelism: pre.kdfParallelism ?? pre.KdfParallelism,
    } };
  }
  return { pBKDF2: { iterations } };
}

/** The seeder's two steps: KDF for the master key, then one PBKDF2 pass for the auth hash. */
function authHashFor(password, salt, kdf) {
  const masterKey = PureCrypto.derive_kdf_material(
    new TextEncoder().encode(password), new TextEncoder().encode(salt), kdf,
  );
  try {
    return crypto.pbkdf2Sync(masterKey, password, 1, 32, "sha256").toString("base64");
  } finally {
    masterKey.fill(0);
  }
}

export async function unlockSeedAccount({ base, email, password, salt = saltFor(email, "demo@vowkey.app") }) {
  const prelogin = await json(`${base}/identity/accounts/prelogin`, {
    method: "POST", body: { email },
  });
  const kdf = preloginKdf(prelogin);
  const token = await json(`${base}/identity/connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password", username: email, password: authHashFor(password, salt, kdf),
      scope: "api offline_access", client_id: "web", deviceType: "10",
      deviceIdentifier: crypto.randomUUID(), deviceName: "demoday-profile-update",
    }),
  });
  const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url"));
  const unlock = token.MasterPasswordUnlock ?? token.masterPasswordUnlock;
  const userKey = PureCrypto.decrypt_user_key_with_master_password(
    unlock?.MasterKeyWrappedUserKey ?? unlock?.masterKeyWrappedUserKey ?? token.Key,
    password, unlock?.Salt ?? unlock?.salt ?? salt, kdf,
  );
  const headers = { Authorization: `Bearer ${token.access_token}` };
  return { token, claims, userKey, headers };
}

async function updateAccount(opts, email, models) {
  const { token, claims, userKey, headers } = await unlockSeedAccount({
    base: opts.base, email, password: opts.password, salt: saltFor(email, opts.publicEmail),
  });
  const sync = await json(`${opts.base}/api/sync`, { headers });
  const ciphers = sync.ciphers ?? [];
  let familyMatched = 0;
  let linhPresent = false;
  let changed = 0;
  const keys = new Set();
  for (const raw of ciphers) {
    const view = PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(raw), userKey);
    const model = knownModel(view, models);
    if (!model) continue;
    if (model === models.linh) linhPresent = true;
    else familyMatched++;
    const metaField = view.fields.find((field) => field.name === VK_META_FIELD);
    if (!metaField?.value) throw new Error(`${email}: ${view.name} has no profile metadata`);
    const meta = JSON.parse(metaField.value);
    const sources = meta.sources.map((source) => source.attachmentId);
    const nevers = meta.details.filter((detail) => detail.agentRule === "never")
      .map((detail) => [detail.attribute, detail.variants.map((variant) => variant.value).join("|")]);
    const added = mergeFormFacts(meta, model);
    assertValidProfileEnvelope(meta);
    assert.deepEqual(meta.sources.map((source) => source.attachmentId), sources);
    assert.deepEqual(
      meta.details.filter((detail) => detail.agentRule === "never")
        .map((detail) => [detail.attribute, detail.variants.map((variant) => variant.value).join("|")]),
      nevers,
    );
    if (!added.length) continue;
    changed++;
    for (const key of added) keys.add(key);
    if (!opts.apply) continue;
    metaField.value = JSON.stringify(meta);
    for (const [name, value] of projectProfileEnvelope(meta).text) {
      const field = view.fields.find((item) => item.name === name);
      if (field) field.value = value;
      else view.fields.push({ name, value, type: 0 });
    }
    view.revisionDate = new Date().toISOString();
    await json(`${opts.base}/api/ciphers/${raw.id}`, {
      method: "PUT", headers,
      body: encryptedCipherToApiPayload(PureCrypto.encrypt_legacy_cipher(view, userKey), claims.sub),
    });
  }
  const appendLinh = familyMatched > 0 && !linhPresent;
  if (appendLinh && opts.apply) {
    await appendWorkspaceProfiles({
      baseUrl: opts.base, accessToken: token.access_token, userId: claims.sub, userKey,
      profilesTemplate: [models.linh],
    });
  }
  return { email, ciphers: ciphers.length, matched: familyMatched + (linhPresent ? 1 : 0), changed, keys: [...keys], appendLinh };
}

async function main() {
  const opts = argsOf(process.argv.slice(2));
  if (process.argv.includes("--self-test")) {
    const password = opts.password ?? "123456";
    const pbkdf2 = { pBKDF2: { iterations: 600000 } };
    assert.equal(
      authHashFor(password, "demo@vowkey.app", pbkdf2),
      deriveMasterPasswordAuthHash(password, "demo@vowkey.app").authHash,
      "SDK KDF path must match the seeder for PBKDF2",
    );
    console.log("self-test ok: PBKDF2 parity with seeder");
    return;
  }
  const accounts = accountsOf(opts);
  assert.ok(opts.password, "Set VOWKEY_DEMO_PASSWORD or --password");
  const family = buildTranFamilyProfiles(opts.familyDir);
  const models = {
    family: new Map(family.map((profile) => [profile.name, profile])),
    linh: buildLinhProfile(opts.linhDir),
  };
  let ok = 0;
  let failed = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(opts.concurrency, accounts.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= accounts.length) break;
      const email = accounts[index];
      try {
        const result = await updateAccount(opts, email, models);
        ok++;
        const append = result.appendLinh ? (opts.apply ? ", Linh appended" : ", would append Linh") : "";
        console.log(`${opts.apply ? "applied" : "dry-run"} ${result.email}: ciphers ${result.ciphers}, matched ${result.matched}, changed ${result.changed}${append}${result.keys.length ? ` [${result.keys.join(", ")}]` : ""}`);
      } catch (error) {
        failed++;
        console.log(`failed ${email}: ${error.message}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`${opts.apply ? "applied" : "dry-run"} accounts ${ok} ok, ${failed} failed, of ${accounts.length}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
