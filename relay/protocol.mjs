const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2048) => typeof value === "string" && value.length <= max && !value.includes("\0");
const id = (value) => text(value, 256) && value.length > 0;
const keys = (value, allowed) => object(value) && Object.keys(value).every((key) => allowed.includes(key));
const list = (value, max, validate) => Array.isArray(value) && value.length <= max && value.every(validate);
const texts = (value, max = 100, width = 2048) => list(value, max, (item) => text(item, width));
const optional = (value, validate) => value === undefined || validate(value);
const unique = (rows) => new Set(rows.map((row) => row.id)).size === rows.length;
const nullableText = (value) => value === null || text(value);
const confidence = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const box = (value) => Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n));
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export const LIMITS = Object.freeze({
  pieces: 1000, fields: 800, sections: 150, questions: 100, criteria: 1000, options: 400, visionImageChars: 8_000_000,
});

export const CANONICAL_DOCUMENT_KEYS = Object.freeze([
  "name.full", "name.family", "name.given", "name.middle", "name.birth",
  "name.full.latin", "name.family.latin", "name.given.latin",
  "name.full.kana", "name.family.kana", "name.given.kana",
  "name.full.hiragana", "name.family.hiragana", "name.given.hiragana",
  "birth.date", "birth.era", "birth.era_year", "birth.age", "birth.place", "birth.country",
  "person.sex", "person.nationality", "person.marital_status", "person.profession",
  "person.religion", "person.ethnicity", "person.blood_type",
  "id.passport.number", "id.passport.issued", "id.passport.country", "id.passport.expiry",
  "id.national.number", "id.card.number", "id.card.issued", "id.card.expiry", "id.card.extra_number",
  "id.certificate.number", "id.certificate.issued",
  "id.issuing_authority", "id.driver_license.class", "id.driver_license.restrictions",
  "id.residence_card.number", "id.residence_card.issued",
  "visa.status", "visa.period", "visa.expiry", "visa.work_restriction", "visa.work_permission",
  "id.mynumber", "id.driver_license.number", "id.ssn.last4",
  "id.pension.number", "id.employment_insurance.number",
  "id.health_insurance.symbol", "id.health_insurance.number", "id.health_insurance.branch",
  "id.health_insurance.insurer_number", "id.health_insurance.expiry",
  "id.tax.de_steuer_id", "id.tax.number", "id.employer.ein",
  "address.full", "address.postal", "address.prefecture", "address.city", "address.street", "address.building", "address.country",
  "address.previous",
  "contact.phone.mobile", "contact.phone.home", "contact.phone", "contact.phone.country", "contact.email",
  "work.employer.name", "work.employer.name.kana", "work.employer.address", "work.employer.postal",
  "work.employer.phone", "work.employer.representative", "work.title", "work.department",
  "work.employee_id", "work.employment_type", "work.start.date", "work.hours", "work.job_description",
  "income.annual", "income.bonus", "income.monthly.base", "income.monthly.overtime",
  "income.monthly.commute", "income.monthly.housing", "income.monthly.gross", "income.monthly.net",
  "income.insurance.health", "income.insurance.pension", "income.insurance.employment", "income.insurance.total",
  "income.deductions.total",
  "income.tax.income", "income.tax.resident", "income.pay_date", "income.pay_period",
  "bank.name", "bank.code", "bank.branch.name", "bank.branch.name.kana", "bank.branch.code",
  "bank.account.type", "bank.account.number", "bank.account.balance", "bank.account.holder.kanji", "bank.account.holder.kana",
  "bank.iban", "bank.bic", "bank.jp_post.symbol", "bank.jp_post.number",
  "card.holder", "card.number", "card.brand", "card.expiry",
  "education.school.name", "education.school.address", "education.grade", "education.degree", "education.graduation.date",
  "emergency.name", "emergency.name.kana", "emergency.relation", "emergency.phone", "emergency.address",
  "family.father.name", "family.father.birth.date", "family.father.nationality",
  "family.mother.name", "family.mother.birth.date", "family.mother.nationality",
  "family.guardian.name",
  "spouse.name", "spouse.birth.date", "spouse.person.nationality", "spouse.contact.phone",
  "spouse.id.national.number", "spouse.id.residence_card.number", "spouse.id.passport.number",
  "dependent.name", "dependent.birth.date", "dependent.person.sex", "dependent.relation",
  "dependent.id.national.number", "dependent.id.residence_card.number", "dependent.id.passport.number",
  "household_head.name", "household_head.relation",
  "household_head.id.national.number", "household_head.id.residence_card.number",
]);
export const CANONICAL_OWNERS = Object.freeze([
  "applicant", "spouse", "dependent", "employer", "landlord",
  "household_head", "preparer", "guarantor", "official_only", "other",
]);
const CANONICAL_DOCUMENT_KEY_SET = new Set(CANONICAL_DOCUMENT_KEYS);
const CANONICAL_OWNER_SET = new Set(CANONICAL_OWNERS);
const ROLE_PREFIXED_KEY = /^(?:spouse|dependent|household_head|household_member|employer|landlord|guarantor|preparer|family|father|mother)(?:\.[1-9][0-9]?)?\.(.+)$/;
const ROLE_SUFFIX_SHORTHANDS = new Set(["name", "relation"]);
const CUSTOM_DOCUMENT_KEY = /^custom\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/;
export const isValidDocumentKey = (value) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false;
  if (CANONICAL_DOCUMENT_KEY_SET.has(value) || CUSTOM_DOCUMENT_KEY.test(value)) return true;
  const roleMatch = ROLE_PREFIXED_KEY.exec(value);
  return Boolean(roleMatch && (
    CANONICAL_DOCUMENT_KEY_SET.has(roleMatch[1]) ||
    ROLE_SUFFIX_SHORTHANDS.has(roleMatch[1]) ||
    CUSTOM_DOCUMENT_KEY.test(roleMatch[1])
  ));
};

