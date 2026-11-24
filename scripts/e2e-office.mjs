#!/usr/bin/env node
// Office sign-in end-to-end harness. Run through scripts/e2e-office.sh, which starts a fresh
// Keycloak (two synthetic realms: "workforce" is the real SAML identity provider, "office"
// brokers to it and serves Vowkey over OIDC) and a fresh vowkey-server with SSO pointed at
// the office realm.
//
//   node scripts/e2e-office.mjs SERVER KEYCLOAK WORKDIR ADMIN_TOKEN
//
// What it proves, in order:
//   1. the Keycloak fixture really brokers SAML: the staff member signs in at the workforce
//      realm, Keycloak returns a signed SAML response, the office realm issues an OIDC code,
//      and the server exchanges it (SSO_AUTHORIZE_EXTRA_PARAMS=kc_idp_hint=workforce)
//   2. the SSO login needs no master password (UserDecryptionOptions.HasMasterPassword=false)
//   3. SCIM directory sync over the organization API key bearer: ServiceProviderConfig,
//      create/list/filter/get, PUT update, PATCH deactivate/reactivate, group create/delete,
//      DELETE user, and the denials: no bearer 401, foreign key 404, non-Office org 403
//   4. device key registration (PUT /devices/<id>/keys) wraps the user key to the device
//      public key; the server stores only wrapped keys (checked in the SQLite database)
//   5. a pending auth request from a second, untrusted device; approval by the person's
//      other device (PUT /auth-requests/<id>) and by an organization admin
//      (POST /organizations/<org>/auth-requests/<id>); the new device then logs in with the
//      auth request instead of a master password and decrypts a synthetic vault item with
//      the user key it recovered from the wrapped key
//
// All keys are made with the real SDK (sdk/crates/vowkey-wasm-internal), the same calls the
// apps make; nothing is stubbed.

