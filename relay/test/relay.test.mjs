import assert from "node:assert/strict";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";

import { createRelay } from "../relay.mjs";

const ISSUER = "https://vault.example|login";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" });

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claims = {}, { key = privateKey, header = { alg: "RS256", typ: "JWT" } } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISSUER, sub: "account-1", nbf: now - 10, exp: now + 7200, ...claims };
  const signed = `${encode(header)}.${encode(body)}`;
  const signature = createSign("RSA-SHA256").update(signed).sign(key).toString("base64url");
  return `${signed}.${signature}`;
}

const body = { model: "anything", state: { pieces: [{ id: "c0", text: "SECRET-MARKER" }] }, questions: { c0: { type: "choice" } }, extra: "dropped" };

let upstream;
let upstreamRequests;
let upstreamReply;
let relay;
let base;

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

function start(overrides = {}) {
  const config = {
    upstreamUrl: `${upstream.url}/v1/systemone`,
    upstreamKey: "upstream-key",
    upstreamModel: "model-x",
    tokenPublicKey: publicPem,
    tokenIssuer: ISSUER,
    perMinute: 5,
    perDay: 8,
    maxBodyBytes: 4000,
    timeoutMs: 2000,
    ...overrides,
  };
  return createRelay(config);
}

async function restart(overrides) {
  await new Promise((resolve) => relay.server.close(resolve));
  relay = start(overrides);
  base = await listen(relay.server);
}

async function call(authorization, payload = body, init = {}) {
  const response = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
    ...init,
  });
  return { status: response.status, headers: response.headers, json: await response.json().catch(() => null) };
}

describe("relay", () => {
  before(async () => {
    const fake = createServer(async (req, res) => {
      let text = "";
      for await (const chunk of req) text += chunk;
      upstreamRequests.push({ headers: req.headers, body: JSON.parse(text) });
      res.writeHead(upstreamReply.status, { "content-type": "application/json", ...upstreamReply.headers });
      res.end(JSON.stringify(upstreamReply.body));
    });
    upstream = { server: fake, url: await listen(fake) };
  });

  beforeEach(async () => {
    upstreamRequests = [];
    upstreamReply = { status: 200, headers: {}, body: { answers: { c0: { choice: "label" } } } };
    if (relay) await new Promise((resolve) => relay.server.close(resolve));
    relay = start();
    base = await listen(relay.server);
  });

  after(async () => {
    await new Promise((resolve) => relay.server.close(resolve));
    await new Promise((resolve) => upstream.server.close(resolve));
  });

  it("answers a signed-in account with what the model said, using its own key and model", async () => {
    const result = await call(`Bearer ${token()}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { answers: { c0: { choice: "label" } } });
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].headers.authorization, "Bearer upstream-key");
    assert.equal(upstreamRequests[0].body.model, "model-x");
    assert.deepEqual(Object.keys(upstreamRequests[0].body).sort(), ["model", "questions", "state"]);
    assert.equal(upstreamRequests[0].body.state.pieces[0].text, "SECRET-MARKER");
  });

  describe("refuses a request without a good token, and never reaches the model", () => {
    const now = Math.floor(Date.now() / 1000);
    const cases = {
      "no token": undefined,
      "not a token": "Bearer nonsense",
      "another issuer, such as an invitation": `Bearer ${token({ iss: "https://vault.example|invite" })}`,
      "an expired token": `Bearer ${token({ exp: now - 3600 })}`,
      "a token that is not valid yet": `Bearer ${token({ nbf: now + 3600 })}`,
      "a token signed by another key": `Bearer ${token({}, { key: stranger.privateKey })}`,
      "a token without an account": `Bearer ${token({ sub: "" })}`,
      "a token with no signature check": `Bearer ${encode({ alg: "none" })}.${encode({ iss: ISSUER, sub: "a", exp: now + 100 })}.`,
      "a token signed with the public key as a shared secret": (() => {
        const signed = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: ISSUER, sub: "a", exp: now + 100 })}`;
        return `Bearer ${signed}.${createHmac("sha256", publicPem).update(signed).digest("base64url")}`;
      })(),
    };
    for (const [name, header] of Object.entries(cases)) {
      it(name, async () => {
        const result = await call(header);
        assert.equal(result.status, 401);
        assert.equal(upstreamRequests.length, 0);
      });
    }
  });

  it("keeps each account to its allowance a minute and a day, apart from the others", async () => {
    const mine = `Bearer ${token({ sub: "mine" })}`;
    for (let i = 0; i < 5; i++) assert.equal((await call(mine)).status, 200);
    const limited = await call(mine);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(upstreamRequests.length, 5);
    assert.equal((await call(`Bearer ${token({ sub: "someone-else" })}`)).status, 200);

    await restart({ perMinute: 100, perDay: 3 });
    for (let i = 0; i < 3; i++) assert.equal((await call(mine)).status, 200);
    assert.equal((await call(mine)).status, 429);
  });

  it("refuses what is too large or not a request", async () => {
    const auth = `Bearer ${token()}`;
    const large = await call(auth, { state: { text: "x".repeat(6000) }, questions: {} }).catch(() => ({ status: 413 }));
    assert.equal(large.status, 413);
    assert.equal((await call(auth, "not json")).status, 400);
    assert.equal((await call(auth, { questions: {} })).status, 400);
    assert.equal((await call(auth, { state: [], questions: {} })).status, 400);
    assert.equal(upstreamRequests.length, 0);
  });

  it("does not show the person what went wrong at the model", async () => {
    await restart({ perMinute: 100, perDay: 100 });
    const auth = `Bearer ${token()}`;
    for (const status of [401, 403, 500, 503]) {
      upstreamReply = { status, headers: {}, body: { detail: "upstream-key rejected" } };
      const result = await call(auth);
      assert.equal(result.status, 502);
      assert.deepEqual(result.json, { error: "the reading service is unavailable" });
    }
    upstreamReply = { status: 429, headers: { "retry-after": "7" }, body: {} };
    const busy = await call(auth);
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get("retry-after"), "7");
    upstreamReply = { status: 422, headers: {}, body: { detail: "bad question" } };
    const bad = await call(auth);
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json, { detail: "bad question" });

    await restart({ upstreamUrl: "http://127.0.0.1:1/v1/systemone", perMinute: 100, perDay: 100 });
    assert.equal((await call(auth)).status, 502);
  });

  it("serves only its one route", async () => {
    assert.equal((await fetch(`${base}/v1/other`)).status, 404);
    assert.equal((await fetch(`${base}/v1/systemone`)).status, 405);
    const health = await (await fetch(`${base}/healthz`)).json();
    assert.equal(health.ok, true);
  });

  it("writes nothing about a request to a log, and counts without naming anyone", async () => {
    const written = [];
    const originals = ["log", "info", "warn", "error", "debug"].map((name) => [name, console[name]]);
    for (const [name] of originals) console[name] = (...args) => written.push(args.join(" "));
    try {
      await call(`Bearer ${token({ sub: "named-account" })}`);
      await call("Bearer nonsense");
    } finally {
      for (const [name, original] of originals) console[name] = original;
    }
    assert.deepEqual(written, []);
    const health = JSON.stringify(await (await fetch(`${base}/healthz`)).json());
    assert.ok(!health.includes("named-account") && !health.includes("SECRET-MARKER"));
    assert.equal(relay.counts.answered, 1);
    assert.equal(relay.counts.unauthorized, 1);
  });
});