export function validGraph(graph) {
  if (!keys(graph, ["v", "targetId", "formSignature", "sections", "fields"]) || graph.v !== 1 ||
      !id(graph.targetId) || !id(graph.formSignature) ||
      !list(graph.sections, LIMITS.sections, (section) => keys(section, ["id", "label"]) && id(section.id) && text(section.label)) ||
      !unique(graph.sections) || graph.sections.length === 0 ||
      !list(graph.fields, LIMITS.fields, (field) => keys(field, ["id", "sectionId", "label", "type", "options", "format"]) &&
        id(field.id) && id(field.sectionId) && text(field.label) && text(field.type, 100) &&
        texts(field.options, LIMITS.options) && optional(field.format, text)) || !unique(graph.fields) || graph.fields.length === 0) return false;
  const sections = new Set(graph.sections.map((section) => section.id));
  return graph.fields.every((field) => sections.has(field.sectionId));
}

export function validFormAsks(asks, graph) {
  if (!keys(asks, ["v", "targetId", "formSignature", "sections", "fields"]) || asks.v !== 1 ||
      asks.targetId !== graph.targetId || asks.formSignature !== graph.formSignature ||
      !list(asks.sections, LIMITS.sections, (section) => keys(section, ["id", "label", "profileHint"]) &&
        id(section.id) && text(section.label) && nullableText(section.profileHint)) || !unique(asks.sections) ||
      asks.sections.length !== graph.sections.length ||
      !list(asks.fields, LIMITS.fields, (field) => keys(field, ["id", "sectionId", "what", "whose", "format", "attribute", "owner"]) &&
        id(field.id) && id(field.sectionId) && text(field.what) && text(field.whose) &&
        optional(field.attribute, (v) => v === "none" || CANONICAL_DOCUMENT_KEY_SET.has(v)) &&
        optional(field.owner, (v) => CANONICAL_OWNER_SET.has(v)) &&
        keys(field.format, ["label", "options"]) && text(field.format.label) && texts(field.format.options, LIMITS.options)) ||
      !unique(asks.fields) || asks.fields.length !== graph.fields.length) return false;
  const sections = new Set(graph.sections.map((section) => section.id));
  const fields = new Map(graph.fields.map((field) => [field.id, field]));
  return asks.sections.every((section) => sections.has(section.id)) && asks.fields.every((field) => {
    const observed = fields.get(field.id);
    return observed?.sectionId === field.sectionId && field.format.options.length === observed.options.length &&
      field.format.options.every((option, i) => option === observed.options[i]);
  });
}

