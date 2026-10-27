// The relay between Vowkey's apps and a Decision model.
//
// An app sends the request it would send to Jev (`POST /v1/systemone`, `{ model, state, questions }`)
// with the access token of the person's account. The relay checks the token against the sync
// server's public key, counts the request against the account's allowance, and forwards it to the
// configured Decision endpoint with the key that only the relay holds. The answer goes back as it
// came. The relay keeps no database, and it writes nothing about a request to a log.
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const LEEWAY_SECONDS = 30;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Reads the settings from the environment. */
export function loadConfig(env = process.env) {
  const need = (name) => {
    if (!env[name]) throw new Error(`${name} is not set`);
    return env[name];
  };
  const number = (name, fallback) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
    return value;
  };
  const upstreamUrl = env.RELAY_UPSTREAM_URL || "https://api.typesafe.ai/v1/systemone";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(upstreamUrl).hostname);
  return {
    host: env.RELAY_HOST || "127.0.0.1",
    port: number("RELAY_PORT", 8787),
    upstreamUrl,
    upstreamKey: local ? (env.RELAY_UPSTREAM_KEY ?? "") : need("RELAY_UPSTREAM_KEY"),
    upstreamModel: env.RELAY_UPSTREAM_MODEL || "jev-1.14.0",
    tokenPublicKey: readFileSync(need("RELAY_TOKEN_PUBLIC_KEY"), "utf8"),
    tokenIssuer: need("RELAY_TOKEN_ISSUER"),
    perMinute: number("RELAY_LIMIT_PER_MINUTE", 30),
    perDay: number("RELAY_LIMIT_PER_DAY", 400),
    maxBodyBytes: number("RELAY_MAX_BODY_BYTES", 1_000_000),
    timeoutMs: number("RELAY_TIMEOUT_MS", 120_000),
  };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The account a login token belongs to, or null. The sync server signs several kinds of token with
 * one key and tells them apart by issuer, so the issuer has to match too.
 */
export function accountOf(token, publicKey, issuer, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (header.alg !== "RS256") return null;
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    if (!verify("RSA-SHA256", signed, publicKey, Buffer.from(parts[2], "base64url"))) return null;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const seconds = now / 1000;
    if (claims.iss !== issuer || typeof claims.sub !== "string" || claims.sub === "") return null;
    if (typeof claims.exp !== "number" || seconds > claims.exp + LEEWAY_SECONDS) return null;
    if (typeof claims.nbf === "number" && seconds < claims.nbf - LEEWAY_SECONDS) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

/** Allowances in memory: so many requests a minute and so many a day for each account. */
function allowances({ perMinute, perDay }) {
  const accounts = new Map();
  return {
    take(account, now) {
      const minute = Math.floor(now / MINUTE);
      const day = Math.floor(now / DAY);
      if (accounts.size > 10_000) {
        for (const [key, entry] of accounts) if (entry.day !== day) accounts.delete(key);
      }
      let entry = accounts.get(account);
      if (!entry || entry.day !== day) {
        entry = { day, today: 0, minute, thisMinute: 0 };
        accounts.set(account, entry);
      }
      if (entry.minute !== minute) Object.assign(entry, { minute, thisMinute: 0 });
      if (entry.thisMinute >= perMinute) return { ok: false, retryAfter: Math.ceil((MINUTE - (now % MINUTE)) / 1000) };
      if (entry.today >= perDay) return { ok: false, retryAfter: Math.ceil((DAY - (now % DAY)) / 1000) };
      entry.thisMinute += 1;
      entry.today += 1;
      return { ok: true };
    },
  };
}

class TooLarge extends Error {}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new TooLarge();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Makes the server; the caller starts it with `server.listen`. */
export function createRelay(config) {
  const publicKey = createPublicKey(config.tokenPublicKey);
  const limits = allowances(config);
  const counts = { requests: 0, answered: 0, unauthorized: 0, limited: 0, upstreamFailed: 0 };

  const server = createServer(async (req, res) => {
    const reply = (status, body, headers = {}) => {
      const text = JSON.stringify(body);
      res.writeHead(status, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
        "cache-control": "no-store",
        ...headers,
      });
      res.end(text);
    };

    const path = new URL(req.url ?? "/", "http://relay").pathname;
    if (req.method === "GET" && path === "/healthz") return reply(200, { ok: true, ...counts });
    if (path !== "/v1/systemone") return reply(404, { error: "not found" });
    if (req.method !== "POST") return reply(405, { error: "use POST" }, { allow: "POST" });

    counts.requests += 1;
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    const account = bearer && accountOf(bearer[1], publicKey, config.tokenIssuer);
    if (!account) {
      counts.unauthorized += 1;
      return reply(401, { error: "sign in again" }, { "www-authenticate": "Bearer" });
    }
    const slot = limits.take(account, Date.now());
    if (!slot.ok) {
      counts.limited += 1;
      return reply(429, { error: "too many requests" }, { "retry-after": String(slot.retryAfter) });
    }

    let request;
    try {
      request = JSON.parse(await readBody(req, config.maxBodyBytes));
    } catch (error) {
      return error instanceof TooLarge
        ? reply(413, { error: "request too large" }, { connection: "close" })
        : reply(400, { error: "the body is not JSON" });
    }
    if (!isObject(request) || !isObject(request.state) || !isObject(request.questions)) {
      return reply(400, { error: "state and questions are required" });
    }

    // The model is the relay's to choose, and only the parts of a request that Decision reads go on.
    const forwarded = JSON.stringify({ model: config.upstreamModel, state: request.state, questions: request.questions });
    let upstream;
    let text;
    try {
      upstream = await fetch(config.upstreamUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.upstreamKey ? { authorization: `Bearer ${config.upstreamKey}` } : {}),
        },
        body: forwarded,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      text = await upstream.text();
    } catch {
      counts.upstreamFailed += 1;
      return reply(502, { error: "the reading service is unavailable" });
    }

    // A refusal of the relay's own key, or a failure on the far side, is not the person's to see.
    if (upstream.status === 401 || upstream.status === 403 || upstream.status >= 500) {
      counts.upstreamFailed += 1;
      return reply(502, { error: "the reading service is unavailable" });
    }
    if (upstream.status === 429) {
      counts.upstreamFailed += 1;
      return reply(503, { error: "the reading service is busy" }, { "retry-after": upstream.headers.get("retry-after") ?? "5" });
    }
    if (upstream.ok) counts.answered += 1;
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "content-length": Buffer.byteLength(text),
      "cache-control": "no-store",
    });
    res.end(text);
  });
  server.requestTimeout = 30_000;
  return { server, counts };
}