import assert from "node:assert/strict";
import { createHash, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { browseLogin } from "./lib/office-sso.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { PureCrypto } = require(path.join(root, "sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js"));

const [server, keycloak, workdir, adminToken] = process.argv.slice(2);
if (!server || !keycloak || !workdir || !adminToken) {
  throw new Error("usage: e2e-office.mjs SERVER KEYCLOAK WORKDIR ADMIN_TOKEN");
}
const kcAdminUser = process.env.KEYCLOAK_ADMIN_USERNAME ?? "admin";
const kcAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? "admin";
const officeRealm = process.env.OFFICE_REALM ?? "office";
const idpHint = process.env.OFFICE_IDP_HINT ?? "workforce";
const base = server.replace(/\/+$/, "");
const kc = keycloak.replace(/\/+$/, "");
const serverOrigin = new URL(base).origin;
const kcOrigin = new URL(kc).origin;
const database = path.join(workdir, "office.sqlite3");

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const text = new TextEncoder();

async function api(pathname, { token, body, method, headers = {}, raw } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  return response;
}

async function json(response, what) {
  assert.equal(response.status, 200, `${what}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

async function form(url, params, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(params),
  });
}

async function keycloakAdminToken() {
  const response = await form(`${kc}/realms/master/protocol/openid-connect/token`, {
    grant_type: "password",
    client_id: "admin-cli",
    username: kcAdminUser,
    password: kcAdminPassword,
  });
  assert.equal(response.status, 200, `keycloak admin login: ${await response.clone().text()}`);
  return (await response.json()).access_token;
}

async function kcAdmin(admin, method, path, body) {
  const response = await fetch(`${kc}/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${admin}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}

const checked = [];
function pass(label) {
  checked.push(label);
  console.log(`  ok ${label}`);
}

// ---------------------------------------------------------------------------
// 1. The Keycloak fixture: a real SAML identity provider behind the office realm
// ---------------------------------------------------------------------------
console.log("keycloak fixture");
{
  const admin = await keycloakAdminToken();
  const discovery = await fetch(`${kc}/realms/${officeRealm}/.well-known/openid-configuration`);
  assert.equal(discovery.status, 200, "office realm discovery");
  const idps = await (await kcAdmin(admin, "GET", `/realms/${officeRealm}/identity-provider/instances`)).json();
  const samlIdp = idps.find((idp) => idp.alias === idpHint);
  assert.ok(samlIdp, `the ${officeRealm} realm must broker to the ${idpHint} SAML identity provider`);
  assert.ok(
    samlIdp.config.singleSignOnServiceUrl.startsWith(`${kc}/realms/`),
    `the IdP SSO URL must be resolved (${samlIdp.config.singleSignOnServiceUrl}), not a raw placeholder`,
  );
  assert.equal(samlIdp.config.validateSignature, "true", "SAML responses must be signature-validated");
  const descriptor = await fetch(`${kc}/realms/workforce/protocol/saml/descriptor`);
  assert.equal(descriptor.status, 200, "the workforce realm publishes a real SAML IdP descriptor");
  assert.match(await descriptor.text(), /IDPSSODescriptor/, "IdP metadata");

  // The vowkey OIDC client must accept this server's callback URL.
  const clients = await (await kcAdmin(admin, "GET", `/realms/${officeRealm}/clients?clientId=vowkey`)).json();
  assert.equal(clients.length, 1, "one vowkey OIDC client in the office realm");
  const update = await kcAdmin(admin, "PUT", `/realms/${officeRealm}/clients/${clients[0].id}`, {
    ...clients[0],
    redirectUris: [`${base}/identity/connect/oidc-signin`],
  });
  assert.ok(update.status < 300, `set the vowkey client redirect URI: ${update.status}`);
  pass("office realm brokers to the workforce SAML IdP; vowkey client redirect set");
}

// ---------------------------------------------------------------------------
// 2. Owner account, office organization, Office plan, organization API key
// ---------------------------------------------------------------------------
console.log("owner account and office organization");
const ownerEmail = "owner@vowkey.test";
const ownerPassword = "office owner master password 1";
const salt = ownerEmail;
const kdf = { pBKDF2: { iterations: 600000 } };
const masterKey = PureCrypto.derive_kdf_material(text.encode(ownerPassword), text.encode(salt), kdf);
const ownerHash = b64(pbkdf2Sync(Buffer.from(masterKey), text.encode(ownerPassword), 1, 32, "sha256"));

async function register(email, password) {
  const verification = await fetch(`${base}/identity/accounts/register/send-verification-email`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, name: email.split("@")[0] }),
  });
  assert.equal(verification.status, 200, `send verification email: ${await verification.clone().text()}`);
  const emailVerificationToken = await verification.json();
  const localSalt = email.trim().toLowerCase();
  const localMasterKey = PureCrypto.derive_kdf_material(text.encode(password), text.encode(localSalt), kdf);
  const hash = b64(pbkdf2Sync(Buffer.from(localMasterKey), text.encode(password), 1, 32, "sha256"));
  const userKey = PureCrypto.make_user_key_aes256_cbc_hmac();
  const encryptedUserKey = PureCrypto.encrypt_user_key_with_master_password(userKey, password, localSalt, kdf);
  const privateKey = PureCrypto.rsa_generate_keypair();
  const publicKey = PureCrypto.rsa_extract_public_key(privateKey);
  const encryptedPrivateKey = PureCrypto.symmetric_encrypt_bytes(privateKey, userKey);
  const finish = await fetch(`${base}/identity/accounts/register/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      emailVerificationToken,
      masterPasswordHash: hash,
      masterPasswordHint: null,
      userSymmetricKey: encryptedUserKey,
      userAsymmetricKeys: { publicKey: b64(publicKey), encryptedPrivateKey },
      kdf: 0,
      kdfIterations: kdf.pBKDF2.iterations,
    }),
  });
  assert.equal(finish.status, 200, `register finish: ${await finish.clone().text()}`);
  return { userKey, privateKey, publicKey, hash };
}

async function passwordLogin(email, password, hash, deviceIdentifier, deviceName, deviceType = "9") {
  const response = await form(`${base}/identity/connect/token`, {
    grant_type: "password",
    username: email,
    password: hash,
    scope: "api offline_access",
    client_id: "web",
    deviceType,
    deviceIdentifier,
    deviceName,
  });
  assert.equal(response.status, 200, `password login: ${await response.clone().text()}`);
  const body = await response.json();
  return { token: body.access_token, device: deviceIdentifier, body };
}

const owner = await register(ownerEmail, ownerPassword);
const ownerLogin = await passwordLogin(ownerEmail, ownerPassword, ownerHash, randomUUID(), "office harness owner");
const ownerToken = ownerLogin.token;
const ownerUuid = JSON.parse(Buffer.from(ownerToken.split(".")[1], "base64url").toString()).sub;
pass("owner account registered and logged in");

// Organization with a real key pair, the way the web vault creates one.
const orgKey = PureCrypto.make_aes256_cbc_hmac_key();
const orgPrivateKey = PureCrypto.rsa_generate_keypair();
const orgPublicKey = PureCrypto.rsa_extract_public_key(orgPrivateKey);
const org = await json(
  await api("/api/organizations", {
    token: ownerToken,
    body: {
      name: "Tsubame Cloud Office",
      billingEmail: ownerEmail,
      collectionName: "Engineering",
      key: PureCrypto.symmetric_encrypt_bytes(Buffer.from(orgKey, "base64"), owner.userKey),
      keys: { publicKey: b64(orgPublicKey), encryptedPrivateKey: PureCrypto.symmetric_encrypt_bytes(orgPrivateKey, Buffer.from(orgKey, "base64")) },
      planType: 0,
    },
  }),
  "create organization",
);
const orgId = org.id;

// A second organization stays on the free plan, for the entitlement denials.
const org2 = await json(
  await api("/api/organizations", {
    token: ownerToken,
    body: {
      name: "Free test org",
      billingEmail: ownerEmail,
      collectionName: "Default",
      key: PureCrypto.symmetric_encrypt_bytes(Buffer.from(orgKey, "base64"), owner.userKey),
      planType: 0,
    },
  }),
  "create free organization",
);
const org2Id = org2.id;

// Grant the office plan through the admin panel, as the owner does for free adoption.
const adminLogin = await form(`${base}/admin/`, { token: adminToken });
assert.equal(adminLogin.status, 200, `admin login: ${adminLogin.status}`);
const adminCookie = adminLogin.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
const grant = await api(`/admin/organizations/${orgId}/plan`, {
  method: "POST",
  headers: { cookie: adminCookie },
  body: { plan_code: "office", quantity: 3, status: "trialing" },
});
assert.equal(grant.status, 200, `grant office plan: ${grant.status} ${await grant.clone().text()}`);
assert.equal((await grant.json()).basePlan, "office");
pass("office plan granted to the organization through the admin panel");

// The organization API key, used as the SCIM bearer.
const apiKeyResponse = await json(
  await api(`/api/organizations/${orgId}/api-key`, { token: ownerToken, body: { masterPasswordHash: ownerHash } }),
  "organization api key",
);
const orgApiKey = apiKeyResponse.apiKey;
// The raw SCIM bearer is "<org-uuid>.<secret>"; the endpoint returns only the secret.
const orgRawKey = `${orgId}.${orgApiKey}`;
const org2ApiKey = (
  await json(await api(`/api/organizations/${org2Id}/api-key`, { token: ownerToken, body: { masterPasswordHash: ownerHash } }), "second org api key")
).apiKey;
const org2RawKey = `${org2Id}.${org2ApiKey}`;
// The same credential as an access token, the way a client_credentials client uses it.
const cc = await form(`${base}/identity/connect/token`, {
  grant_type: "client_credentials",
  client_id: `organization.${orgId}`,
  client_secret: orgApiKey,
  scope: "api.organization",
});
assert.equal(cc.status, 200, `client_credentials login: ${await cc.clone().text()}`);
const orgApiToken = (await cc.json()).access_token;
pass("organization API key issued (raw key and client_credentials token)");

const scim = (p, { bearer = orgRawKey, method, body } = {}) =>
  api(`/api/organizations/${orgId}/scim/v2${p}`, {
    token: bearer,
    method,
    body,
    headers: { accept: "application/scim+json" },
  });

// ---------------------------------------------------------------------------
// 3. SCIM directory sync over the organization API key
// ---------------------------------------------------------------------------
console.log("scim directory sync");
{
  assert.equal((await scim("/ServiceProviderConfig", { bearer: null, method: "GET" })).status, 401, "no bearer");
  assert.equal((await scim("/Users", { bearer: "not-a-key", method: "GET" })).status, 401, "garbage bearer");
  const foreign = await api(`/api/organizations/${orgId}/scim/v2/Users`, {
    token: org2RawKey,
    headers: { accept: "application/scim+json" },
  });
  assert.equal(foreign.status, 404, `another organization's key must not reach this org (${foreign.status})`);
  pass("unauthenticated and foreign bearers denied");

  const config = await json(await scim("/ServiceProviderConfig"), "ServiceProviderConfig");
  assert.equal(config.patch.supported, true);
  assert.equal(config.filter.supported, true);
  pass("ServiceProviderConfig advertises patch and filter");

  const nonOffice = await api(`/api/organizations/${org2Id}/scim/v2/Users`, {
    token: org2RawKey,
    headers: { accept: "application/scim+json" },
  });
  assert.equal(nonOffice.status, 403, `a non-Office organization must get 403 (${nonOffice.status})`);
  assert.match(await nonOffice.clone().text(), /Office plan/);
  pass("non-Office organization denied with 403");

  const staffEmail = "staff@office.example";
  const created = await scim("/Users", {
    method: "POST",
    body: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: staffEmail,
      externalId: "E-1042",
      active: true,
      emails: [{ value: staffEmail, type: "work", primary: true }],
    },
  });
  assert.equal(created.status, 201, `SCIM create user: ${created.status} ${await created.clone().text()}`);
  const staff = await created.json();
  assert.equal(staff.userName, staffEmail);
  assert.equal(staff.externalId, "E-1042");
  const colleagueResponse = await scim("/Users", {
    method: "POST",
    body: {
      userName: "colleague@office.example",
      externalId: "E-2077",
      active: true,
      emails: [{ value: "colleague@office.example", type: "work", primary: true }],
    },
  });
  assert.equal(colleagueResponse.status, 201, `SCIM create second user: ${colleagueResponse.status}`);
  const colleague = await colleagueResponse.json();

  const list = await json(await scim("/Users"), "SCIM list users");
  assert.equal(list.totalResults, 3, "owner plus the two provisioned users");
  const filtered = await json(await scim(`/Users?filter=${encodeURIComponent(`userName eq "${staffEmail}"`)}`), "SCIM filtered list");
  assert.equal(filtered.totalResults, 1);
  assert.equal(filtered.Resources[0].id, staff.id);
  const fetched = await json(await scim(`/Users/${staff.id}`), "SCIM get user");
  assert.equal(fetched.active, true);
  pass("provision, list, filter and get users");

  // Update: change the external id, keep the member active.
  const updated = await json(
    await scim(`/Users/${colleague.id}`, {
      method: "PUT",
      body: { userName: "colleague@office.example", externalId: "E-2077b", active: true, emails: [{ value: "colleague@office.example", primary: true }] },
    }),
    "SCIM PUT user",
  );
  assert.equal(updated.externalId, "E-2077b");
  // Deactivate through PATCH, as Entra does.
  const patched = await scim(`/Users/${colleague.id}`, {
    method: "PATCH",
    body: { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] },
  });
  assert.equal(patched.status, 204, `SCIM PATCH deactivate: ${patched.status}`);
  assert.equal((await json(await scim(`/Users/${colleague.id}`), "get deactivated user")).active, false);
  // Reactivate through PUT.
  await json(
    await scim(`/Users/${colleague.id}`, {
      method: "PUT",
      body: { userName: "colleague@office.example", externalId: "E-2077b", active: true, emails: [{ value: "colleague@office.example", primary: true }] },
    }),
    "SCIM PUT reactivate",
  );
  assert.equal((await json(await scim(`/Users/${colleague.id}`), "get reactivated user")).active, true);
  pass("update, deactivate (PATCH) and reactivate (PUT) a user");

  // The client_credentials token is accepted as the bearer as well.
  const viaToken = await json(await scim("/Users", { bearer: orgApiToken }), "SCIM list with the api key token");
  assert.ok(viaToken.totalResults >= 3);
  pass("the organization API key token works as the SCIM bearer too");

  // Groups.
  const group = await scim("/Groups", {
    method: "POST",
    body: { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "Engineering", externalId: "dept-engineering", members: [{ value: staff.id }] },
  });
  assert.equal(group.status, 201, `SCIM create group: ${group.status} ${await group.clone().text()}`);
  const createdGroup = await group.json();
  const groupGet = await json(await scim(`/Groups/${createdGroup.id}`), "SCIM get group");
  assert.equal(groupGet.displayName, "Engineering");
  assert.deepEqual(groupGet.members.map((member) => member.value), [staff.id]);
  const groups = await json(await scim("/Groups"), "SCIM list groups");
  assert.equal(groups.totalResults, 1);
  const groupPatch = await scim(`/Groups/${createdGroup.id}`, {
    method: "PATCH",
    body: { Operations: [{ op: "add", path: "members", value: [{ value: colleague.id }] }] },
  });
  assert.equal(groupPatch.status, 204, `SCIM PATCH group members: ${groupPatch.status}`);
  assert.equal((await json(await scim(`/Groups/${createdGroup.id}`), "SCIM get group after patch")).members.length, 2);
  const groupDelete = await scim(`/Groups/${createdGroup.id}`, { method: "DELETE" });
  assert.equal(groupDelete.status, 204);
  assert.equal((await scim(`/Groups/${createdGroup.id}`, { method: "GET" })).status, 404);
  pass("create, read, patch and delete a group");

  // Deprovision the second user.
  const deleted = await scim(`/Users/${colleague.id}`, { method: "DELETE" });
  assert.equal(deleted.status, 204);
  assert.equal((await scim(`/Users/${colleague.id}`, { method: "GET" })).status, 404);
  pass("deprovision (DELETE) a user");

  // Deactivate and reprovision the staff member, so the membership reaches Accepted and the
  // owner can confirm it (the admin approval path requires a confirmed member).
  await scim(`/Users/${staff.id}`, { method: "PUT", body: { userName: staffEmail, externalId: "E-1042", active: false, emails: [{ value: staffEmail, primary: true }] } });
  await json(await scim(`/Users/${staff.id}`, { method: "PUT", body: { userName: staffEmail, externalId: "E-1042", active: true, emails: [{ value: staffEmail, primary: true }] } }), "reprovision staff");
  pass("staff member deprovisioned and reprovisioned");
}