function validAsks(value) {
  if (!object(value) || !Array.isArray(value.sections) || !Array.isArray(value.fields)) return false;
  const graph = {
    v: value.v, targetId: value.targetId, formSignature: value.formSignature,
    sections: value.sections.map((section) => ({ id: section?.id, label: section?.label })),
    fields: value.fields.map((field) => ({ id: field?.id, sectionId: field?.sectionId, label: field?.what,
      type: "text", options: field?.format?.options })),
  };
  return validGraph(graph) && validFormAsks(value, graph);
}

function validState(state) {
  if (!object(state) || !optional(state.about, (value) => text(value, 4096))) return false;
  if (Object.hasOwn(state, "pieces")) {
    return keys(state, ["about", "pieces", "document_kind"]) && optional(state.document_kind, text) &&
      list(state.pieces, LIMITS.pieces, (piece) => keys(piece, ["id", "text", "near", "group", "confidence", "box"]) && id(piece.id) &&
        text(piece.text, 8192) && optional(piece.near, (value) => texts(value, 32)) && optional(piece.group, text) &&
        optional(piece.confidence, confidence) && optional(piece.box, box)) && unique(state.pieces);
  }
  if (Object.hasOwn(state, "parts")) {
    return keys(state, ["about", "parts"]) && list(state.parts, LIMITS.pieces, (part) => keys(part, ["id", "text", "of", "near"]) &&
      id(part.id) && text(part.text, 8192) && text(part.of, 8192) && optional(part.near, (value) => texts(value, 32))) && unique(state.parts);
  }
  if (Object.hasOwn(state, "fields")) {
    return keys(state, ["about", "fields"]) && list(state.fields, LIMITS.fields, (field) => keys(field, ["id", "asks", "near", "control", "group"]) &&
      id(field.id) && text(field.asks) && texts(field.near, 32) && text(field.control, 100) && optional(field.group, text)) && unique(state.fields);
  }
  return keys(state, ["about", "asks", "details", "profiles"]) && validAsks(state.asks) &&
    list(state.details, LIMITS.criteria, (detail) => keys(detail, ["id", "label", "profileId", "attribute", "script", "format", "variantId"]) &&
      id(detail.id) && text(detail.label) && id(detail.profileId) &&
      [detail.attribute, detail.script, detail.format, detail.variantId].every((value) => optional(value, nullableText))) &&
    optional(state.profiles, (profiles) => list(profiles, LIMITS.sections, (profile) => keys(profile, ["id", "label"]) && id(profile.id) && text(profile.label)) && unique(profiles));
}

export function validDecision(request) {
  return keys(request, ["model", "state", "questions"]) && optional(request.model, (value) => text(value, 256)) &&
    validState(request.state) && object(request.questions) &&
    Object.keys(request.questions).length > 0 && Object.keys(request.questions).length <= LIMITS.questions &&
    Object.entries(request.questions).every(([name, question]) => id(name) && keys(question, ["type", "instructions", "criteria"]) &&
      question.type === "choice" && text(question.instructions, 4096) && object(question.criteria) &&
      Object.keys(question.criteria).length > 0 && Object.keys(question.criteria).length <= LIMITS.criteria &&
      Object.entries(question.criteria).every(([key, value]) => id(key) && text(value, 4096)));
}

