import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { loadConfig } from "../relay.mjs";

const directory = mkdtempSync(join(tmpdir(), "vowkey-relay-config-"));
const key = join(directory, "token.pem");
writeFileSync(key, "config test public key");
after(() => rmSync(directory, { recursive: true, force: true }));
const base = {
  RELAY_TOKEN_PUBLIC_KEY: key,
  RELAY_TOKEN_ISSUER: "https://vault.example|login",
  RELAY_UPSTREAM_URL: "http://127.0.0.1:8080",
};

test("private HTTP deployment requires an explicit operator choice", () => {
  const privateDeployment = {
    ...base,
    RELAY_TOKEN_ISSUER: "http://vault.localhost:8102|login",
    RELAY_ACCOUNT_CONSUME_URL: "http://server/api/decision/consume",
    RELAY_GUEST_CONSUME_URL: "http://server/identity/guest-decision/consume",
    RELAY_USAGE_URL: "http://server/api/decision/usage",
  };
  assert.throws(() => loadConfig(privateDeployment), /require HTTPS/);
  assert.throws(() => loadConfig({ ...privateDeployment, RELAY_ALLOW_HTTP: "false" }), /require HTTPS/);
  const config = loadConfig({ ...privateDeployment, RELAY_ALLOW_HTTP: "true" });
  assert.equal(config.accountConsumeUrl, "http://server/api/decision/consume");
  assert.equal(config.guestConsumeUrl, "http://server/identity/guest-decision/consume");
  assert.equal(config.usageUrl, "http://server/api/decision/usage");
});

test("HTTP opt-in does not allow endpoint credentials, fragments or other protocols", () => {
  for (const endpoint of ["http://user:password@server/api/decision/consume", "http://server/api/decision/consume#fragment", "file:///tmp/consume"]) {
    assert.throws(() => loadConfig({ ...base, RELAY_ALLOW_HTTP: "true", RELAY_ACCOUNT_CONSUME_URL: endpoint }), /require HTTPS/);
  }
});