// ---------------------------------------------------------------------------
// 4. SSO sign-in of the staff member through the real SAML IdP, no master password
// ---------------------------------------------------------------------------
console.log("sso sign-in through keycloak saml");
const staffEmail = "staff@office.example";
const staffPassword = "staff";

async function ssoLogin({ deviceIdentifier, deviceName, deviceType = "14" }) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  // A callback origin the driver does not follow, so the chain stops there and hands back
  // the code, exactly where the real client would receive it.
  const callback = "https://office-e2e.invalid/callback";
  const authorizeUrl = `${base}/identity/connect/authorize?${new URLSearchParams({
    client_id: "web",
    redirect_uri: callback,
    response_type: "code",
    scope: "api offline_access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  })}`;

  // The provider chain, driven as a browser: server -> office realm -> workforce SAML IdP
  // (signed SAML response) -> back to the server callback -> the client callback.
  const { location } = await browseLogin(authorizeUrl, {
    profile: { username: staffEmail, password: staffPassword, email: staffEmail, firstName: "Kim", lastName: "Tran" },
    follow: [serverOrigin, kcOrigin],
  });
  assert.ok(location.pathname.endsWith("/sso-connector.html"), `the chain ended at the vault SSO connector: ${location}`);
  const code = location.searchParams.get("code");

  const tokenResponse = await form(`${base}/identity/connect/token`, {
    grant_type: "authorization_code",
    client_id: "web",
    code,
    code_verifier: verifier,
    scope: "api offline_access",
    deviceIdentifier,
    deviceName,
    deviceType,
  });
  assert.equal(tokenResponse.status, 200, `sso token exchange: ${await tokenResponse.clone().text()}`);
  const body = await tokenResponse.json();
  return { token: body.access_token, body, deviceIdentifier };
}