export function validVisionRead(body) {
  if (!keys(body, ["v", "imageDataUrl", "fileName"]) || body.v !== 1 ||
      !text(body.imageDataUrl, LIMITS.visionImageChars) || !optional(body.fileName, (value) => text(value, 512))) return false;
  const match = IMAGE_DATA_URL.exec(body.imageDataUrl);
  return Boolean(match && match[1].length >= 4 && match[1].length % 4 === 0);
}

export function validImageFill(body) {
  return keys(body, ["v", "imageDataUrl", "fileName", "details"]) &&
    validVisionRead({ v: body.v, imageDataUrl: body.imageDataUrl, fileName: body.fileName }) &&
    object(body.details) && Object.keys(body.details).length > 0 &&
    Object.keys(body.details).length <= 500 &&
    Object.entries(body.details).every(([key, value]) => id(key) && text(value, 8192));
}

export const visionResponseSchema = Object.freeze({
  type: "object", additionalProperties: false, required: ["kind", "items"],
  properties: {
    kind: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["key", "value", "box"],
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          box: {
            anyOf: [
              { type: "null" },
              {
                type: "array", minItems: 4, maxItems: 4,
                items: { type: "number", minimum: 0, maximum: 1 },
              },
            ],
          },
        },
      },
    },
  },
});

export function validVisionResponse(value) {
  return keys(value, ["kind", "items"]) && id(value.kind) &&
    list(value.items, LIMITS.pieces, (item) => keys(item, ["key", "value", "box"]) &&
      isValidDocumentKey(item.key) && text(item.value, 8192));
}

const JAPANESE_ERAS = Object.freeze({ 令和: 2018, 平成: 1988, 昭和: 1925, 大正: 1911, 明治: 1867 });
const MONTH_HEADS = Object.freeze({
  jan: 1, ene: 1, gen: 1, feb: 2, fev: 2, mar: 3, mrt: 3, apr: 4, avr: 4, abr: 4,
  may: 5, mai: 5, mei: 5, mag: 5, jun: 6, giu: 6, jul: 7, lug: 7, aug: 8, aou: 8, ago: 8,
  sep: 9, set: 9, oct: 10, okt: 10, out: 10, ott: 10, nov: 11, dec: 12, dez: 12, dic: 12,
});

function foldWord(word) {
  return word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
}

function monthOf(word) {
  const folded = foldWord(word);
  if (folded.startsWith("juin")) return 6;
  if (folded.startsWith("juil")) return 7;
  return MONTH_HEADS[folded.slice(0, 3)] ?? null;
}

function isoDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) ||
      year < 1800 || year > 2200 || month < 1 || month > 12 || day < 1) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > maxDay) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizePrintedDate(raw) {
  const ascii = raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)).trim();
  const eraMatch = /^(令和|平成|昭和|大正|明治)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/.exec(ascii);
  if (eraMatch) {
    const eraYear = eraMatch[2] === "元" ? 1 : Number(eraMatch[2]);
    return isoDate(JAPANESE_ERAS[eraMatch[1]] + eraYear, Number(eraMatch[3]), Number(eraMatch[4]));
  }
  const jpMatch = /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/.exec(ascii);
  if (jpMatch) return isoDate(Number(jpMatch[1]), Number(jpMatch[2]), Number(jpMatch[3]));
  const vnMatch = /^ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})$/i.exec(ascii);
  if (vnMatch) return isoDate(Number(vnMatch[3]), Number(vnMatch[2]), Number(vnMatch[1]));

  const numbers = Array.from(ascii.matchAll(/\d+/g), (m) => m[0]);
  const words = Array.from(ascii.matchAll(/\p{L}+/gu), (m) => m[0]);
  let monthWord = null;
  for (const w of words) {
    monthWord = monthOf(w);
    if (monthWord !== null) break;
  }
  if (monthWord !== null && numbers.length === 2) {
    if (numbers[1].length === 4 && numbers[0].length <= 2) return isoDate(Number(numbers[1]), monthWord, Number(numbers[0]));
    if (numbers[0].length === 4 && numbers[1].length <= 2) return isoDate(Number(numbers[0]), monthWord, Number(numbers[1]));
    return null;
  }
  if (words.length === 0 && numbers.length === 3) {
    if (numbers[0].length === 4 && numbers[1].length <= 2 && numbers[2].length <= 2) {
      return isoDate(Number(numbers[0]), Number(numbers[1]), Number(numbers[2]));
    }
    if (numbers[2].length === 4 && numbers[0].length <= 2 && numbers[1].length <= 2) {
      const a = Number(numbers[0]), b = Number(numbers[1]), year = Number(numbers[2]);
      if (a === b || (a > 12 && b <= 12)) return isoDate(year, b, a);
      if (b > 12 && a <= 12) return isoDate(year, a, b);
    }
  }
  return null;
}

