import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

import { validDecision, validGraph, validVisionRead, validImageFill } from "./protocol.mjs";
import { describeForm, readDocumentVision, planImageFill, readBody, TooLarge } from "./readers.mjs";

const LEEWAY_SECONDS = 30;
const MINUTE = 60_000;
const AUDIENCE = "vowkey-decision-relay";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);

export function loadConfig(env = process.env) {
  const need = (name) => {
    if (!env[name]) throw new Error(`${name} is not set`);
    return env[name];
  };
  const number = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
    return value;
  };
  const endpoint = (value) => {
    const url = new URL(value);
    if (url.username || url.password || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && (local(value) || env.RELAY_ALLOW_HTTP === "true")))) {
      throw new Error("Relay endpoints require HTTPS unless HTTP is explicitly enabled for a private deployment");
    }
    return url.href;
  };
  const upstreamUrl = endpoint(env.RELAY_UPSTREAM_URL || "https://api.typesafe.ai/v1/systemone");
  const tokenIssuer = need("RELAY_TOKEN_ISSUER");
  if (!tokenIssuer.endsWith("|login")) throw new Error("RELAY_TOKEN_ISSUER must be the login issuer");
  const domain = tokenIssuer.slice(0, -"|login".length);
  endpoint(domain);
  const formReaderUrl = env.RELAY_FORM_READER_URL ? endpoint(env.RELAY_FORM_READER_URL) : undefined;
  if (formReaderUrl && !env.RELAY_FORM_READER_MODEL) throw new Error("RELAY_FORM_READER_MODEL is not set");
  return {
    host: env.RELAY_HOST || "127.0.0.1", port: number("RELAY_PORT", 8787),
    upstreamUrl, upstreamKey: local(upstreamUrl) ? (env.RELAY_UPSTREAM_KEY ?? "") : need("RELAY_UPSTREAM_KEY"),
    upstreamModel: env.RELAY_UPSTREAM_MODEL || "jev-1.14.0",
    tokenPublicKey: readFileSync(need("RELAY_TOKEN_PUBLIC_KEY"), "utf8"), tokenIssuer,
    guestTokenIssuer: env.RELAY_GUEST_TOKEN_ISSUER || `${domain}|guest-decision`,
    guestConsumeUrl: endpoint(env.RELAY_GUEST_CONSUME_URL || `${domain}/identity/guest-decision/consume`),
    accountConsumeUrl: endpoint(env.RELAY_ACCOUNT_CONSUME_URL || `${domain}/api/decision/consume`),
    usageUrl: endpoint(env.RELAY_USAGE_URL || `${domain}/api/decision/usage`),
    serviceKey: env.RELAY_SERVICE_KEY || "",
    formReaderUrl, formReaderModel: env.RELAY_FORM_READER_MODEL,
    formReaderKey: formReaderUrl && !local(formReaderUrl) ? need("RELAY_FORM_READER_KEY") : (env.RELAY_FORM_READER_KEY ?? ""),
    perMinute: number("RELAY_LIMIT_PER_MINUTE", 30),
    maxBodyBytes: number("RELAY_MAX_BODY_BYTES", 10_000_000),
    maxResponseBytes: number("RELAY_MAX_RESPONSE_BYTES", 2_000_000),
    formReaderMaxTokens: number("RELAY_FORM_READER_MAX_TOKENS", 16_384),
    timeoutMs: number("RELAY_TIMEOUT_MS", 120_000),
    allowedOrigins: (env.RELAY_ALLOWED_ORIGINS || "*").split(",").map((origin) => origin.trim()),
  };
}

function claimsOf(token, publicKey, now) {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 32_768) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "RS256" || (header.typ !== undefined && header.typ !== "JWT") || header.crit !== undefined) return null;
    if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"))) return null;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const seconds = now / 1000;
    if (!Number.isSafeInteger(claims.exp) || seconds >= claims.exp + LEEWAY_SECONDS ||
        !Number.isSafeInteger(claims.nbf) || seconds < claims.nbf - LEEWAY_SECONDS || claims.exp <= claims.nbf) return null;
    return claims;
  } catch {
    return null;
  }
}

function loginSubject(claims, issuer) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return claims.iss === issuer && UUID.test(claims.sub) && UUID.test(claims.device) &&
    typeof claims.sstamp === "string" && claims.sstamp.length > 0 &&
    Array.isArray(claims.scope) && claims.scope.includes("api") && !audiences.includes(AUDIENCE) ? claims.sub : null;
}

export function accountOf(token, publicKey, issuer, now = Date.now()) {
  const claims = claimsOf(token, publicKey, now);
  return claims && loginSubject(claims, issuer);
}