const deviceA = await ssoLogin({ deviceIdentifier: randomUUID(), deviceName: "office harness device A" });
assert.equal(deviceA.body.UserDecryptionOptions.HasMasterPassword, false, "the SSO-provisioned staff member has no master password");
assert.ok(deviceA.token, "access token issued");
const staffUuid = JSON.parse(Buffer.from(deviceA.token.split(".")[1], "base64url").toString()).sub;
pass("staff signed in through the workforce SAML IdP with no master password");

// The free organization cannot use single sign-on.
{
  const policy = await api(`/api/organizations/${org2Id}/policies/master-password`, { token: ownerToken });
  assert.notEqual(policy.status, 200);
  assert.match(await policy.clone().text(), /Office plan/);
  pass("single sign-on policy denied for the non-Office organization");
}

// The staff member's client creates its user key and trusts this device with a device key.
const userKey = PureCrypto.make_user_key_aes256_cbc_hmac();
const deviceAKey = PureCrypto.make_aes256_cbc_hmac_key();
const deviceAKeyBytes = Buffer.from(deviceAKey, "base64");
const deviceAPrivateKey = PureCrypto.rsa_generate_keypair();
const deviceAPublicKey = PureCrypto.rsa_extract_public_key(deviceAPrivateKey);

async function registerDeviceKeys(token, device, { privateKey, publicKey, userKeyBytes, deviceKeyBytes }) {
  return api(`/api/devices/${device}/keys`, {
    token,
    method: "PUT",
    body: {
      encryptedPublicKey: PureCrypto.wrap_encapsulation_key(publicKey, userKeyBytes),
      encryptedUserKey: PureCrypto.encapsulate_key_unsigned(userKeyBytes, publicKey),
      encryptedPrivateKey: PureCrypto.wrap_decapsulation_key(privateKey, deviceKeyBytes),
    },
  });
}