function isDateKey(key) {
  return key === "birth.date" || key.endsWith(".date") || key.endsWith(".issued") ||
    key.endsWith(".expiry") || key === "income.pay_date";
}

function nextDistinctKey(details, baseKey) {
  for (let n = 2; n <= 20; n++) {
    const candidate = baseKey.startsWith("dependent.")
      ? `dependent.${n}.${baseKey.slice("dependent.".length)}`
      : `${baseKey}.${n}`;
    if (!Object.hasOwn(details, candidate)) return candidate;
  }
  return null;
}

export function visionItemsWithLocators(items) {
  const details = {};
  const locators = {};
  for (const { key, value, box: rawBox } of items) {
    const collapsed = value.trim().replace(/\s+/g, " ");
    if (!collapsed) continue;
    const normalized = isDateKey(key) ? (normalizePrintedDate(collapsed) ?? collapsed) : collapsed;
    let targetKey = key;
    if (Object.hasOwn(details, key)) {
      if (details[key] === normalized) continue;
      const next = nextDistinctKey(details, key);
      if (!next) continue;
      targetKey = next;
    }
    details[targetKey] = normalized;
    if (Array.isArray(rawBox) && rawBox.length === 4 &&
      rawBox.every((n) => typeof n === "number" && Number.isFinite(n)) &&
      rawBox[0] >= 0 && rawBox[1] >= 0 && rawBox[2] > 0 && rawBox[3] > 0 &&
      rawBox[0] + rawBox[2] <= 1.001 && rawBox[1] + rawBox[3] <= 1.001) {
      const [x, y, w, h] = rawBox;
      locators[targetKey] = { page: 0, x, y, w, h };
    }
  }
  return { details, locators };
}

export function visionItemsToDetails(items) {
  return visionItemsWithLocators(items).details;
}

export function formResponseSchema(graph) {
  const string = { type: "string" };
  return {
    type: "object", additionalProperties: false, required: ["v", "targetId", "formSignature", "sections", "fields"],
    properties: {
      v: { type: "integer", enum: [1] }, targetId: { type: "string", enum: [graph.targetId] },
      formSignature: { type: "string", enum: [graph.formSignature] },
      sections: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "label", "profileHint"], properties: {
        id: { type: "string", enum: graph.sections.map((section) => section.id) }, label: string, profileHint: { type: ["string", "null"] },
      } } },
      fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "sectionId", "what", "whose", "attribute", "owner", "format"], properties: {
        id: { type: "string", enum: graph.fields.map((field) => field.id) },
        sectionId: { type: "string", enum: graph.sections.map((section) => section.id) }, what: string, whose: string,
        attribute: { type: "string", enum: ["none", ...CANONICAL_DOCUMENT_KEYS] },
        owner: { type: "string", enum: [...CANONICAL_OWNERS] },
        format: { type: "object", additionalProperties: false, required: ["label", "options"], properties: { label: string, options: { type: "array", items: string } } },
      } } },
    },
  };
}
