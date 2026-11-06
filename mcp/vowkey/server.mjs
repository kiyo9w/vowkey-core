#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const profilePath = process.env.VOWKEY_PROFILE_PATH ?? path.resolve(here, "../../../vowkey/Demo/live/linh/linh.json");
// The server must answer `initialize` whatever state the demo profile is in, so a missing file or
// field narrows what it offers instead of stopping it.
let profile = { profile: {}, person: {} };
try {
  profile = JSON.parse(await readFile(profilePath, "utf8"));
} catch (error) {
  process.stderr.write(`Vowkey MCP: no demo profile at ${profilePath} (${error.message}). Starting without references.\n`);
}
const saved = profile.profile ?? {};
const fields = {
  applicant_name_hangul: ["name.full.hangul", "성명(한글)"],
  applicant_name_latin: ["name.full", "성명(영문)"],
  birth_date: ["birth.date", "생년월일"],
  nationality: ["person.nationality", "국적"],
  postal_code: ["address.postal", "우편번호"],
  address: ["address.street", "주소"],
  address_detail: ["address.building", "상세 주소"],
  mobile_phone: ["contact.phone.mobile", "휴대전화 번호"],
  email_address: ["contact.email", "이메일 주소"],
  alien_registration_number: ["id.residence_card.number", "외국인등록번호"],
  visa_status: ["visa.status", "체류자격"],
  stay_expiry_date: ["visa.expiry", "체류기간 만료일"],
  passport_number: ["id.passport.number", "여권 번호"],
  passport_expiry_date: ["id.passport.expiry", "여권 유효기간"],
  bank_name: ["bank.name", "은행명"],
  bank_code: ["bank.code", "은행 코드"],
  branch_name: ["bank.branch.name", "지점명"],
  account_type: ["bank.account.type", "예금 종류"],
  account_number: ["bank.account.number", "계좌번호"],
  account_holder: ["bank.account.holder", "예금주 성명"],
  school_name: ["education.school.name", "학교명"],
  faculty: ["education.faculty", "학부"],
  department: ["education.department", "전공·학과"],
  student_id: ["education.student_id", "학번"],
  school_phone: ["education.school.phone", "학교 전화번호"],
  birth_place: ["birth.place", "출생지"],
};
for (const [fieldId, [key]] of Object.entries(fields)) {
  if (typeof saved[key] !== "string" || !saved[key]) delete fields[fieldId];
}
const values = new Map(Object.values(fields).map(([key]) => [`@vk:linh/${key}`, saved[key]]));
const labels = new Map(Object.values(fields).map(([key, label]) => [`@vk:linh/${key}`, label]));

