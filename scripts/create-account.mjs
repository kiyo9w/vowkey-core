#!/usr/bin/env node
// Creates an account on a running vowkey-server that has signups open and no mail configured.
//   node scripts/create-account.mjs http://localhost:8000 person@example.com 'master password'
// Needs the WebAssembly package: sdk/crates/vowkey-wasm-internal/build.sh
// The keys are made the way the web app makes them, with the legacy key-pair fields that the
// server stores.
import { pbkdf2Sync } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PureCrypto } = require(path.join(root, "sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js"));

const [server, email, password, acquisitionCampaign] = process.argv.slice(2);
if (!server || !email || !password) {
  console.error("usage: create-account.mjs SERVER_URL EMAIL MASTER_PASSWORD [ACQUISITION_CAMPAIGN]");
  process.exit(2);
}

const base = server.replace(/\/+$/, "");
const salt = email.trim().toLowerCase();
const text = new TextEncoder();
const kdf = { pBKDF2: { iterations: 600000 } };
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

const verification = await fetch(`${base}/identity/accounts/register/send-verification-email`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ email, name: email.split("@")[0], acquisitionCampaign }),
});
if (!verification.ok) {
  console.error(`${verification.status} ${await verification.text()}`);
  process.exit(1);
}
const emailVerificationToken = await verification.json();

const masterKey = PureCrypto.derive_kdf_material(text.encode(password), text.encode(salt), kdf);
const masterPasswordHash = b64(pbkdf2Sync(Buffer.from(masterKey), text.encode(password), 1, 32, "sha256"));
const userKey = PureCrypto.make_user_key_aes256_cbc_hmac();
const encryptedUserKey = PureCrypto.encrypt_user_key_with_master_password(userKey, password, salt, kdf);
const privateKey = PureCrypto.rsa_generate_keypair();
const publicKey = PureCrypto.rsa_extract_public_key(privateKey);
const encryptedPrivateKey = PureCrypto.symmetric_encrypt_bytes(privateKey, userKey);

const finish = await fetch(`${base}/identity/accounts/register/finish`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email,
    emailVerificationToken,
    masterPasswordHash,
    masterPasswordHint: null,
    userSymmetricKey: encryptedUserKey,
    userAsymmetricKeys: { publicKey: b64(publicKey), encryptedPrivateKey },
    kdf: 0,
    kdfIterations: kdf.pBKDF2.iterations,
  }),
});
if (!finish.ok) {
  console.error(`${finish.status} ${await finish.text()}`);
  process.exit(1);
}
console.log(`created ${email} on ${base}`);
