import assert from "node:assert/strict";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve as resolvePath } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { CANONICAL_DOCUMENT_KEYS, validDecision, validGraph, validVisionRead, visionResponseSchema } from "../protocol.mjs";
import { createRelay, loadConfig } from "../relay.mjs";

const ISSUER = "https://vault.example|login";
const GUEST_ISSUER = "https://vault.example|guest-decision";
const ACCOUNT = "d82c7818-1588-4699-a6fa-cfe223da37a9";
const OTHER = "5f991e71-f6e9-44c9-9871-d719a2c3bc29";
const DEVICE = "e0e69cb9-64cb-4cbc-8689-ac19de530468";
const INSTALLATION = "914e83c1-7984-41b0-9cd1-27f465fa2a48";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" });

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(claims = {}, { key = privateKey, header = { alg: "RS256", typ: "JWT" } } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISSUER, sub: ACCOUNT, device: DEVICE, sstamp: "test-stamp", scope: ["api", "offline_access"], nbf: now - 10, exp: now + 7200, ...claims };
  const signed = `${encode(header)}.${encode(body)}`;
  const signature = createSign("RSA-SHA256").update(signed).sign(key).toString("base64url");
  return `${signed}.${signature}`;
}

const body = { model: "anything", state: { pieces: [{ id: "c0", text: "PRINTED-MARKER", near: [] }] }, questions: { c0: { type: "choice", instructions: "Which printed detail?", criteria: { label: "A printed label", detail: "A printed detail" } } } };

let upstream;
let upstreamRequests;
let upstreamReply;
let relay;
let base;
let consumeRequests;
let consumeReply;
let readerRequests;
let readerReply;
let forwarded;
const graph = { v: 1, targetId: "collector-handle", formSignature: "structure-signature",
  sections: [{ id: "family", label: "Titular" }],
  fields: [{ id: "given", sectionId: "family", label: "Nome próprio", type: "text", options: [], format: "Latin letters" }] };
const asks = { v: 1, targetId: graph.targetId, formSignature: graph.formSignature,
  sections: [{ id: "family", label: "Titular", profileHint: null }],
  fields: [{ id: "given", sectionId: "family", what: "Nome próprio", whose: "Titular", format: { label: "Latin letters", options: [] } }] };