function principalOf(token, publicKey, config, scope) {
  const claims = claimsOf(token, publicKey, Date.now());
  if (!claims) return null;
  const account = loginSubject(claims, config.tokenIssuer);
  if (account) return { kind: "account", id: account };
  if (claims.iss !== config.guestTokenIssuer || claims.aud !== AUDIENCE || !UUID.test(claims.sub) ||
      claims.exp - claims.nbf !== 3600 || !Array.isArray(claims.scope) || !claims.scope.includes(scope) ||
      claims.scope.some((item) => item !== "decision.guest" && item !== "form.describe.guest")) return null;
  return { kind: "guest", id: claims.sub };
}

function bursts({ perMinute }) {
  const accounts = new Map();
  return {
    take(account, now) {
      const minute = Math.floor(now / MINUTE);
      if (accounts.size > 10_000) {
        for (const [key, entry] of accounts) if (entry.minute !== minute) accounts.delete(key);
      }
      let entry = accounts.get(account);
      if (!entry || entry.minute !== minute) {
        entry = { minute, count: 0 };
        accounts.set(account, entry);
      }
      if (entry.count >= perMinute) return { ok: false, retryAfter: Math.ceil((MINUTE - now % MINUTE) / 1000) };
      entry.count += 1;
      return { ok: true };
    },
  };
}


async function consumeGuest(config, token, scope) {
  if (!config.guestConsumeUrl) return { status: 503 };
  try {
    const response = await fetch(config.guestConsumeUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ scope }),
    });
    if (response.status === 429) { await response.body?.cancel(); return { status: 429 }; }
    if (response.status !== 200) { await response.body?.cancel(); return { status: 503 }; }
    const body = JSON.parse(await readBody(response.body, 4096));
    return { status: body.allowed === true ? 200 : 503 };
  } catch {
    return { status: 503 };
  }
}

async function consumeAccount(config, token, organizationId) {
  if (!config.accountConsumeUrl) return { status: 503 };
  try {
    const response = await fetch(config.accountConsumeUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(organizationId ? { organizationId } : {}),
    });
    if (response.status === 429) { await response.body?.cancel(); return { status: 429 }; }
    if (response.status !== 200) { await response.body?.cancel(); return { status: 503 }; }
    const body = JSON.parse(await readBody(response.body, 4096));
    return { status: body.allowed === true ? 200 : 503 };
  } catch { return { status: 503 }; }
}

function usageTotals(value) {
  const number = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    inputTokens: number(value?.input_tokens ?? value?.prompt_tokens),
    outputTokens: number(value?.output_tokens ?? value?.completion_tokens),
    costMicros: number(value?.cost_micros),
  };
}

async function reportUsage(config, report) {
  if (!config.usageUrl || !config.serviceKey) return;
  try {
    const response = await fetch(config.usageUrl, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10_000)),
      headers: { "content-type": "application/json", "X-Relay-Key": config.serviceKey },
      body: JSON.stringify(report),
    });
    if (!response.ok) console.error("vowkey-relay: usage report rejected");
    await response.body?.cancel();
  } catch { console.error("vowkey-relay: usage report unavailable"); }
}