const trustA = await json(
  await registerDeviceKeys(deviceA.token, deviceA.deviceIdentifier, {
    privateKey: deviceAPrivateKey,
    publicKey: deviceAPublicKey,
    userKeyBytes: userKey,
    deviceKeyBytes,
  }),
  "device key registration (device A)",
);
assert.equal(trustA.isTrusted, true);
pass("device A registered its device key pair (trusted device)");

// An untrusted device does not get the wrapped keys back.
const deviceB0 = randomUUID();
const retrieveUntrusted = await json(
  await api(`/api/devices/${deviceB0}/retrieve-keys`, { token: deviceA.token, method: "POST" }),
  "retrieve-keys for an untrusted device",
);
assert.equal(retrieveUntrusted.encryptedUserKey, null);
const retrieveTrusted = await json(
  await api(`/api/devices/${deviceA.deviceIdentifier}/retrieve-keys`, { token: deviceA.token, method: "POST" }),
  "retrieve-keys for the trusted device",
);
assert.ok(retrieveTrusted.encryptedUserKey?.startsWith("4."), "the trusted device gets its wrapped user key");
pass("retrieve-keys returns wrapped keys only to a trusted device");

// A synthetic vault item, encrypted with the user key the way the apps encrypt items.
const secretName = "Office vault item";
const secretPassword = "correct horse battery staple";
const cipherResponse = await json(
  await api("/api/ciphers", {
    token: deviceA.token,
    body: {
      type: 1,
      name: PureCrypto.symmetric_encrypt_string(secretName, userKey),
      notes: null,
      login: {
        username: PureCrypto.symmetric_encrypt_string("kim.tran@tsubame.example", userKey),
        password: PureCrypto.symmetric_encrypt_string(secretPassword, userKey),
        totp: null,
        uris: [{ uri: PureCrypto.symmetric_encrypt_string("https://intranet.tsubame.example", userKey), match: null }],
      },
      folderId: null,
      organizationId: null,
      collectionIds: [],
      favorite: false,
      reprompt: 0,
      encryptedFor: staffUuid,
    },
  }),
  "create synthetic vault item",
);
const cipherId = cipherResponse.id;
pass("synthetic vault item stored, encrypted with the user key");