function guest(claims = {}) {
  const nbf = Math.floor(Date.now() / 1000) - 1;
  return token({ iss: GUEST_ISSUER, aud: "vowkey-decision-relay", sub: INSTALLATION, scope: ["decision.guest", "form.describe.guest"], nbf, exp: nbf + 3600, ...claims });
}

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
    guestTokenIssuer: GUEST_ISSUER,
    guestConsumeUrl: `${upstream.url}/consume`,
    formReaderUrl: `${upstream.url}/chat/completions`,
    formReaderModel: "configured-reader",
    formReaderKey: "reader-key",
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
      const request = { headers: req.headers, body: JSON.parse(text) };
      if (req.url === "/consume") {
        consumeRequests.push(request); forwarded.push("consume");
        res.writeHead(consumeReply.status, { "content-type": "application/json" }); res.end(JSON.stringify(consumeReply.body)); return;
      }
      if (req.url === "/chat/completions") {
        readerRequests.push(request); forwarded.push("reader");
        res.writeHead(readerReply.status, { "content-type": "application/json" }); res.end(JSON.stringify(readerReply.body)); return;
      }
      forwarded.push("decision");
      upstreamRequests.push({ headers: req.headers, body: JSON.parse(text) });
      res.writeHead(upstreamReply.status, { "content-type": "application/json", ...upstreamReply.headers });
      res.end(JSON.stringify(upstreamReply.body));
    });
    upstream = { server: fake, url: await listen(fake) };
  });

  beforeEach(async () => {
    upstreamRequests = [];
    consumeRequests = []; readerRequests = []; forwarded = [];
    consumeReply = { status: 200, body: { allowed: true } };
    readerReply = { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(asks) } }] } };
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
    assert.equal(upstreamRequests[0].body.state.pieces[0].text, "PRINTED-MARKER");
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
      "a refresh-like subject": `Bearer ${token({ sub: "not-a-user-uuid" })}`,
      "a refresh-like token without login claims": `Bearer ${token({ device: undefined, sstamp: undefined, scope: ["offline_access"] })}`,
      "a login token with guest audience": `Bearer ${token({ aud: "vowkey-decision-relay" })}`,
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
    const mine = `Bearer ${token({ sub: ACCOUNT })}`;
    for (let i = 0; i < 5; i++) assert.equal((await call(mine)).status, 200);
    const limited = await call(mine);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(upstreamRequests.length, 5);
    assert.equal((await call(`Bearer ${token({ sub: OTHER })}`)).status, 200);

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
      await call(`Bearer ${token({ sub: ACCOUNT })}`);
      await call("Bearer nonsense");
    } finally {
      for (const [name, original] of originals) console[name] = original;
    }
    assert.deepEqual(written, []);
    const health = JSON.stringify(await (await fetch(`${base}/healthz`)).json());
    assert.ok(!health.includes(ACCOUNT) && !health.includes("PRINTED-MARKER"));
    assert.equal(relay.counts.answered, 1);
    assert.equal(relay.counts.unauthorized, 1);
  });

  it("rejects extra fields, saved values, keys and binary before any consume or model call", async () => {
    const bad = [
      { ...body, extra: "not forwarded" },
      { ...body, key: "private" },
      { ...body, state: { ...body.state, ciphers: [] } },
      { ...body, state: { fields: [{ id: "f", asks: "Name", near: [], control: "text", value: "SAVED" }] } },
      { ...body, state: { pieces: [{ id: "p", text: "print", bytes: [1, 2, 3] }] } },
      { ...body, questions: { q: { type: "choice", instructions: "Choose", criteria: { name: { value: "SAVED" } } } } },
    ];
    for (const request of bad) assert.equal((await call(`Bearer ${guest()}`, request)).status, 400);
    assert.equal(consumeRequests.length, 0);
    assert.equal(upstreamRequests.length, 0);
  });

  it("consumes persistent guest authority before forwarding, across relay restarts", async () => {
    const auth = `Bearer ${guest()}`;
    assert.equal((await call(auth)).status, 200);
    assert.deepEqual(forwarded, ["consume", "decision"]);
    assert.equal(consumeRequests[0].headers.authorization, auth);
    assert.deepEqual(consumeRequests[0].body, { scope: "decision.guest" });
    consumeReply = { status: 429, body: {} };
    await restart();
    assert.equal((await call(auth)).status, 429);
    assert.equal(upstreamRequests.length, 1);
    for (const response of [{ status: 200, body: { allowed: false } }, { status: 503, body: {} }, { status: 401, body: {} }]) {
      consumeReply = response;
      assert.equal((await call(auth)).status, 503);
    }
    await restart({ guestConsumeUrl: "http://127.0.0.1:1/consume" });
    assert.equal((await call(auth)).status, 503);
    assert.equal(upstreamRequests.length, 1);
  });

  it("requires the guest issuer, audience and route-specific scope", async () => {
    for (const claims of [{ iss: ISSUER }, { aud: undefined }, { aud: "vault" }, { scope: ["form.describe.guest"] }, { sub: ACCOUNT, exp: Math.floor(Date.now() / 1000) + 8000 }]) {
      assert.equal((await call(`Bearer ${guest(claims)}`)).status, 401);
    }
    assert.equal(consumeRequests.length, 0);
    assert.equal(upstreamRequests.length, 0);
  });

  async function describeForm(auth, value = graph) {
    const response = await fetch(`${base}/v1/forms/describe`, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify(value) });
    return { status: response.status, json: await response.json() };
  }

  it("reads forms with the configured hosted model and validates its collector-bound asks", async () => {
    assert.deepEqual(await describeForm(`Bearer ${guest()}`), { status: 200, json: asks });
    assert.deepEqual(forwarded, ["consume", "reader"]);
    assert.deepEqual(consumeRequests[0].body, { scope: "form.describe.guest" });
    assert.equal(readerRequests[0].headers.authorization, "Bearer reader-key");
    assert.equal(readerRequests[0].body.model, "configured-reader");
    assert.deepEqual(JSON.parse(readerRequests[0].body.messages[1].content), graph);
    assert.equal(readerRequests[0].body.response_format.json_schema.strict, true);
    const fieldSchema = readerRequests[0].body.response_format.json_schema.schema.properties.fields.items;
    assert.ok(fieldSchema.required.includes("attribute") && fieldSchema.required.includes("owner"));

    const typedAsks = {
      ...asks,
      fields: [{ ...asks.fields[0], attribute: "name.given", owner: "applicant" }],
    };
    readerReply.body = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(typedAsks) } }] };
    assert.deepEqual(await describeForm(`Bearer ${guest()}`), { status: 200, json: typedAsks });

    for (const result of [
      { ...asks, targetId: "another-target" },
      { ...asks, fields: [{ ...asks.fields[0], id: "invented" }] },
      { ...asks, fields: [asks.fields[0], asks.fields[0]] },
      { ...asks, fields: [] },
      { ...asks, sections: [] },
      { ...asks, fields: [{ ...asks.fields[0], format: { label: "", options: ["invented"] } }] },
      { ...asks, fields: [{ ...asks.fields[0], attribute: "invented.attribute", owner: "applicant" }] },
      { ...asks, fields: [{ ...asks.fields[0], attribute: "name.given", owner: "invented_role" }] },
    ]) {
      readerReply.body = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] };
      assert.equal((await describeForm(`Bearer ${guest()}`)).status, 502);
    }
  });

  it("runs the same reader for accounts, and treats missing configuration as unavailable", async () => {
    assert.equal((await describeForm(`Bearer ${token()}`)).status, 200);
    assert.equal(consumeRequests.length, 0);
    await restart({ formReaderUrl: undefined, formReaderModel: undefined });
    assert.equal((await describeForm(`Bearer ${guest()}`)).status, 503);
    assert.equal(consumeRequests.length, 0);
    assert.equal((await describeForm(`Bearer ${guest()}`, { ...graph, fields: [{ ...graph.fields[0], currentValue: "SAVED" }] })).status, 400);
    assert.equal((await describeForm(`Bearer ${guest({ scope: ["decision.guest"] })}`)).status, 401);
  });

  it("allows optional piece confidence and bounding box in decision state while rejecting invalid ranges", async () => {
    const auth = `Bearer ${token()}`;
    const validWithMeta = {
      ...body,
      state: {
        pieces: [{ id: "c0", text: "PRINTED-MARKER", near: ["Surname"], confidence: 0.94, box: [0.12, 0.25, 0.3, 0.06] }],
      },
    };
    const ok = await call(auth, validWithMeta);
    assert.equal(ok.status, 200);
    assert.equal(upstreamRequests[0].body.state.pieces[0].confidence, 0.94);
    assert.deepEqual(upstreamRequests[0].body.state.pieces[0].box, [0.12, 0.25, 0.3, 0.06]);

    for (const badPiece of [
      { id: "c0", text: "x", confidence: -0.01 },
      { id: "c0", text: "x", confidence: 1.01 },
      { id: "c0", text: "x", confidence: "0.5" },
      { id: "c0", text: "x", confidence: null },
      { id: "c0", text: "x", box: [0.1, 0.2, 0.3] },
      { id: "c0", text: "x", box: [0.1, 0.2, 0.3, 0.4, 0.5] },
      { id: "c0", text: "x", box: ["0.1", 0.2, 0.3, 0.4] },
      { id: "c0", text: "x", box: null },
    ]) {
      assert.equal((await call(`Bearer ${guest()}`, { ...body, state: { pieces: [badPiece] } })).status, 400);
    }
    assert.equal(consumeRequests.length, 0);
  });

  it("keeps CANONICAL_DOCUMENT_KEYS synchronized with all 115 keys in vowkey-capture vocab.rs and defaults maxBodyBytes to 10MB", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const vocabPath = resolvePath(here, "../../sdk/crates/vowkey-capture/src/vocab.rs");
    const vocabSource = readFileSync(vocabPath, "utf8");
    const rustKeys = Array.from(vocabSource.matchAll(/Detail\s*\{\s*group:\s*"[^"]+",\s*key:\s*"([^"]+)"/g), (m) => m[1]);
    assert.equal(rustKeys.length, 115);
    assert.deepEqual([...CANONICAL_DOCUMENT_KEYS], rustKeys);

    const cfg = loadConfig({
      RELAY_UPSTREAM_URL: "http://127.0.0.1:9999/v1/systemone",
      RELAY_TOKEN_PUBLIC_KEY: resolvePath(here, "../../server/Cargo.toml"),
      RELAY_TOKEN_ISSUER: "http://127.0.0.1:8000|login",
    });
    assert.equal(cfg.maxBodyBytes, 10_000_000);
  });

  async function readVision(auth, value) {
    const response = await fetch(`${base}/v1/documents/read-vision`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(value),
    });
    return { status: response.status, json: await response.json() };
  }

  it("reads document photos via /v1/documents/read-vision for guests and accounts with date normalization", async () => {
    await restart({ maxBodyBytes: 10_000_000, perMinute: 2, perDay: 5 });
    const sampleImage = `data:image/jpeg;base64,${Buffer.from("fake-jpeg-bytes").toString("base64")}`;
    readerReply = {
      status: 200,
      body: {
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              kind: "id_card",
              items: [
                { key: "name.given", value: "  Monika " },
                { key: "name.family", value: "Sojli" },
                { key: "birth.date", value: "01-01-1980" },
                { key: "id.card.issued", value: "16-06-2004" },
                { key: "id.passport.issued", value: "令和5年4月1日" },
                { key: "id.passport.expiry", value: "12 AOÛT 2031" },
                { key: "work.start.date", value: "04/05/2024" },
                { key: "address.city", value: "" },
              ],
            }),
          },
        }],
      },
    };

    const guestRes = await readVision(`Bearer ${guest()}`, { v: 1, imageDataUrl: sampleImage, fileName: "id.jpg" });
    assert.equal(guestRes.status, 200);
    assert.deepEqual(guestRes.json, {
      kind: "id_card",
      details: {
        "name.given": "Monika",
        "name.family": "Sojli",
        "birth.date": "1980-01-01",
        "id.card.issued": "2004-06-16",
        "id.passport.issued": "2023-04-01",
        "id.passport.expiry": "2031-08-12",
        "work.start.date": "04/05/2024",
      },
    });
    assert.deepEqual(forwarded, ["consume", "reader"]);
    assert.deepEqual(consumeRequests[0].body, { scope: "decision.guest" });
    assert.equal(readerRequests[0].body.model, "configured-reader");
    assert.equal(readerRequests[0].body.response_format.json_schema.name, "document_vision_v1");
    assert.equal(readerRequests[0].body.response_format.json_schema.strict, true);
    assert.deepEqual(readerRequests[0].body.response_format.json_schema.schema, visionResponseSchema);
    assert.deepEqual(readerRequests[0].body.messages[1].content[1], {
      type: "image_url",
      image_url: { url: sampleImage, detail: "high" },
    });

    const acctAuth = `Bearer ${token()}`;
    assert.equal((await readVision(acctAuth, { v: 1, imageDataUrl: sampleImage })).status, 200);
    assert.equal((await readVision(acctAuth, { v: 1, imageDataUrl: sampleImage })).status, 200);
    assert.equal((await readVision(acctAuth, { v: 1, imageDataUrl: sampleImage })).status, 429);
    assert.equal(consumeRequests.length, 1);
  });

  it("validates /v1/documents/read-vision inputs, auth scopes, and upstream vision schema", async () => {
    await restart({ maxBodyBytes: 10_000_000 });
    const pngImage = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
    const webpImage = `data:image/webp;base64,${Buffer.from("webp-bytes").toString("base64")}`;
    assert.equal(validVisionRead({ v: 1, imageDataUrl: pngImage }), true);
    assert.equal(validVisionRead({ v: 1, imageDataUrl: webpImage, fileName: "scan.webp" }), true);

    assert.equal((await readVision(`Bearer ${guest({ scope: ["form.describe.guest"] })}`, { v: 1, imageDataUrl: pngImage })).status, 401);
    for (const invalid of [
      { v: 2, imageDataUrl: pngImage },
      { v: 1, imageDataUrl: "https://example.com/id.jpg" },
      { v: 1, imageDataUrl: "data:image/svg+xml;base64,AAAA" },
      { v: 1, imageDataUrl: "data:image/jpeg;base64,not valid base64!" },
      { v: 1, imageDataUrl: pngImage, extra: true },
      { v: 1, imageDataUrl: `data:image/jpeg;base64,${"A".repeat(8_000_000)}` },
    ]) {
      assert.equal((await readVision(`Bearer ${guest()}`, invalid)).status, 400);
    }
    assert.equal(consumeRequests.length, 0);

    for (const badUpstream of [
      { kind: "", items: [] },
      { kind: "id_card", items: [{ key: "invented.key", value: "x" }] },
      { kind: "id_card", items: [{ key: "name.given", value: "Monika", extra: 1 }] },
    ]) {
      readerReply = { status: 200, body: { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(badUpstream) } }] } };
      assert.equal((await readVision(`Bearer ${token()}`, { v: 1, imageDataUrl: pngImage })).status, 502);
    }

    await restart({ formReaderUrl: undefined, formReaderModel: undefined });
    assert.equal((await readVision(`Bearer ${guest()}`, { v: 1, imageDataUrl: pngImage })).status, 503);
    assert.equal(consumeRequests.length, 0);
  });

  it("accepts ISO 3166 country dropdowns (>200 options) and multi-page form booklets (>300 fields)", () => {
    const isoOptions = Array.from({ length: 250 }, (_, i) => `Country ${i}`);
    assert.equal(
      validGraph({
        v: 1,
        targetId: "file:cerfa.pdf",
        formSignature: "sig-cerfa",
        sections: [{ id: "main", label: "Main" }],
        fields: [{ id: "f_0", sectionId: "main", label: "Pays", type: "select-one", options: isoOptions }],
      }),
      true,
    );

    const bookletFields = Array.from({ length: 360 }, (_, i) => ({
      id: `f_${i}`,
      asks: `Field ${i}`,
      near: [],
      control: "text",
    }));
    assert.equal(
      validDecision({
        state: { fields: bookletFields },
        questions: {
          q0: { type: "choice", instructions: "Pick", criteria: { none: "None" } },
        },
      }),
      true,
    );
  });
});
