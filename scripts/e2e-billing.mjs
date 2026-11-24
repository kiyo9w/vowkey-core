#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const [server, email, password, database] = process.argv.slice(2);
const secret = process.env.PADDLE_WEBHOOK_SECRET;
if (!server || !email || !password || !database || !secret) {
  throw new Error("usage: e2e-billing.mjs SERVER EMAIL PASSWORD DATABASE; PADDLE_WEBHOOK_SECRET required");
}
const base = server.replace(/\/+$/, "");
const salt = email.trim().toLowerCase();
const masterKey = pbkdf2Sync(password, salt, 600000, 32, "sha256");
const hash = pbkdf2Sync(masterKey, password, 1, 32, "sha256").toString("base64");
const login = await fetch(`${base}/identity/connect/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "auth-email": Buffer.from(salt).toString("base64url") },
  body: new URLSearchParams({ grant_type: "password", username: salt, password: hash,
    scope: "api offline_access", client_id: "web", deviceType: "9",
    deviceIdentifier: randomUUID(), deviceName: "billing replay" }),
});
assert.equal(login.status, 200, `login: ${await login.clone().text()}`);
const token = (await login.json()).access_token;
const account = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
const owner = { type: "user", id: account };
const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const request = (path, body, extra = {}) => fetch(`${base}/api${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { ...headers, ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function entitlement() {
  const response = await request("/billing/entitlement");
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).personal;
}
let sequence = 0;
const epoch = Date.now() - 3_600_000;
function subscription(status, price = "pri_family", subscriptionId = "sub_family", quantity = 1) {
  sequence += 1;
  return { event_id: `evt_subscription_${sequence}`, event_type: "subscription.updated",
    occurred_at: new Date(epoch + sequence * 1000).toISOString(),
    data: { id: subscriptionId, customer_id: "ctm_fixture", custom_data: { owner, campaign: "launch" }, status,
      items: [{ price: { id: price }, quantity }],
      current_billing_period: { ends_at: new Date(Date.now() + 86_400_000).toISOString() } } };
}
async function webhook(event, { timestamp = Math.floor(Date.now() / 1000), signingSecret = secret } = {}) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", signingSecret).update(`${timestamp}:${body}`).digest("hex");
  return fetch(`${base}/api/billing/webhooks/paddle`, { method: "POST",
    headers: { "content-type": "application/json", "Paddle-Signature": `ts=${timestamp};h1=${signature}` }, body });
}
async function apply(event) {
  const response = await webhook(event);
  assert.equal(response.status, 200, await response.clone().text());
}
const initial = await entitlement();
assert.equal(initial.basePlan, "free");
assert.equal(initial.storageKb, 1_048_576);
assert.equal(initial.decisionPerDay, 300);
assert.equal(initial.decisionPerMonth, 0);
assert.equal(initial.hasPaidBase, false);
const acquisitionDb = new DatabaseSync(database);
try {
  assert.equal(acquisitionDb.prepare("SELECT acquisition_campaign FROM users WHERE uuid = ?").get(account).acquisition_campaign, "launch");
} finally { acquisitionDb.close(); }
assert.equal(initial.creditUnits, 0);
const denied = subscription("active");
assert.equal((await webhook(denied, { signingSecret: "not-the-fixture-secret" })).status, 401);
assert.equal((await webhook(denied, { timestamp: Math.floor(Date.now() / 1000) - 60 })).status, 401);
assert.equal((await entitlement()).basePlan, "free");

for (const status of ["active", "trialing", "past_due", "paused", "canceled"]) {
  await apply(subscription(status));
  const plan = await entitlement();
  assert.equal(plan.basePlan, ["paused", "canceled"].includes(status) ? "free" : "family", status);
  assert.equal(plan.seats, ["paused", "canceled"].includes(status) ? 1 : 6, status);
}
const active = subscription("active");
await apply(active);
const renewal = subscription("active");
await apply(renewal);
const older = subscription("active");
older.occurred_at = new Date(epoch).toISOString();
await apply(older);
const eventsDb = new DatabaseSync(database);
try {
  const metadata = eventsDb.prepare("SELECT plan_code, campaign FROM billing_events WHERE event_id = ?");
  assert.deepEqual({ ...metadata.get(active.event_id) }, { plan_code: "family", campaign: "launch" });
  assert.deepEqual({ ...metadata.get(renewal.event_id) }, { plan_code: null, campaign: null });
  assert.deepEqual({ ...metadata.get(older.event_id) }, { plan_code: null, campaign: null });
  assert.equal(eventsDb.prepare("SELECT COUNT(*) AS count FROM billing_events WHERE event_id = ?").get(active.event_id).count, 1);
} finally { eventsDb.close(); }
await apply(active);
await apply(subscription("active", "pri_storage", "sub_storage", 2));
await apply(subscription("active", "pri_hosted", "sub_hosted", 1));
let plan = await entitlement();
assert.equal(plan.basePlan, "family");
assert.equal(plan.hasPaidBase, true);
assert.equal(plan.storageKb, 60 * 1_048_576);
assert.equal(plan.hostedAgent, true);
assert.equal(plan.decisionPerDay, 1000);
assert.equal(plan.decisionPerMonth, 3000);
await apply(subscription("canceled"));
await apply(active);
assert.equal((await entitlement()).basePlan, "free", "old events cannot reactivate a canceled plan");
await apply(subscription("canceled", "pri_hosted", "sub_hosted"));

const unknown = subscription("active", "pri_unknown", "sub_unknown");
assert.equal((await webhook(unknown)).status, 400);
unknown.data.items[0].price.id = "pri_family";
await apply(unknown);
assert.equal((await entitlement()).basePlan, "family", "failed parsing must not consume the event id");
await apply(subscription("canceled", "pri_family", "sub_unknown"));

const credits = { event_id: "evt_credits", event_type: "transaction.completed",
  data: { custom_data: { owner }, items: [{ price: { id: "pri_credits" }, quantity: 1 }] } };
await apply(credits);
await apply(credits);
assert.equal((await entitlement()).creditUnits, 2, "duplicate payment must not add credits twice");
for (let i = 0; i < 300; i += 1) {
  const response = await request("/decision/consume", {});
  assert.equal(response.status, 200, `daily request ${i}: ${await response.clone().text()}`);
}
for (const remaining of [1, 0]) {
  const response = await request("/decision/consume", {});
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).creditUnits, remaining);
}
assert.equal((await request("/decision/consume", {})).status, 429);
const db = new DatabaseSync(database);
try {
  db.prepare("UPDATE decision_balances SET allowance_day = ?, used_today = ? WHERE owner_uuid = ?")
    .run("2000-01-01", 300, account);
} finally { db.close(); }
const nextDay = await request("/decision/consume", {});
assert.equal(nextDay.status, 200, await nextDay.clone().text());
assert.equal((await nextDay.json()).remaining, 299);
assert.equal((await entitlement()).usedToday, 1);