// The server only ever stores wrapped keys.
{
  const db = new DatabaseSync(database);
  try {
    const device = db.prepare("SELECT encrypted_user_key, encrypted_public_key, encrypted_private_key FROM devices WHERE uuid = ?").get(deviceA.deviceIdentifier);
    assert.ok(device.encrypted_user_key?.startsWith("4."), "devices.encrypted_user_key is the RSA-wrapped user key");
    assert.notEqual(device.encrypted_user_key, b64(userKey), "the plaintext user key is not stored");
    assert.ok(device.encrypted_public_key?.startsWith("2."), "devices.encrypted_public_key is the user-key-wrapped device public key");
    assert.ok(device.encrypted_private_key?.startsWith("2."), "devices.encrypted_private_key is the device-key-wrapped private key");
  } finally {
    db.close();
  }
  pass("the server stores only wrapped device keys, never the plaintext user key");
}

// Confirm the staff member in the organization, as the owner does after reprovisioning.
{
  const members = await json(await api(`/api/organizations/${orgId}/users`, { token: ownerToken }), "list org users");
  const staffMember = members.data.find((member) => member.email === staffEmail);
  assert.ok(staffMember, "the SCIM-provisioned staff member is in the organization");
  const confirm = await api(`/api/organizations/${orgId}/users/${staffMember.id}/confirm`, {
    token: ownerToken,
    body: { key: PureCrypto.symmetric_encrypt_bytes(userKey, Buffer.from(orgKey, "base64")) },
  });
  assert.equal(confirm.status, 200, `confirm member: ${confirm.status} ${await confirm.clone().text()}`);
  pass("owner confirmed the reprovisioned staff member");
}

