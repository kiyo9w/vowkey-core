#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLinhProfile } from "./linh-profile.mjs";
import { appendWorkspaceProfiles, ensureAccountAndLogin, normalizeServerCipherForWasm } from "./seed-demoday-pool.mjs";

const root = path.join(homedir(), "Documents/Projects/vowkey/Demo/live/linh");
const require = createRequire(import.meta.url);
const { PureCrypto } = require("../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js");


async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;
  const profile = buildLinhProfile(value("--directory") ?? root);
  if (!args.includes("--import")) {
    console.log(JSON.stringify({ name: profile.name, details: profile.meta.details.length, documents: profile.attachments.length, valid: true }));
    return;
  }
  const baseUrl = value("--server")?.replace(/\/$/, "");
  const accountEmail = value("--email");
  const password = process.env.VOWKEY_IMPORT_PASSWORD;
  if (!baseUrl || !accountEmail || !password) {
    throw new Error("Use --import --server URL --email EMAIL with VOWKEY_IMPORT_PASSWORD set. Existing vault items are never deleted.");
  }
  const auth = await ensureAccountAndLogin({ baseUrl, accountEmail, saltEmail: accountEmail, displayName: "Vowkey demo rehearsal", password });
  const response = await fetch(`${baseUrl}/api/sync`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  if (!response.ok) throw new Error(`Could not inspect the destination vault (${response.status}).`);
  const sync = await response.json();
  const exists = (sync.ciphers ?? []).some((cipher) =>
    PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(cipher), auth.userKey).name === profile.name,
  );
  if (exists) throw new Error("This vault already contains Linh. Nothing was changed; review that profile in Vowkey.");
  await appendWorkspaceProfiles({ baseUrl, ...auth, profilesTemplate: [profile] });
  console.log(`Added ${profile.name}: ${profile.meta.details.length} details, ${profile.attachments.length} encrypted originals. Existing items unchanged.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
