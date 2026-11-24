#!/usr/bin/env node
import assert from "node:assert/strict";
import { pbkdf2Sync, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(new URL("../clients/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const [server, email, password] = process.argv.slice(2);
if (!server || !email || !password) throw new Error("usage: e2e-passkey.mjs SERVER EMAIL PASSWORD");
const salt = email.trim().toLowerCase();
const masterKey = pbkdf2Sync(password, salt, 600000, 32, "sha256");
const hash = pbkdf2Sync(masterKey, password, 1, 32, "sha256").toString("base64");
const response = await fetch(`${server}/identity/connect/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "auth-email": Buffer.from(salt).toString("base64url") },
  body: new URLSearchParams({ grant_type: "password", username: salt, password: hash,
    scope: "api offline_access", client_id: "web", deviceType: "9",
    deviceIdentifier: randomUUID(), deviceName: "Passkey registration" }),
});
assert.equal(response.status, 200, "password login failed");
const accessToken = (await response.json()).access_token;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(`${server}/alive`);
  const result = await page.evaluate(async ({ accessToken, hash }) => {
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` };
    const optionsResponse = await fetch("/api/webauthn/attestation-options", {
      method: "POST", headers, body: JSON.stringify({ masterPasswordHash: hash }),
    });
    if (!optionsResponse.ok) throw new Error(`attestation options: ${optionsResponse.status}`);
    const creation = await optionsResponse.json();
    const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(creation.options) });
    const registration = await fetch("/api/webauthn", {
      method: "POST", headers, body: JSON.stringify({ deviceResponse: credential.toJSON(),
        name: "Browser sign-in regression", token: creation.token, supportsPrf: false }),
    });
    if (!registration.ok) throw new Error(`registration: ${registration.status}`);
    const row = await registration.json();
    const assertionResponse = await fetch("/identity/accounts/webauthn/assertion-options");
    if (!assertionResponse.ok) throw new Error(`assertion options: ${assertionResponse.status}`);
    const assertionOptions = await assertionResponse.json();
    const assertion = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(assertionOptions.options) });
    const body = new URLSearchParams({ grant_type: "webauthn", token: assertionOptions.token,
      deviceResponse: JSON.stringify(assertion.toJSON()), scope: "api offline_access", client_id: "web",
      deviceType: "9", deviceIdentifier: crypto.randomUUID(), deviceName: "Browser passkey sign-in" });
    const login = () => fetch("/identity/connect/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const signedIn = await login();
    if (!signedIn.ok) throw new Error(`passkey sign-in: ${signedIn.status}`);
    const session = await signedIn.json();
    const replay = await login();
    const sync = await fetch("/api/sync", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const remove = await fetch(`/api/webauthn/${row.Id ?? row.id}/delete`, {
      method: "POST", headers, body: JSON.stringify({ masterPasswordHash: hash }),
    });
    const newOptions = await (await fetch("/identity/accounts/webauthn/assertion-options")).json();
    const removedAssertion = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(newOptions.options) });
    const removedBody = new URLSearchParams(body);
    removedBody.set("token", newOptions.token);
    removedBody.set("deviceResponse", JSON.stringify(removedAssertion.toJSON()));
    const removedLogin = await fetch("/identity/connect/token", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: removedBody });
    return { registration: registration.status, login: signedIn.status, sync: sync.status,
      passwordFallback: typeof session.Key === "string" && !session.UserDecryptionOptions?.WebAuthnPrfOption,
      replayRejected: !replay.ok, removed: remove.ok, revokedCredentialRejected: !removedLogin.ok };
  }, { accessToken, hash });
  assert.deepEqual(result, { registration: 200, login: 200, sync: 200,
    passwordFallback: true, replayRejected: true, removed: true, revokedCredentialRejected: true });
  console.log("Browser passkey registration, sign-in, password fallback, replay rejection and revocation passed");
} finally {
  await browser.close();
}