// ---------------------------------------------------------------------------
// 5. A new device: pending auth request, person approval, passwordless login, decrypt
// ---------------------------------------------------------------------------
console.log("trusted-device approval on a new device");
const deviceB = await ssoLogin({ deviceIdentifier: randomUUID(), deviceName: "office harness device B" });
assert.equal(deviceB.body.UserDecryptionOptions.HasMasterPassword, false);
const deviceBPrivateKey = PureCrypto.rsa_generate_keypair();
const deviceBPublicKey = PureCrypto.rsa_extract_public_key(deviceBPrivateKey);
pass("device B signed in through SSO as well, also without a master password");

const accessCode = randomBytes(18).toString("base64url");
const authRequest = await json(
  await api("/api/auth-requests", {
    method: "POST",
    headers: { "device-type": "14", accept: "application/json" },
    body: {
      accessCode,
      deviceIdentifier: deviceB.deviceIdentifier,
      email: staffEmail,
      publicKey: b64(deviceBPublicKey),
    },
  }),
  "create auth request (device B)",
);
const requestId = authRequest.id;
assert.equal(authRequest.requestApproved, false);
pass("device B created a pending auth request");

const pending = await json(await api("/api/auth-requests/pending", { token: deviceA.token }), "pending auth requests");
assert.ok(pending.data.some((request) => request.id === requestId), "device A sees the pending request");
pass("the pending auth request is listed for the person's other device");

// The person approves from device A: the user key wrapped to device B's public key.
const wrappedForB = PureCrypto.encapsulate_key_unsigned(userKey, deviceBPublicKey);
const approval = await json(
  await api(`/api/auth-requests/${requestId}`, {
    token: deviceA.token,
    method: "PUT",
    body: { deviceIdentifier: deviceA.deviceIdentifier, key: wrappedForB, masterPasswordHash: null, requestApproved: true },
  }),
  "person approval (device A)",
);
assert.equal(approval.requestApproved, true);
assert.equal(approval.key, wrappedForB);
pass("the person approved the request from their trusted device");

