import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createHttp, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createRelay, loadConfig } from "../relay.mjs";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keys = mkdtempSync(join(tmpdir(), "vowkey-push-keys-"));
const apnsKey = join(keys, "apns.p8");
const fcmKey = join(keys, "fcm.json");
writeFileSync(apnsKey, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(fcmKey, JSON.stringify({
  type: "service_account", project_id: "vowkey-test", private_key_id: "test",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }),
  client_email: "push@vowkey-test.iam.gserviceaccount.com", token_uri: "http://127.0.0.1:9/token",
}));
const vendor = { APNS_KEY_FILE: apnsKey, APNS_TEAM_ID: "TEAMID1234", APNS_KEY_ID: "KEYID12345", FCM_SERVICE_ACCOUNT_FILE: fcmKey };
const PUBLIC_SITE = "https://public-site.example";
const USER = "0efb0a6a-691e-490d-85d4-af5800dd267a";
const OTHER = "90eeb69a-722f-48be-8ab1-b0df01105e2a";
const DEVICE = "e0e69cb9-64cb-4cbc-8689-ac19de530468";
const PHONE = "5f991e71-f6e9-44c9-9871-d719a2c3bc29";
const ORG = "914e83c1-7984-41b0-9cd1-27f465fa2a48";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function transport(status, body = "") {
  const calls = [];
  const server = createHttp((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
  });
  const send = (url, options) => call(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`, options);
  return { calls, server, send };
}

function call(url, { method = "POST", headers = {}, body = "" } = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers: { ...headers, "content-length": Buffer.byteLength(raw) } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, ok: response.statusCode < 400, headers: response.headers, text: async () => Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(raw);
  });
}

describe("push relay", () => {
  const dir = mkdtempSync(join(tmpdir(), "vowkey-push-"));
  const database = join(dir, "relay.sqlite");
  let apns;
  const apnsSend = (url, options) => apns.send(url, options);
  let fcm;
  let relay;
  let base;

  before(async () => {
    apns = transport(200, "{}");
    fcm = transport(200, "{}");
    await listen(apns.server);
    await listen(fcm.server);
    const config = loadConfig({ PUSH_RELAY_DATABASE: ":memory:", PUSH_TOKEN_TTL: "60", PUSH_RELAY_PUBLIC_ORIGIN: PUBLIC_SITE, ...vendor });
    config.database = database;
    relay = createRelay(config, { apns: apnsSend, fcm: fcm.send, fcmToken: "test" });
    base = `http://127.0.0.1:${await listen(relay.server)}`;
  });

  after(() => {
    relay.server.close();
    apns.server.close();
    fcm.server.close();
    relay.close();
  });

  async function post(path, body, headers = {}) {
    const response = await call(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": typeof body === "string" ? "application/x-www-form-urlencoded" : "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  async function installation() {
    const created = await post("/installations", { email: "host@example.com" });
    const token = await post("/connect/token", `grant_type=client_credentials&scope=api.push&client_id=installation.${created.body.id}&client_secret=${created.body.key}`);
    return { ...created.body, authorization: `Bearer ${token.body.access_token}` };
  }

  it("allows the public site's installation exchange without exposing authenticated relay routes", async () => {
    const preflight = await call(`${base}/installations`, {
      method: "OPTIONS", headers: { origin: PUBLIC_SITE, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], PUBLIC_SITE);
    assert.equal(preflight.headers["access-control-allow-credentials"], undefined);
    assert.equal(preflight.headers["access-control-allow-methods"], "POST");
    const created = await call(`${base}/installations`, {
      headers: { origin: PUBLIC_SITE, "content-type": "application/json" }, body: { email: "browser@vowkey.test" },
    });
    assert.equal(created.status, 200);
    assert.equal(created.headers["access-control-allow-origin"], PUBLIC_SITE);
    const refused = await call(`${base}/installations`, {
      headers: { origin: "https://another-site.example", "content-type": "application/json" }, body: { email: "browser@vowkey.test" },
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.headers["access-control-allow-origin"], undefined);
    const tokenRoute = await call(`${base}/connect/token`, { method: "OPTIONS", headers: { origin: PUBLIC_SITE } });
    assert.equal(tokenRoute.status, 404);
    assert.equal(tokenRoute.headers["access-control-allow-origin"], undefined);
  });

  it("issues an installation and a short-lived scoped token", async () => {
    const created = await post("/installations", { email: "host@example.com" });
    assert.equal(created.status, 200);
    assert.match(created.body.id, /^[0-9a-f-]{36}$/);
    const token = await post("/connect/token", `grant_type=client_credentials&scope=api.push&client_id=installation.${created.body.id}&client_secret=${created.body.key}`);
    assert.equal(token.body.expires_in, 60);
    assert.equal(token.body.token_type, "Bearer");
    const wrong = await post("/connect/token", `grant_type=client_credentials&scope=api.push&client_id=installation.${created.body.id}&client_secret=nope`);
    assert.equal(wrong.status, 400);
  });

  it("rejects a token from another installation", async () => {
    const first = await installation();
    const second = await installation();
    const registered = await post("/push/register", {
      deviceId: DEVICE, pushToken: "android-token", userId: USER, type: 0, identifier: "app-1",
    }, { authorization: first.authorization });
    assert.equal(registered.status, 200);
    const stolen = await post("/push/send", {
      userId: USER, organizationId: null, deviceId: null, identifier: null, type: 1, clientType: null, installationId: first.id,
      payload: { id: OTHER, userId: USER, revisionDate: "2026-11-04T00:00:00.000Z" },
    }, { authorization: second.authorization });
    assert.equal(stolen.body.delivered, 0);
    assert.equal(fcm.calls.length, 0);
  });

  it("rejects a payload that carries more than the type and ids", async () => {
    const owner = await installation();
    const rejected = await post("/push/send", {
      userId: USER, organizationId: null, identifier: "web", type: 0,
      payload: { id: OTHER, userId: USER, revisionDate: "2026-11-04T00:00:00.000Z", name: "vault" },
    }, { authorization: owner.authorization });
    assert.equal(rejected.status, 400);
    assert.equal(fcm.calls.length, 0);
  });

  it("delivers to the user's other devices and drops a stale token", async () => {
    const owner = await installation();
    const headers = { authorization: owner.authorization };
    const fcmToken = `android-live-${"x".repeat(200)}`;
    assert.equal((await post("/push/register", { deviceId: DEVICE, pushToken: fcmToken, userId: USER, type: 0, identifier: "android" }, headers)).status, 200);
    await post("/push/register", { deviceId: PHONE, pushToken: "ios-stale", userId: USER, type: 1, identifier: "phone" }, headers);
    apns.server.close();
    apns = transport(410, '{"reason":"Unregistered"}');
    await listen(apns.server);
    const before = fcm.calls.length;
    const sent = await post("/push/send", {
      userId: USER, organizationId: null, identifier: "web", type: 0,
      payload: { id: OTHER, userId: USER, revisionDate: "2026-11-04T00:00:00.000Z" },
    }, headers);
    assert.equal(sent.body.delivered, 1);
    assert.equal(fcm.calls.length, before + 1);
    assert.equal(fcm.calls.at(-1).body.message.data.type, "0");
    assert.equal(fcm.calls.at(-1).body.message.token, fcmToken);
    assert.equal(JSON.parse(fcm.calls.at(-1).body.message.data.payload).id, OTHER);
    assert.equal(fcm.calls.at(-1).body.message.data.contextId, "web");
    assert.equal(apns.calls.length, 1);
    apns.server.close();
    apns = transport(200, "{}");
    await listen(apns.server);
    const again = await post("/push/send", {
      userId: USER, organizationId: null, identifier: null, type: 0,
      payload: { id: OTHER, userId: USER, revisionDate: "2026-11-04T00:00:00.000Z" },
    }, headers);
    assert.equal(again.body.delivered, 1);
    assert.equal(fcm.calls.length, before + 2);
  });

  it("reaches an organization's devices and keeps registrations after restart", async () => {
    const owner = await installation();
    const headers = { authorization: owner.authorization };
    await post("/push/register", {
      deviceId: PHONE, pushToken: "android-org", userId: OTHER, type: 0, identifier: "member", organizationIds: [ORG],
    }, headers);
    relay.server.close();
    relay.close();
    const config = loadConfig({ ...vendor });
    config.database = database;
    const fresh = { calls: [], send: async (url, options) => { fresh.calls.push(JSON.parse(options.body)); return { ok: true, status: 200, text: async () => "{}" }; } };
    relay = createRelay(config, { fcm: fresh.send, fcmToken: "test", apns: async () => ({ ok: true, status: 200, text: async () => "{}" }) });
    base = `http://127.0.0.1:${await listen(relay.server)}`;
    const sent = await post("/push/send", {
      userId: null, organizationId: ORG, identifier: "admin", type: 0,
      payload: { id: OTHER, userId: USER, organizationId: ORG, revisionDate: "2026-11-04T00:00:00.000Z" },
    }, headers);
    assert.equal(sent.body.delivered, 1);
    assert.equal(fresh.calls[0].message.token, "android-org");
    const removed = await post(`/push/delete/${PHONE}`, "", headers);
    assert.equal(removed.status, 200);
  });
});
