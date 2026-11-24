import { createHash, createSign, createPrivateKey, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as http2Connect } from "node:http2";
import { DatabaseSync } from "node:sqlite";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}$/;
const TOKEN_TTL = 3600;
const MAX_BODY = 64 * 1024;
const MAX_TOKEN = 4096;
const MAX_ORGS = 100;
const MAX_ID = 128;
const ANDROID = 0;
const IOS = 1;
const TYPES = {
  0: ["id", "userId", "organizationId", "collectionIds", "revisionDate"],
  1: ["id", "userId", "organizationId", "collectionIds", "revisionDate"],
  2: ["id", "userId", "organizationId", "collectionIds", "revisionDate"],
  3: ["id", "userId", "revisionDate"],
  4: ["userId", "date"],
  5: ["userId", "date"],
  6: ["userId", "date"],
  7: ["id", "userId", "revisionDate"],
  8: ["id", "userId", "revisionDate"],
  9: ["id", "userId", "organizationId", "collectionIds", "revisionDate"],
  10: ["userId", "date"],
  11: ["userId", "date", "reason"],
  12: ["id", "userId", "revisionDate"],
  13: ["id", "userId", "revisionDate"],
  14: ["id", "userId", "revisionDate"],
  15: ["id", "userId"],
  16: ["id", "userId"],
  17: ["userId", "date"],
  18: ["userId", "organizationId"],
  19: ["userId", "organizationId"],
  20: ["id", "userId", "organizationId"],
  21: ["id", "userId", "organizationId"],
  22: ["userId", "date"],
  23: ["userId", "organizationId"],
  24: ["userId", "providerId"],
  25: ["userId", "organizationId"],
  26: ["userId", "organizationId"],
  27: ["userId", "premium"],
  28: ["userId", "date"],
  29: ["userId", "date"],
};

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const eq = (a, b) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export function loadConfig(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const hostOf = (name, fallback) => {
    const value = env[name] || fallback;
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} is not a URL`); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be http or https`);
    return url.origin;
  };
  const file = (name) => (env[name] ? readFileSync(env[name], "utf8") : "");
  return {
    host: env.PUSH_RELAY_HOST || "127.0.0.1",
    port: number("PUSH_RELAY_PORT", 8790),
    database: env.PUSH_RELAY_DATABASE || "push-relay.sqlite",
    publicOrigin: hostOf("PUSH_RELAY_PUBLIC_ORIGIN", "https://vowkey.com"),
    tokenTtl: number("PUSH_TOKEN_TTL", TOKEN_TTL),
    apns: {
      host: hostOf("APNS_HOST", "https://api.push.apple.com"),
      teamId: env.APNS_TEAM_ID || "",
      keyId: env.APNS_KEY_ID || "",
      privateKey: file("APNS_KEY_FILE"),
      topic: env.APNS_TOPIC || "com.vowkey.app",
    },
    fcm: { serviceAccount: file("FCM_SERVICE_ACCOUNT_FILE") },
  };
}