{
  const db = new DatabaseSync(database);
  try {
    const row = db.prepare("SELECT enc_key, approved FROM auth_requests WHERE uuid = ?").get(requestId);
    assert.equal(row.enc_key, wrappedForB, "the stored key is the wrapped user key");
    assert.notEqual(row.enc_key, b64(userKey));
    assert.equal(row.approved, 1);
  } finally {
    db.close();
  }
  pass("the server stored the wrapped key only (checked in the database)");
}

// Device B polls the response with its access code, then logs in with the auth request
// instead of a master password.
const response = await json(
  await api(`/api/auth-requests/${requestId}/response?code=${encodeURIComponent(accessCode)}`, {
    headers: { "device-type": "14" },
  }),
  "auth request response (device B)",
);
assert.equal(response.requestApproved, true);
assert.equal(response.key, wrappedForB);

const deviceBLogin = await form(`${base}/identity/connect/token`, {
  grant_type: "password",
  username: staffEmail,
  password: accessCode,
  authRequest: requestId,
  scope: "api offline_access",
  client_id: "web",
  deviceIdentifier: deviceB.deviceIdentifier,
  deviceName: "office harness device B",
  deviceType: "14",
});
assert.equal(deviceBLogin.status, 200, `login with the approved auth request, no master password: ${await deviceBLogin.clone().text()}`);
pass("device B logged in with the approved auth request (no master password)");

// The wrapped key decrypts the user key, and the user key decrypts the vault item.
const recoveredUserKey = PureCrypto.decapsulate_key_unsigned(response.key, deviceBPrivateKey);
assert.ok(Buffer.from(recoveredUserKey).equals(Buffer.from(userKey)), "the wrapped key decrypted to the user key");
const decryptedName = PureCrypto.symmetric_decrypt_string(cipherResponse.name, recoveredUserKey);
const decryptedPassword = PureCrypto.symmetric_decrypt_string(cipherResponse.login.password, recoveredUserKey);
assert.equal(decryptedName, secretName);
assert.equal(decryptedPassword, secretPassword);
pass("the wrapped key from the approval decrypted the synthetic vault item");

// ---------------------------------------------------------------------------
// 6. Admin approval by the organization admin, and its Office gate
// ---------------------------------------------------------------------------
console.log("admin approval");
{
  const accessCode2 = randomBytes(18).toString("base64url");
  const second = await json(
    await api("/api/auth-requests", {
      method: "POST",
      headers: { "device-type": "14" },
      body: { accessCode: accessCode2, deviceIdentifier: deviceB.deviceIdentifier, email: staffEmail, publicKey: b64(deviceBPublicKey) },
    }),
    "second auth request",
  );
  const adminApproval = await api(`/api/organizations/${orgId}/auth-requests/${second.id}`, {
    token: ownerToken,
    body: { encryptedUserKey: PureCrypto.encapsulate_key_unsigned(userKey, deviceBPublicKey), requestApproved: true },
  });
  assert.equal(adminApproval.status, 200, `admin approval: ${adminApproval.status} ${await adminApproval.clone().text()}`);
  const adminResponse = await json(
    await api(`/api/auth-requests/${second.id}/response?code=${encodeURIComponent(accessCode2)}`, { headers: { "device-type": "14" } }),
    "admin-approved response",
  );
  assert.equal(adminResponse.requestApproved, true);
  assert.ok(Buffer.from(PureCrypto.decapsulate_key_unsigned(adminResponse.key, deviceBPrivateKey)).equals(Buffer.from(userKey)));
  pass("an organization admin approved the request and the new device decrypted the key");

  // The same call on the free organization is denied.
  const denied = await api(`/api/organizations/${org2Id}/auth-requests/${second.id}`, {
    token: ownerToken,
    body: { encryptedUserKey: "x", requestApproved: true },
  });
  assert.equal(denied.status, 403, `admin approval on a non-Office org must be 403 (${denied.status})`);
  pass("admin approval denied for the non-Office organization");
}

console.log(`office e2e passed: ${checked.join("; ")}`);
