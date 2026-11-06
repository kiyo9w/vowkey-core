#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildLinhProfile } from "./linh-profile.mjs";
import { VK_META_FIELD, assertValidProfileEnvelope, projectProfileEnvelope } from "./demoday-family-dataset.mjs";
import { appendWorkspaceProfiles, buildProfileCipherView, encryptedCipherToApiPayload, normalizeServerCipherForWasm } from "./seed-demoday-pool.mjs";
import { unlockSeedAccount } from "./update-demoday-family-fields.mjs";

const require = createRequire(import.meta.url);
const { PureCrypto } = require("../sdk/crates/vowkey-wasm-internal/npm/node/vowkey_wasm_internal.js");
const here = path.dirname(fileURLToPath(import.meta.url));
const legacyFiles = new Set([
  "passport.jpg", "residence-front.jpg", "residence-back.jpg", "enrollment.jpg", "address.jpg",
  "residence-front.png", "residence-back.png", "enrollment.png", "bank-account.png",
]);
const obsoleteAttributes = new Set(["bank.account.purpose", "household.head.name", "household.relationship", "residence.request.office", "residence.change.request", "name", "name.kanji", "visa.work_restriction", "household.head.national_id", "address.registered_domicile", "bank.branch.code"]);
const value = (flag) => { const i = process.argv.indexOf(flag); return i < 0 ? undefined : process.argv[i + 1]; };
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const metaOf = (view) => JSON.parse(view.fields.find((field) => field.name === VK_META_FIELD)?.value ?? "null");
const isObsolete = (attribute) => obsoleteAttributes.has(attribute) || attribute.startsWith("residence_change.") || /\.(?:kana|kanji|hiragana|zengin|wareki)$/.test(attribute);