let stage = "idle";
let captureSent = false;
let requestId = "";
let entries = [];
let resolved = [];
let result;
const waiters = new Set();
function notify() { for (const wake of [...waiters]) wake(); }
function waitFor(predicate, timeoutMs) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!predicate()) return;
      clearTimeout(timer);
      waiters.delete(check);
      resolve();
    };
    const timer = setTimeout(() => {
      waiters.delete(check);
      reject(new Error("The Vowkey form did not respond. Keep the form tab open and try again."));
    }, timeoutMs);
    waiters.add(check);
  });
}
function sendJson(response, status, body) {
  response.writeHead(status, {
    "access-control-allow-origin": "http://127.0.0.1:18770",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) throw new Error("request_too_large");
  }
  return JSON.parse(body || "{}");
}
const bridge = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.headers.origin && request.headers.origin !== "http://127.0.0.1:18770") {
    sendJson(response, 403, { error: "origin_not_allowed" });
    return;
  }
  if (request.method === "OPTIONS") { sendJson(response, 204, {}); return; }
  if (request.method === "GET" && url.pathname === "/__vk/poll") {
    if (stage === "capture" && !captureSent) {
      captureSent = true;
      sendJson(response, 200, { action: "capture", requestId });
    } else if (stage === "permission") {
      sendJson(response, 200, { action: "permission", requestId, entries: entries.map(({ fieldId, label, reference, known }) => ({ fieldId, label, reference, known })) });
    } else if (stage === "write") {
      stage = "writing";
      sendJson(response, 200, { action: "write", requestId, entries: resolved });
    } else {
      sendJson(response, 200, { action: "idle", requestId });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/__vk/markers") {
    try {
      const body = await readJson(request);
      if (stage !== "capture" || body.requestId !== requestId || !Array.isArray(body.entries)) { sendJson(response, 409, { error: "no_capture_pending" }); return; }
      entries = body.entries.filter((item) => item && typeof item.fieldId === "string" && typeof item.reference === "string" && fields[item.fieldId])
        .map((item) => ({ fieldId: item.fieldId, label: labels.get(item.reference) ?? fields[item.fieldId][1], reference: item.reference.slice(0, 240), known: values.has(item.reference) }));
      resolved = entries.filter((item) => values.has(item.reference)).map((item) => ({ fieldId: item.fieldId, reference: item.reference, value: values.get(item.reference) }));
      if (!entries.length) { stage = "complete"; result = { filled: 0, skipped: 0, message: "No @vk: references were found on the Vowkey form." }; }
      else stage = "permission";
      notify();
      sendJson(response, 200, { accepted: true, count: entries.length });
    } catch { sendJson(response, 400, { error: "invalid_request" }); }
    return;
  }
  if (request.method === "POST" && url.pathname === "/__vk/permission") {
    try {
      const body = await readJson(request);
      if (stage !== "permission" || body.requestId !== requestId || !["allow", "deny"].includes(body.decision)) { sendJson(response, 409, { error: "no_permission_pending" }); return; }
      if (body.decision === "allow") stage = "write";
      else { stage = "complete"; result = { filled: 0, skipped: entries.length, denied: true }; }
      notify();
      sendJson(response, 200, { accepted: true });
    } catch { sendJson(response, 400, { error: "invalid_request" }); }
    return;
  }
  if (request.method === "POST" && url.pathname === "/__vk/complete") {
    try {
      const body = await readJson(request);
      if (stage !== "writing" || body.requestId !== requestId || !Array.isArray(body.outcomes)) { sendJson(response, 409, { error: "no_write_pending" }); return; }
      const filled = body.outcomes.filter((outcome) => outcome === "filled").length;
      result = { filled, skipped: entries.length - filled, message: "Linh's seeded Vowkey profile was used. Review the form; it was not submitted." };
      stage = "complete";
      notify();
      sendJson(response, 200, { accepted: true });
    } catch { sendJson(response, 400, { error: "invalid_request" }); }
    return;
  }
  sendJson(response, 404, { error: "not_found" });
});
const bridgePortBase = Number(process.env.VOWKEY_BRIDGE_PORT ?? 18771);
const bridgePortCount = 16;
async function listenForBridge() {
  for (let port = bridgePortBase; port < bridgePortBase + bridgePortCount; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { bridge.off("listening", onListening); reject(error); };
        const onListening = () => { bridge.off("error", onError); resolve(); };
        bridge.once("error", onError);
        bridge.once("listening", onListening);
        bridge.listen(port, "127.0.0.1");
      });
      bridge.on("error", (error) => { process.stderr.write(`Vowkey MCP bridge error: ${error.message}\n`); });
      return;
    } catch (error) {
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`No Vowkey MCP bridge port is available in ${bridgePortBase}-${bridgePortBase + bridgePortCount - 1}.`);
}

const server = new McpServer({ name: "Vowkey MCP", version: "1.0.0" });
// When the client goes away the server goes with it, so no orphan keeps a bridge port.
const stop = () => { bridge.close(); setTimeout(() => process.exit(0), 50).unref(); };
server.server.onclose = stop;
process.stdin.on("end", stop);
process.stdin.on("close", stop);
server.tool("list_references", "List fields available from Linh's seeded Vowkey profile. Values stay inside Vowkey MCP.", {}, async () => ({
  content: [{ type: "text", text: JSON.stringify({ profile: profile.person?.name_vi ?? null, references: [...values.keys()].map((reference) => ({ reference, label: labels.get(reference) })) }) }],
}));
server.tool("resolve_form", "Resolve @vk: references on the open Vowkey form from Linh's seeded profile after the person approves the form confirmation. Never submits the form.", {}, async () => {
  if (stage !== "idle" && stage !== "complete") return { isError: true, content: [{ type: "text", text: "A Vowkey form fill is already in progress." }] };
  stage = "capture";
  captureSent = false;
  requestId = crypto.randomUUID();
  entries = [];
  resolved = [];
  result = undefined;
  notify();
  try {
    await waitFor(() => stage === "permission" || stage === "complete", 20_000);
    if (stage !== "complete") await waitFor(() => stage === "complete", 90_000);
    const final = result;
    stage = "idle";
    return { content: [{ type: "text", text: JSON.stringify(final) }] };
  } catch (error) {
    stage = "idle";
    notify();
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Vowkey form fill failed." }] };
  }
});
await server.connect(new StdioServerTransport());
// The form bridge starts after the handshake. If no port is free the tools still list; resolving a form reports it.
listenForBridge().catch((error) => process.stderr.write(`Vowkey MCP bridge unavailable: ${error.message}\n`));
