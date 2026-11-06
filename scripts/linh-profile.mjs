import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertValidProfileEnvelope } from "./demoday-family-dataset.mjs";

const aliases = {
  "name.full": ["name.full.latin"],
  "name.full.hangul": ["custom.name_full_hangul", "name.full"],
  "contact.phone.mobile": ["contact.phone"],
  "education.faculty": ["custom.education_faculty_department"],
  "education.student_id": ["custom.student_number"],
  "education.school.phone": ["custom.school_phone"],
  "education.status": ["custom.enrollment_status"],
  "education.enrolled": ["custom.education_admission_date"],
  "bank.account.currency": ["custom.bank_account_currency"],
  "bank.account.opened": ["custom.bank_account_opened"],
};
const scripts = { latin: "Latn", kana: "Kana", kanji: "Hani", hiragana: "Hira", hangul: "Hang" };

/** Demo fixture only. Document-backed values use observed reader boxes; other values stay typed. */
export function buildLinhProfile(directory) {
  const record = JSON.parse(fs.readFileSync(path.join(directory, "linh.json"), "utf8"));
  const readings = JSON.parse(fs.readFileSync(path.join(directory, "source-readings.json"), "utf8"));
  const documentNames = new Set(record.documents.map((document) => document.fileName));
  assert.deepEqual(new Set(Object.keys(readings)), documentNames, "Seed readings must match the listed originals");
  const attachments = record.documents.map((document) => {
    const { fileName, mediaType } = document;
    const reading = readings[fileName];
    const bytes = fs.readFileSync(path.join(directory, document.path));
    return { bytes, reading, source: {
      id: crypto.randomUUID(), attachmentId: null, fileName, mediaType,
      kind: reading.kind, capturedAt: new Date().toISOString(), status: "current",
      documentDate: null, effectiveOn: null, expiresOn: null,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    } };
  });
  const details = new Map();
  for (const [key, value] of Object.entries(record.profile)) {
    const suffix = key.split(".").at(-1);
    const script = scripts[suffix] ?? null;
    const attribute = script ? key.slice(0, -suffix.length - 1) : key;
    let detail = details.get(attribute);
    if (!detail) {
      detail = {
        id: crypto.randomUUID(), attribute, label: attribute,
        valueType: /(?:\.date|\.expiry)$/.test(attribute) ? "date" : "text",
        agentRule: "fill",
        chosenVariantId: null, variants: [], history: [], conflicts: [],
      };
      details.set(attribute, detail);
    }
    const normalize = (text) => String(text ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/\b(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})\b/g, (_, year, month, day) => `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`);
    const expectedValue = normalize(value);
    const sourceKeys = [key, ...(aliases[key] ?? [])];
    const evidence = attachments.flatMap(({ reading, source }) => {
      for (const sourceKey of sourceKeys) {
        if (reading.locators?.[sourceKey] && normalize(reading.details?.[sourceKey]) === expectedValue) {
          return [{ source, locator: reading.locators[sourceKey] }];
        }
      }
      return [];
    });
    for (const entry of evidence.length ? evidence : [null]) {
      const variant = {
        id: crypto.randomUUID(), value, script, tag: null, current: true,
        sourceId: entry?.source.id ?? null,
        locator: entry ? { kind: "page", ...entry.locator } : null,
        origin: entry ? "ocr" : "typed", verified: Boolean(entry),
      };
      detail.variants.push(variant);
      detail.chosenVariantId ??= variant.id;
    }
  }
  const meta = {
    v: 1, profileId: crypto.randomUUID(), kind: "person", relationship: "self",
    status: "confirmed", sources: attachments.map(({ source }) => source), details: [...details.values()],
  };
  assertValidProfileEnvelope(meta);
  return { name: record.person.name_vi, favorite: true, meta, attachments };
}