async function request(url, { method = "GET", headers = {}, body } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(url, {
    method, headers: { ...headers, ...(body && !multipart ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${new URL(url).pathname}: HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function stableCipher(raw) {
  const copy = structuredClone(raw);
  for (const attachment of copy.attachments ?? []) delete attachment.url;
  return digest(JSON.stringify(copy));
}

function isLinh(view, meta, record) {
  return view.name === record.person.name_vi && meta?.kind === "person" &&
    meta.details.some((detail) => detail.attribute === "id.passport.number" && detail.variants.some((variant) => variant.value === record.passport.number));
}

function alreadyCurrent(meta, template) {
  return template.meta.sources.every((source) => meta.sources.some((old) => old.sha256 === source.sha256 && old.fileName === source.fileName && old.attachmentId)) &&
    template.meta.details.every((detail) => meta.details.some((old) => old.attribute === detail.attribute && detail.variants.every((variant) => old.variants.some((prior) => prior.value === variant.value && prior.script === variant.script)))) &&
    !meta.sources.some((source) => legacyFiles.has(source.fileName) &&
      !template.meta.sources.some((current) => current.fileName === source.fileName && current.sha256 === source.sha256)) &&
    !meta.details.some((detail) => isObsolete(detail.attribute));
}

async function migrate({ base, email, password, directory, apply, resetLive }) {
  const record = JSON.parse(fs.readFileSync(path.join(directory, "linh.json"), "utf8"));
  assert.equal(record.country, "KR");
  const template = buildLinhProfile(directory);
  const liveHash = digest(fs.readFileSync(path.join(directory, record.live_ocr.file)));
  assert.ok(template.meta.sources.every((source) => source.sha256 !== liveHash), "Live OCR image must stay out of the seed");
  assert.ok(template.meta.details.every((detail) => !record.live_ocr.excluded_attributes.includes(detail.attribute)), "Live OCR facts must stay out of the seed");
  const session = await unlockSeedAccount({ base, email, password });
  const { token, claims, userKey, headers } = session;
  try {
    const before = await request(`${base}/api/sync`, { headers });
    const matches = before.ciphers.map((raw) => {
      const view = PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(raw), userKey);
      return { raw, view, meta: metaOf(view) };
    }).filter(({ view, meta }) => isLinh(view, meta, record));
    assert.ok(matches.length <= 1, "More than one seeded Linh profile; refusing an ambiguous cutover");
    const existing = matches[0];
    const passportHash = template.meta.sources.find((source) => source.fileName === "passport.jpg")?.sha256;
    assert.ok(!existing || (passportHash && existing.meta.sources.some((source) => source.sha256 === passportHash)),
      "The matching person does not carry the seeded sample passport; refusing to replace it");
    const unrelated = new Map(before.ciphers.filter((raw) => raw.id !== existing?.raw.id).map((raw) => [raw.id, stableCipher(raw)]));
    const liveAttachmentIds = new Set((existing?.meta.sources ?? [])
      .filter((source) => resetLive && source.sha256 === liveHash).map((source) => source.attachmentId));
    const current = existing && alreadyCurrent(existing.meta, template) && liveAttachmentIds.size === 0;
    const plan = { email, mode: apply ? "apply" : "dry-run", action: existing ? current ? "already-current" : "replace-seeded-Linh" : "append-Linh", seedOriginals: template.attachments.length, liveImageExcludedFromSeed: true, unrelatedItems: unrelated.size };
    if (!apply) return plan;
    if (!existing) {
      await appendWorkspaceProfiles({ baseUrl: base, accessToken: token.access_token, userId: claims.sub, userKey, profilesTemplate: [template] });
    } else if (!current) {
      const { raw, view, meta: oldMeta } = existing;
      const meta = structuredClone(template.meta);
      meta.profileId = oldMeta.profileId;
      const knownAttributes = new Set(meta.details.map((detail) => detail.attribute));
      const never = new Set(oldMeta.details.filter((detail) => detail.agentRule === "never").map((detail) => detail.attribute));
      for (const detail of meta.details) if (never.has(detail.attribute)) detail.agentRule = "never";
      const preservedSources = oldMeta.sources.filter((source) =>
        !legacyFiles.has(source.fileName) &&
        !record.documents.some((document) => document.fileName === source.fileName) &&
        !(resetLive && source.sha256 === liveHash));
      const preservedSourceIds = new Set(preservedSources.map((source) => source.id));
      for (const detail of oldMeta.details) {
        if (!knownAttributes.has(detail.attribute) && !isObsolete(detail.attribute)) {
          const kept = structuredClone(detail);
          kept.variants = kept.variants.filter((variant) => !variant.sourceId || preservedSourceIds.has(variant.sourceId));
          if (kept.variants.length) {
            if (!kept.variants.some((variant) => variant.id === kept.chosenVariantId)) kept.chosenVariantId = kept.variants[0].id;
            meta.details.push(kept);
          }
        }
      }
      const uploadedIds = [];
      let committed = false;
      try {
        for (let i = 0; i < template.attachments.length; i++) {
          const attachment = template.attachments[i];
          const source = meta.sources[i];
          const reusable = oldMeta.sources.find((old) => old.sha256 === source.sha256 && old.fileName === source.fileName && old.attachmentId);
          if (reusable) {
            const newId = source.id;
            Object.assign(source, reusable);
            for (const detail of meta.details) for (const variant of detail.variants) if (variant.sourceId === newId) variant.sourceId = source.id;
            continue;
          }
          const encrypted = PureCrypto.encrypt_legacy_attachment(normalizeServerCipherForWasm(raw), { id: source.id, fileName: source.fileName }, new Uint8Array(attachment.bytes), userKey);
          const contents = Uint8Array.from(encrypted.contents);
          const upload = await request(`${base}/api/ciphers/${raw.id}/attachment/v2`, { method: "POST", headers, body: { fileName: encrypted.attachment.fileName, key: encrypted.attachment.key, fileSize: contents.byteLength } });
          uploadedIds.push(upload.attachmentId);
          const form = new FormData();
          form.set("data", new Blob([contents], { type: "application/octet-stream" }), "data");
          await request(`${base}/api/ciphers/${raw.id}/attachment/${upload.attachmentId}`, { method: "POST", headers, body: form });
          source.attachmentId = upload.attachmentId;
        }
        meta.sources.push(...preservedSources);
        assertValidProfileEnvelope(meta);
        const generated = buildProfileCipherView({ id: raw.id, key: view.key, name: template.name, favorite: true, meta });
        const oldProjected = new Set(projectProfileEnvelope(oldMeta).text.keys());
        const extraFields = view.fields.filter((field) => field.name !== VK_META_FIELD && !oldProjected.has(field.name));
        const nextView = { ...view, ...generated, creationDate: view.creationDate, fields: [...generated.fields, ...extraFields] };
        await request(`${base}/api/ciphers/${raw.id}`, { method: "PUT", headers, body: encryptedCipherToApiPayload(PureCrypto.encrypt_legacy_cipher(nextView, userKey), claims.sub) });
        committed = true;
      } finally {
        if (!committed) for (const id of uploadedIds) await request(`${base}/api/ciphers/${raw.id}/attachment/${id}`, { method: "DELETE", headers });
      }
    }
    const updated = await request(`${base}/api/sync`, { headers });
    const profile = updated.ciphers.map((raw) => {
      const view = PureCrypto.decrypt_legacy_cipher(normalizeServerCipherForWasm(raw), userKey);
      return { raw, view, meta: metaOf(view) };
    }).find(({ view, meta }) => isLinh(view, meta, record));
    assert.ok(profile && alreadyCurrent(profile.meta, template), "Korean profile did not round-trip correctly");
    assert.ok(profile.meta.sources.every((source) => (profile.raw.attachments ?? []).some((attachment) => attachment.id === source.attachmentId)), "An original is missing its stored attachment");
    if (existing) {
      assert.equal(profile.raw.id, existing.raw.id, "Cipher identity must stay stable");
      assert.equal(profile.meta.profileId, existing.meta.profileId, "Profile identity must stay stable");
      for (const old of existing.meta.details.filter((detail) => detail.agentRule === "never")) {
        const detail = profile.meta.details.find((item) => item.attribute === old.attribute);
        if (detail) assert.equal(detail.agentRule, "never", "Explicit denials must survive");
      }
    }
    const activeIds = new Set(profile.meta.sources.map((source) => source.attachmentId));
    for (const attachment of profile.view.attachments ?? []) {
      if (!activeIds.has(attachment.id) &&
          (legacyFiles.has(attachment.fileName) || liveAttachmentIds.has(attachment.id) ||
           record.documents.some((document) => document.fileName === attachment.fileName))) {
        await request(`${base}/api/ciphers/${profile.raw.id}/attachment/${attachment.id}`, { method: "DELETE", headers });
      }
    }
    const after = await request(`${base}/api/sync`, { headers });
    for (const [id, hash] of unrelated) assert.equal(stableCipher(after.ciphers.find((raw) => raw.id === id)), hash, "An unrelated item changed during cutover");
    const liveImagePresentInAccount = profile.meta.sources.some((source) => source.sha256 === liveHash);
    if (resetLive) assert.equal(liveImagePresentInAccount, false, "The live document must be held out again");
    return { ...plan, details: profile.meta.details.length, originals: profile.meta.sources.length, profileIdPreserved: Boolean(existing), unrelatedItemsUnchanged: true, liveImagePresentInAccount };
  } finally {
    userKey.fill(0);
  }
}

const email = value("--email");
const password = process.env.VOWKEY_DEMO_PASSWORD;
assert.ok(email && password, "Pass --email and set VOWKEY_DEMO_PASSWORD");
const result = await migrate({
  base: (value("--base-url") ?? "https://vault.vowkey.app").replace(/\/$/, ""),
  email, password, apply: process.argv.includes("--apply"), resetLive: process.argv.includes("--reset-live-ocr"),
  directory: value("--linh-dir") ?? path.resolve(here, "../../vowkey/Demo/live/linh"),
});
console.log(JSON.stringify(result));