await apply(subscription("active", "pri_hosted", "sub_hosted"));
await apply({ ...credits, event_id: "evt_monthly_credits" });
const monthlyDb = new DatabaseSync(database);
try {
  monthlyDb.prepare("UPDATE decision_balances SET allowance_day = ?, used_today = 300, allowance_month = ?, used_this_month = 2999 WHERE owner_uuid = ?")
    .run(new Date().toISOString().slice(0, 10), new Date().toISOString().slice(0, 7), account);
  const lastMonthly = await request("/decision/consume", {});
  assert.equal(lastMonthly.status, 200);
  assert.equal((await lastMonthly.json()).creditUnits, 2, "monthly units precede purchased credits");
  assert.equal((await entitlement()).usedThisMonth, 3000);
  for (const remaining of [1, 0]) {
    const paid = await request("/decision/consume", {});
    assert.equal(paid.status, 200);
    assert.equal((await paid.json()).creditUnits, remaining);
  }
  assert.equal((await request("/decision/consume", {})).status, 429);
  monthlyDb.prepare("UPDATE decision_balances SET allowance_day = ? WHERE owner_uuid = ?").run("2000-01-01", account);
  assert.equal((await request("/decision/consume", {})).status, 200);
  assert.equal((await entitlement()).usedToday, 1);
  assert.equal((await entitlement()).usedThisMonth, 3000, "a new day does not refill the monthly bucket");
  monthlyDb.prepare("UPDATE decision_balances SET used_today = 300, allowance_month = ? WHERE owner_uuid = ?").run("2000-01", account);
  const newMonth = await request("/decision/consume", {});
  assert.equal(newMonth.status, 200);
  assert.equal((await newMonth.json()).remaining, 2999);
  assert.equal((await entitlement()).usedThisMonth, 1);
  await apply({ ...credits, event_id: "evt_retained_credits" });
  await apply(subscription("canceled", "pri_hosted", "sub_hosted"));
  assert.equal((await entitlement()).decisionPerMonth, 0);
  assert.equal((await entitlement()).creditUnits, 2, "canceling Hosted Agent preserves purchased credits");
} finally { monthlyDb.close(); }
assert.equal((await request("/decision/consume", { organizationId: randomUUID() })).status, 403);
assert.equal((await request("/billing/checkout", { planCode: "office", quantity: 3 })).status, 400);
const missingAuth = await fetch(`${base}/api/billing/entitlement`);
assert.equal(missingAuth.status, 401);
console.log("billing replay passed: signed webhooks, campaign cohorts, statuses, additive plans, ordering, duplicate credits, daily/monthly allowances, UTC rollover, cancellation, authorization");
