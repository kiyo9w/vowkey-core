#!/usr/bin/env node
// Signs in to a running vowkey-server with the master password, and sends requests through the
// relay (started here as its own process) with the access token the server gave. The model is a
// local stand-in that records what it receives. With RELAY_E2E_UPSTREAM_KEY set, one request also
// goes to the real Decision endpoint through a second relay.
//   node scripts/e2e-relay.mjs SERVER_URL EMAIL MASTER_PASSWORD
// RELAY_TOKEN_PUBLIC_KEY names the server's public key file and RELAY_TOKEN_ISSUER its login issuer.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { pbkdf2Sync, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [server, email, password] = process.argv.slice(2);
if (!server || !email || !password) {
  console.error("usage: e2e-relay.mjs SERVER_URL EMAIL MASTER_PASSWORD");
  process.exit(2);
}

const salt = email.trim().toLowerCase();
const masterKey = pbkdf2Sync(Buffer.from(password), Buffer.from(salt), 600000, 32, "sha256");
const masterPasswordHash = pbkdf2Sync(masterKey, Buffer.from(password), 1, 32, "sha256").toString("base64");

const login = await fetch(`${server.replace(/\/+$/, "")}/identity/connect/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "auth-email": Buffer.from(salt).toString("base64url") },
  body: new URLSearchParams({
    grant_type: "password",
    username: salt,
    password: masterPasswordHash,
    scope: "api offline_access",
    client_id: "web",
    deviceType: "9",
    deviceIdentifier: randomUUID(),
    deviceName: "relay end-to-end",
  }),
});
assert.equal(login.status, 200, `login failed: ${login.status} ${await login.clone().text()}`);
const accessToken = (await login.json()).access_token;
assert.ok(accessToken, "the server gave no access token");

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const received = [];
const model = createServer(async (req, res) => {
  let text = "";
  for await (const chunk of req) text += chunk;
  received.push({ authorization: req.headers.authorization, body: JSON.parse(text) });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ answers: { c0: { choice: "name", probabilities: { name: 0.9 } } } }));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

async function startRelay(upstreamUrl, upstreamKey) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, "relay/serve.mjs")], {
    env: {
      ...process.env,
      RELAY_PORT: String(port),
      RELAY_UPSTREAM_URL: upstreamUrl,
      RELAY_UPSTREAM_KEY: upstreamKey,
      RELAY_LIMIT_PER_MINUTE: "2",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("exit", (code) => reject(new Error(`the relay exited with ${code}`)));
  });
  return { url: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

const request = { state: { pieces: [{ id: "c0", text: "Lê Hoàng Minh" }] }, questions: { c0: { type: "choice", criteria: { name: "a name", none: "none" } } } };
const post = (url, token) =>
  fetch(`${url}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(request),
  });

const relay = await startRelay(`http://127.0.0.1:${model.address().port}/v1/systemone`, "the-relays-own-key");
try {
  const answered = await post(relay.url, accessToken);
  assert.equal(answered.status, 200, "the server's access token was not accepted");
  assert.equal((await answered.json()).answers.c0.choice, "name");
  assert.equal(received.length, 1);
  assert.equal(received[0].authorization, "Bearer the-relays-own-key");
  assert.notEqual(received[0].authorization, `Bearer ${accessToken}`, "the account's token went on to the model");
  assert.equal(received[0].body.state.pieces[0].text, "Lê Hoàng Minh");

  assert.equal((await post(relay.url, undefined)).status, 401, "a request without a token was answered");
  const [head, payload, signature] = accessToken.split(".");
  const forged = `${head}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), sub: "someone-else" })).toString("base64url")}.${signature}`;
  assert.equal((await post(relay.url, forged)).status, 401, "a token with a changed account was accepted");
  assert.equal(received.length, 1, "a refused request reached the model");

  assert.equal((await post(relay.url, accessToken)).status, 200);
  assert.equal((await post(relay.url, accessToken)).status, 429, "the account's allowance was not enforced");
  console.log("the relay answered the account the server signed in, refused the rest, and kept the account to its allowance");
} finally {
  relay.stop();
  model.close();
}

if (process.env.RELAY_E2E_UPSTREAM_KEY) {
  const url = process.env.RELAY_E2E_UPSTREAM_URL || "https://api.typesafe.ai/v1/systemone";
  const live = await startRelay(url, process.env.RELAY_E2E_UPSTREAM_KEY);
  try {
    const result = await post(live.url, accessToken);
    const body = await result.json();
    assert.equal(result.status, 200, `the real model answered ${result.status}`);
    assert.ok(body.answers?.c0?.choice, "the real model's answer has no choice");
    console.log(`the real model answered through the relay: ${body.answers.c0.choice}`);
  } finally {
    live.stop();
  }
}