function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      push_token TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_type INTEGER NOT NULL,
      identifier TEXT NOT NULL,
      organization_ids TEXT NOT NULL,
      PRIMARY KEY (installation_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS devices_user ON devices (installation_id, user_id);
    CREATE TABLE IF NOT EXISTS access_tokens (
      token_hash TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

function signJwt(header, claims, key) {
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  return `${body}.${createSign("SHA256").update(body).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

function apnsToken(config, now) {
  const seconds = Math.floor(now / 1000);
  return signJwt(
    { alg: "ES256", kid: config.keyId },
    { iss: config.teamId, iat: seconds },
    createPrivateKey(config.privateKey),
  );
}

function fcmAssertion(account, now) {
  const seconds = Math.floor(now / 1000);
  return signJwt(
    { alg: "RS256", typ: "JWT", kid: account.private_key_id },
    { iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: account.token_uri, iat: seconds, exp: seconds + 3600 },
    createPrivateKey(account.private_key),
  );
}

function readJson(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function idOf(value) {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function textId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID && !/[\u0000-\u001f]/.test(value) ? value : null;
}

function payloadOf(type, value) {
  const allowed = TYPES[type];
  if (!allowed || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  const out = {};
  for (const key of allowed) {
    if (value[key] === undefined || value[key] === null) continue;
    const item = value[key];
    if (key === "collectionIds") {
      if (!Array.isArray(item) || item.length > MAX_ORGS || item.some((id) => !idOf(id))) return null;
      out[key] = item.map((id) => id.toLowerCase());
    } else if (key === "revisionDate" || key === "date") {
      if (typeof item !== "string" || item.length > 40 || Number.isNaN(Date.parse(item))) return null;
      out[key] = item;
    } else if (key === "reason") {
      if (item !== 0 && item !== -1) return null;
      out[key] = item;
    } else if (key === "premium") {
      if (typeof item !== "boolean") return null;
      out[key] = item;
    } else if (!idOf(item)) return null;
    else out[key] = item.toLowerCase();
  }
  if (!Object.keys(out).length) return null;
  if (out.id === undefined && (type <= 3 || type === 9 || (type >= 12 && type <= 16) || type === 20 || type === 21)) return null;
  if (out.userId === undefined && type !== 18 && type !== 19 && type !== 23 && type !== 25 && type !== 26) return null;
  return out;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body, type = "application/json") {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(raw);
}

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function createRelay(config, { apns, fcm, fcmToken = "", now = Date.now, database } = {}) {
  const db = database || openDatabase(config.database);
  const insertInstallation = db.prepare("INSERT INTO installations (id, key_hash, email, created_at) VALUES (?, ?, ?, ?)");
  const findInstallation = db.prepare("SELECT id, key_hash FROM installations WHERE id = ?");
  const insertToken = db.prepare("INSERT INTO access_tokens (token_hash, installation_id, expires_at) VALUES (?, ?, ?)");
  const findToken = db.prepare("SELECT installation_id FROM access_tokens WHERE token_hash = ? AND expires_at > ?");
  const pruneTokens = db.prepare("DELETE FROM access_tokens WHERE expires_at <= ?");
  const upsertDevice = db.prepare(`INSERT INTO devices
    (installation_id, device_id, push_token, user_id, device_type, identifier, organization_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (installation_id, device_id) DO UPDATE SET
      push_token = excluded.push_token, user_id = excluded.user_id, device_type = excluded.device_type,
      identifier = excluded.identifier, organization_ids = excluded.organization_ids`);
  const deleteDevice = db.prepare("DELETE FROM devices WHERE installation_id = ? AND device_id = ?");
  const dropToken = db.prepare("DELETE FROM devices WHERE installation_id = ? AND push_token = ?");
  const forUser = db.prepare("SELECT push_token, device_type, identifier FROM devices WHERE installation_id = ? AND user_id = ?");
  const forOrg = db.prepare("SELECT push_token, device_type, identifier, organization_ids FROM devices WHERE installation_id = ?");

  function installationOf(token) {
    if (typeof token !== "string" || token.length > MAX_TOKEN) return null;
    return findToken.get(digest(token), now())?.installation_id ?? null;
  }

  function postHttps(url, headers, raw) {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(url, { method: "POST", headers: { ...headers, "content-length": Buffer.byteLength(raw) } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, ok: response.statusCode < 400, text: async () => Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.setTimeout(15_000, () => req.destroy(new Error("push provider timeout")));
      req.end(raw);
    });
  }

  function postApns(token, headers, raw) {
    const client = http2Connect(config.apns.host);
    return new Promise((resolve, reject) => {
      const fail = (error) => { client.close(); reject(error); };
      client.on("error", fail);
      const req = client.request({ ":method": "POST", ":path": `/3/device/${encodeURIComponent(token)}`, ...headers });
      req.setTimeout(15_000, () => { req.close(); fail(new Error("APNs timeout")); });
      const chunks = [];
      req.on("response", (head) => { req.on("data", (chunk) => chunks.push(chunk)); req.on("end", () => { client.close(); resolve({ status: head[":status"], ok: head[":status"] < 400 }); }); });
      req.on("error", fail);
      req.end(raw);
    });
  }

  async function deliver(device, data, contextId) {
    const body = { type: data.type, payload: data.payload, ...(contextId ? { contextId } : {}) };
    if (device.device_type === IOS) {
      if (!(config.apns.privateKey && config.apns.teamId && config.apns.keyId)) return { ok: false, stale: false };
      const raw = JSON.stringify({ aps: { "content-available": 1 }, data: body });
      const headers = { authorization: `bearer ${apnsToken(config.apns, now())}`, "apns-topic": config.apns.topic, "apns-push-type": "background", "apns-priority": "5" };
      const response = apns ? await apns(`${config.apns.host}/3/device/${encodeURIComponent(device.push_token)}`, { method: "POST", headers, body: raw }) : await postApns(device.push_token, headers, raw);
      return { ok: response.ok, stale: response.status === 410 };
    }
    if (device.device_type === ANDROID) {
      if (!config.fcm.serviceAccount) return { ok: false, stale: false };
      const account = JSON.parse(config.fcm.serviceAccount);
      const raw = JSON.stringify({ message: { token: device.push_token, data: { type: String(data.type), payload: data.payload, ...(contextId ? { contextId } : {}) } } });
      const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
      const response = fcm ? await fcm(url, { method: "POST", headers: { authorization: `Bearer ${await fcmAccess(account)}` }, body: raw }) : await postHttps(url, { authorization: `Bearer ${await fcmAccess(account)}`, "content-type": "application/json" }, raw);
      const text = await response.text();
      return { ok: response.ok, stale: response.status === 404 && text.includes("UNREGISTERED") };
    }
    return { ok: true, stale: false };
  }

  const fcmCache = { token: fcmToken, exp: fcmToken ? Number.MAX_SAFE_INTEGER : 0 };
  async function fcmAccess(account) {
    if (now() < fcmCache.exp) return fcmCache.token;
    const form = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: fcmAssertion(account, now()) }).toString();
    const json = await new Promise((resolve, reject) => {
      const req = httpsRequest(account.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(form) } }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          if (response.statusCode >= 400) reject(new Error(`FCM token request failed (${response.statusCode})`));
          else {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(new Error("invalid FCM token response")); }
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(15_000, () => req.destroy(new Error("FCM token timeout")));
      req.end(form);
    });
    fcmCache.token = json.access_token;
    fcmCache.exp = now() + (Number(json.expires_in) || 3600) * 500;
    return fcmCache.token;
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://relay.local");
    if (url.pathname === "/installations") {
      res.setHeader("vary", "origin");
      const origin = req.headers.origin;
      if (origin && origin !== config.publicOrigin) return send(res, 403, { error: "origin is not allowed" });
      if (origin) {
        res.setHeader("access-control-allow-origin", config.publicOrigin);
        res.setHeader("access-control-allow-headers", "content-type");
        res.setHeader("access-control-allow-methods", "POST");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
    }
    if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (req.method !== "POST") return send(res, 404, { error: "not found" });
    const raw = await readBody(req, MAX_BODY);
    if (raw === null) return send(res, 413, { error: "too large" });

    if (url.pathname === "/installations") {
      const body = readJson(raw);
      const email = typeof body?.email === "string" ? body.email.trim() : "";
      if (!EMAIL.test(email)) return send(res, 400, { error: "email is required" });
      const id = randomUUID();
      const key = b64url(randomBytes(32));
      insertInstallation.run(id, digest(key), email, now());
      return send(res, 200, { id, key });
    }

    if (url.pathname === "/connect/token") {
      const form = new URLSearchParams(raw.toString("utf8"));
      const clientId = form.get("client_id") || "";
      const installationId = clientId.startsWith("installation.") ? idOf(clientId.slice(13)) : null;
      const row = installationId && findInstallation.get(installationId);
      if (form.get("grant_type") !== "client_credentials" || form.get("scope") !== "api.push" || !row || !eq(row.key_hash, digest(form.get("client_secret") || ""))) {
        return send(res, 400, { error: "invalid_client" });
      }
      pruneTokens.run(now());
      const access = b64url(randomBytes(32));
      insertToken.run(digest(access), installationId, now() + config.tokenTtl * 1000);
      return send(res, 200, { access_token: access, expires_in: config.tokenTtl, token_type: "Bearer", scope: "api.push" });
    }

    const installationId = installationOf(bearer(req));
    if (!installationId) return send(res, 401, { error: "unauthorized" });
    const body = raw.length ? readJson(raw) : {};
    if (body === null || typeof body !== "object") return send(res, 400, { error: "invalid json" });

    if (url.pathname === "/push/register") {
      const deviceId = idOf(body.deviceId);
      const userId = idOf(body.userId);
      const identifier = textId(body.identifier);
      const pushToken = typeof body.pushToken === "string" && body.pushToken.length > 0
        && body.pushToken.length <= MAX_TOKEN && !/[\u0000-\u001f]/.test(body.pushToken) ? body.pushToken : null;
      const type = Number.isInteger(body.type) ? body.type : null;
      const orgs = body.organizationIds ?? [];
      if (!deviceId || !userId || !identifier || !pushToken || pushToken.length > MAX_TOKEN || (type !== ANDROID && type !== IOS) ||
          !Array.isArray(orgs) || orgs.length > MAX_ORGS || orgs.some((id) => !idOf(id))) {
        return send(res, 400, { error: "invalid registration" });
      }
      upsertDevice.run(installationId, deviceId, pushToken, userId, type, identifier, JSON.stringify(orgs.map((id) => id.toLowerCase())));
      return send(res, 200, {});
    }

    const deleted = url.pathname.match(/^\/push\/delete\/([^/]+)$/);
    if (deleted) {
      const deviceId = idOf(decodeURIComponent(deleted[1]));
      if (!deviceId) return send(res, 400, { error: "invalid device" });
      deleteDevice.run(installationId, deviceId);
      return send(res, 200, {});
    }

    if (url.pathname === "/push/send") {
      const type = Number.isInteger(body.type) ? body.type : null;
      const payload = payloadOf(type, body.payload);
      const userId = body.userId == null ? null : idOf(body.userId);
      const organizationId = body.organizationId == null ? null : idOf(body.organizationId);
      const identifier = body.identifier == null ? null : textId(body.identifier);
      const clientType = body.clientType;
      if (!payload || (body.userId != null && !userId) || (body.organizationId != null && !organizationId) ||
          (body.identifier != null && !identifier) || (clientType != null && clientType !== "all") ||
          (!userId && !organizationId)) {
        return send(res, 400, { error: "invalid notification" });
      }
      const targets = userId
        ? forUser.all(installationId, userId)
        : forOrg.all(installationId).filter((row) => JSON.parse(row.organization_ids).includes(organizationId));
      const wire = { type, payload: JSON.stringify(payload) };
      let delivered = 0;
      let failed = 0;
      for (const device of targets) {
        if (identifier && device.identifier === identifier) continue;
        try {
          const result = await deliver(device, wire, identifier);
          if (result.stale) dropToken.run(installationId, device.push_token);
          else if (result.ok) delivered += 1;
          else failed += 1;
        } catch (error) {
          failed += 1;
          console.error("vowkey-push: provider delivery failed");
        }
      }
      return send(res, failed ? 502 : 200, { delivered, failed });
    }

    return send(res, 404, { error: "not found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error(`vowkey-push: ${error.message}`);
      if (!res.headersSent) send(res, 502, { error: "delivery failed" });
    });
  });
  return { server, close: () => db.close() };
}
