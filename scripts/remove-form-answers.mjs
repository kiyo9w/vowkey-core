#!/usr/bin/env node
// Removes saved details that only exist to answer a form (reasons, notes, request records, an account's stated purpose)
// from the seeded demo accounts. Facts about a person and their household stay. Dry run unless --apply is given.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VK_META_FIELD, assertValidProfileEnvelope, projectProfileEnvelope } from "./demoday-family-dataset.mjs";
import { encryptedCipherToApiPayload, normalizeServerCipherForWasm } from "./seed-demoday-pool.mjs";
import { unlockSeedAccount } from "./update-demoday-family-fields.mjs";

const require = createRequire(import.meta.url);
const { PureCrypto } = require("../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js");

const FORM_ANSWERS = new Set(["bank.account.purpose", "residence.request.office", "residence.change.request"]);
const LINH_ONLY = new Set(["household.head.name", "household.relationship"]);
const isFormAnswer = (attribute, profileName) =>
  FORM_ANSWERS.has(attribute) || attribute?.startsWith("residence_change.") ||
  (profileName === "Nguyễn Thị Linh" && LINH_ONLY.has(attribute));

const arg = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const base = (arg("--base-url") ?? "https://vault.vowkey.app").replace(/\/$/, "");
const password = process.env.VOWKEY_DEMO_PASSWORD;
const publicEmail = "demo@vowkey.app";
const apply = process.argv.includes("--apply");
const emails = [];
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === "--email") emails.push(process.argv[++i]);
if (process.argv.includes("--presenter")) emails.push("presenter@vowkey.app");
const pool = Number(arg("--pool") ?? 0);
const [pubLocal, pubDomain] = publicEmail.split("@");
for (let n = 1; n <= pool; n++) emails.push(`${pubLocal}+p${String(n).padStart(4, "0")}@${pubDomain}`);
if (!password || !emails.length) throw new Error("Set VOWKEY_DEMO_PASSWORD and pass --email, --presenter or --pool N.");

const saltFor = (email) => (email.startsWith(`${pubLocal}+p`) && email.endsWith(`@${pubDomain}`) ? publicEmail : email);

async function clean(email) {
  const { claims, userKey, headers } = await unlockSeedAccount({ base, email, password, salt: saltFor(email) });
  const response = await fetch(`${base}/api/sync`, { headers });
  if (!response.ok) throw new Error(`sync HTTP ${response.status}`);
  const sync = await response.json();
  const removed = [];
  for (const raw of sync.ciphers ?? []) {
    const view = PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(raw), userKey);
    const metaField = view.fields?.find((field) => field.name === VK_META_FIELD);
    if (!metaField?.value) continue;
    const meta = JSON.parse(metaField.value);
    const gone = meta.details.filter((detail) => isFormAnswer(detail.attribute, view.name));
    if (!gone.length) continue;
    removed.push(`${view.name}: ${gone.map((detail) => detail.attribute).join(", ")}`);
    if (!apply) continue;
    const before = new Set(projectProfileEnvelope(meta).text.keys());
    meta.details = meta.details.filter((detail) => !gone.includes(detail));
    assertValidProfileEnvelope(meta);
    const after = new Set(projectProfileEnvelope(meta).text.keys());
    metaField.value = JSON.stringify(meta);
    view.fields = view.fields.filter((field) => !(before.has(field.name) && !after.has(field.name)));
    view.revisionDate = new Date().toISOString();
    const put = await fetch(`${base}/api/ciphers/${raw.id}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(encryptedCipherToApiPayload(PureCrypto.encrypt_legacy_cipher(view, userKey), claims.sub)),
    });
    if (!put.ok) throw new Error(`PUT ${view.name}: HTTP ${put.status}`);
  }
  return removed;
}

let failed = 0;
let cursor = 0;
const results = [];
await Promise.all(Array.from({ length: Math.min(6, emails.length) }, async () => {
  while (cursor < emails.length) {
    const email = emails[cursor++];
    try { results.push([email, await clean(email)]); } catch (error) { failed++; results.push([email, [`failed: ${error.message}`]]); }
  }
}));
for (const [email, lines] of results.sort()) console.log(`${apply ? "applied" : "dry-run"} ${email}${lines.length ? "\n  " + lines.join("\n  ") : ": nothing to remove"}`);
console.log(`${results.length} accounts, ${failed} failed`);
if (failed) process.exitCode = 1;