export function createRelay(config) {
  const publicKey = createPublicKey(config.tokenPublicKey);
  const limits = bursts(config);
  const counts = { requests: 0, answered: 0, unauthorized: 0, limited: 0, upstreamFailed: 0 };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = config.allowedOrigins ?? ["*"];
    const cors = origin && (allowed.includes("*") || allowed.includes(origin))
      ? { "access-control-allow-origin": allowed.includes("*") ? "*" : origin, vary: "Origin" } : {};
    const reply = (status, body, headers = {}) => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...cors, ...headers });
      res.end(text);
    };
    const path = new URL(req.url ?? "/", "http://relay").pathname;
    if (req.method === "GET" && path === "/healthz") return reply(200, { ok: true, ...counts });
    if (!["/v1/systemone", "/v1/forms/describe", "/v1/forms/fill-image", "/v1/documents/read-vision"].includes(path)) return reply(404, { error: "not found" });
    if (req.method === "OPTIONS") return reply(204, null, { "access-control-allow-methods": "POST", "access-control-allow-headers": "Authorization, Content-Type, X-Vowkey-Organization" });
    if (req.method !== "POST") return reply(405, { error: "use POST" }, { allow: "POST" });
    if (origin && Object.keys(cors).length === 0) return reply(403, { error: "origin not allowed" });
    counts.requests += 1;
    const scope = path.startsWith("/v1/forms/") ? "form.describe.guest" : "decision.guest";
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    const principal = bearer && principalOf(bearer[1], publicKey, config, scope);
    if (!principal) {
      counts.unauthorized += 1;
      return reply(401, { error: "authorization required" }, { "www-authenticate": "Bearer" });
    }
    let request;
    try { request = JSON.parse(await readBody(req, config.maxBodyBytes)); }
    catch (error) {
      return error instanceof TooLarge ? reply(413, { error: "request too large" }, { connection: "close" }) : reply(400, { error: "the body is not JSON" });
    }
    const validRequest = path === "/v1/forms/describe" ? validGraph(request)
      : path === "/v1/forms/fill-image" ? validImageFill(request)
      : path === "/v1/documents/read-vision" ? validVisionRead(request)
      : validDecision(request);
    if (!validRequest) return reply(400, { error: "invalid reading request" });
    if (path !== "/v1/systemone" && (!config.formReaderUrl || !config.formReaderModel)) {
      return reply(503, { error: "the reading service is unavailable" });
    }
    const organizationId = req.headers["x-vowkey-organization"];
    if (organizationId !== undefined && (principal.kind !== "account" || !UUID.test(organizationId))) {
      return reply(400, { error: "invalid organization" });
    }
    if (principal.kind === "guest") {
      const consumed = await consumeGuest(config, bearer[1], scope);
      if (consumed.status !== 200) {
        if (consumed.status === 429) counts.limited += 1;
        else counts.upstreamFailed += 1;
        return reply(consumed.status, { error: consumed.status === 429 ? "too many requests" : "the reading service is unavailable" });
      }
    } else {
      const slot = limits.take(principal.id, Date.now());
      if (!slot.ok) { counts.limited += 1; return reply(429, { error: "too many requests" }, { "retry-after": String(slot.retryAfter) }); }
      const consumed = await consumeAccount(config, bearer[1], organizationId);
      if (consumed.status !== 200) {
        if (consumed.status === 429) counts.limited += 1;
        else counts.upstreamFailed += 1;
        return reply(consumed.status, { error: consumed.status === 429 ? "too many requests" : "the reading service is unavailable" });
      }
    }
    let totals = usageTotals(null);
    const receiveUsage = (usage) => { totals = usageTotals(usage); };
    if (principal.kind === "account") {
      const started = Date.now();
      const model = path === "/v1/systemone" ? config.upstreamModel : config.formReaderModel;
      res.once("finish", () => {
        void reportUsage(config, { account: principal.id, ...(organizationId ? { organizationId } : {}),
          model, ...totals, latencyMs: Date.now() - started, result: res.statusCode < 400 ? "ok" : "error" });
      });
    }
    if (path === "/v1/forms/describe") {
      try { const asks = await describeForm(config, request, receiveUsage); counts.answered += 1; return reply(200, asks); }
      catch { counts.upstreamFailed += 1; return reply(502, { error: "the reading service is unavailable" }); }
    }
    if (path === "/v1/forms/fill-image") {
      try { const result = await planImageFill(config, request, receiveUsage); counts.answered += 1; return reply(200, result); }
      catch { counts.upstreamFailed += 1; return reply(502, { error: "the reading service is unavailable" }); }
    }
    if (path === "/v1/documents/read-vision") {
      try { const result = await readDocumentVision(config, request, receiveUsage); counts.answered += 1; return reply(200, result); }
      catch { counts.upstreamFailed += 1; return reply(502, { error: "the reading service is unavailable" }); }
    }
    let upstream, text;
    try {
      upstream = await fetch(config.upstreamUrl, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs),
        headers: { "content-type": "application/json", ...(config.upstreamKey ? { authorization: `Bearer ${config.upstreamKey}` } : {}) },
        body: JSON.stringify({ model: config.upstreamModel, state: request.state, questions: request.questions }),
      });
      text = await readBody(upstream.body, config.maxResponseBytes ?? 2_000_000);
      try { receiveUsage(JSON.parse(text).usage); } catch {}
    } catch { counts.upstreamFailed += 1; return reply(502, { error: "the reading service is unavailable" }); }
    if (upstream.status === 401 || upstream.status === 403 || upstream.status >= 500) { counts.upstreamFailed += 1; return reply(502, { error: "the reading service is unavailable" }); }
    if (upstream.status === 429) { counts.upstreamFailed += 1; return reply(503, { error: "the reading service is busy" }, { "retry-after": upstream.headers.get("retry-after") ?? "5" }); }
    if (upstream.ok) counts.answered += 1;
    res.writeHead(upstream.status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...cors });
    res.end(text);
  });
  server.requestTimeout = Math.max(30_000, config.timeoutMs ?? 120_000);
  return { server, counts };
}
