import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const VK_META_FIELD = "vk.meta";

const IDENTITY_ATTRIBUTES = [
  ["title", "name.prefix"],
  ["firstName", "name.given"],
  ["middleName", "name.middle"],
  ["lastName", "name.family"],
  ["address1", "address.street"],
  ["address2", "address.building"],
  ["address3", "address.line3"],
  ["city", "address.city"],
  ["state", "address.prefecture"],
  ["postalCode", "address.postal"],
  ["country", "address.country"],
  ["company", "work.employer.name"],
  ["email", "contact.email"],
  ["phone", "contact.phone"],
  ["ssn", "id.ssn"],
  ["passportNumber", "id.passport.number"],
  ["licenseNumber", "id.driver_license.number"],
];

const SUFFIXES = [
  { suffix: ".latin", script: "Latn", tag: null },
  { suffix: ".kana", script: "Kana", tag: null },
  { suffix: ".hiragana", script: "Hira", tag: null },
  { suffix: ".kanji", script: "Hani", tag: null },
  { suffix: ".hangul", script: "Hang", tag: null },
  { suffix: ".wareki", script: null, tag: "wareki" },
  { suffix: ".zengin", script: null, tag: "zengin" },
];

function joinKey(attribute, script, tag) {
  const found = SUFFIXES.find((s) => s.script === script && s.tag === tag);
  return found ? attribute + found.suffix : attribute;
}

function pbox(x, y, w, h) {
  return { kind: "page", page: 0, x, y, w, h };
}

function mkVariant({
  value,
  sourceId = null,
  locator = null,
  script = null,
  tag = null,
  origin = "ocr",
  verified = false,
  current = true,
}) {
  return {
    id: crypto.randomUUID(),
    script,
    tag,
    value,
    current,
    sourceId,
    locator,
    verified,
    origin,
  };
}

function mkDetail({
  attribute,
  label,
  valueType = "text",
  agentRule = "fill",
  variants,
  history = [],
}) {
  const builtVariants = variants.map((v) => mkVariant(v));
  const builtHistory = history.map((h) => ({
    variant: mkVariant({ ...h.variant, current: false }),
    retiredAt: h.retiredAt ?? "2025-04-25T09:00:00.000Z",
    reason: h.reason ?? "superseded",
  }));
  return {
    id: crypto.randomUUID(),
    attribute,
    label,
    valueType,
    chosenVariantId: builtVariants[0]?.id ?? null,
    agentRule,
    variants: builtVariants,
    history: builtHistory,
    conflicts: [],
  };
}

function mkSource(cleanDir, spec) {
  const bytes = fs.readFileSync(path.join(cleanDir, spec.diskFile));
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const source = {
    id: crypto.randomUUID(),
    attachmentId: null,
    fileName: spec.fileName,
    mediaType: "image/jpeg",
    kind: spec.kind,
    documentDate: spec.documentDate ?? null,
    effectiveOn: spec.effectiveOn ?? null,
    capturedAt: "2026-11-05T01:00:00.000Z",
    expiresOn: spec.expiresOn ?? null,
    sha256,
    status: "current",
  };
  if (spec.sides) {
    source.sides = spec.sides;
  }
  return { source, bytes, diskFile: spec.diskFile };
}

export function projectProfileEnvelope(meta) {
  const identity = {};
  const text = new Map();

  const sourceOf = (id) => (id == null ? undefined : meta.sources.find((s) => s.id === id));
  const winnerAmong = (detail, candidates) => {
    if (candidates.length === 0) return null;
    const chosen = candidates.find((v) => v.id === detail.chosenVariantId);
    if (chosen) return chosen;
    const rank = (v, key) => sourceOf(v.sourceId)?.[key] ?? "";
    return [...candidates].sort(
      (a, b) =>
        rank(b, "effectiveOn").localeCompare(rank(a, "effectiveOn")) ||
        rank(b, "documentDate").localeCompare(rank(a, "documentDate")) ||
        (b.sourceId ?? "").localeCompare(a.sourceId ?? "") ||
        b.id.localeCompare(a.id),
    )[0];
  };
  const resolveDetailVariant = (detail) => {
    const current = detail.variants.filter((v) => v.current);
    const chosen = current.find((v) => v.id === detail.chosenVariantId);
    return chosen ?? winnerAmong(detail, current.filter((v) => v.tag == null));
  };

  for (const detail of meta.details) {
    if (detail.valueType === "secret") continue;
    const native = IDENTITY_ATTRIBUTES.find(([, attr]) => attr === detail.attribute);
    let winner = null;
    if (native && native[0] === "firstName") {
      const latin = detail.variants.filter((v) => v.current && v.tag == null && v.script === "Latn");
      winner = winnerAmong(detail, latin) ?? resolveDetailVariant(detail);
    } else {
      winner = resolveDetailVariant(detail);
    }
    if (native && winner) {
      identity[native[0]] = winner.value;
    }
    for (const variant of detail.variants) {
      if (!variant.current || variant.origin === "derived") continue;
      const name =
        detail.attribute != null
          ? joinKey(detail.attribute, variant.script, variant.tag)
          : detail.label;
      const rival = detail.variants.filter(
        (v) => v.current && v.script === variant.script && v.tag === variant.tag,
      );
      const holder = winnerAmong(detail, rival);
      if (holder?.id === variant.id) {
        text.set(name, variant.value);
      }
    }
  }
  return { identity, text };
}

export function assertValidProfileEnvelope(meta) {
  if (!meta || meta.v !== 1 || typeof meta.profileId !== "string") {
    throw new Error("Invalid envelope header");
  }
  if (!["person", "organization"].includes(meta.kind)) {
    throw new Error(`Invalid kind: ${meta.kind}`);
  }
  if (!["confirmed", "draft"].includes(meta.status)) {
    throw new Error(`Invalid status: ${meta.status}`);
  }
  const sourceIds = new Set(meta.sources.map((s) => s.id));
  for (const s of meta.sources) {
    if (!s.id || !s.fileName || !s.mediaType || !s.kind || !s.capturedAt) {
      throw new Error(`Invalid source: ${JSON.stringify(s)}`);
    }
    if (!["current", "retained", "deleted"].includes(s.status)) {
      throw new Error(`Invalid source status: ${s.status}`);
    }
    const usedCurrent = meta.details.some((d) =>
      d.variants.some((v) => v.current && v.sourceId === s.id),
    );
    if (!usedCurrent) {
      throw new Error(`Source ${s.fileName} has zero current variants and would settle to retained!`);
    }
  }
  const checkLocator = (loc, ctx) => {
    if (loc == null) return;
    if (loc.kind !== "page" || loc.page !== 0) {
      throw new Error(`Invalid locator kind/page in ${ctx}: ${JSON.stringify(loc)}`);
    }
    for (const k of ["x", "y", "w", "h"]) {
      const val = loc[k];
      if (typeof val !== "number" || !Number.isFinite(val) || val < 0 || val > 1) {
        throw new Error(`Out-of-bounds locator ${k}=${val} in ${ctx}`);
      }
    }
    if (loc.x + loc.w > 1.001 || loc.y + loc.h > 1.001 || loc.w <= 0 || loc.h <= 0) {
      throw new Error(`Invalid box dimensions in ${ctx}: ${JSON.stringify(loc)}`);
    }
  };
  for (const d of meta.details) {
    if (!d.id || typeof d.label !== "string") {
      throw new Error(`Invalid detail: ${JSON.stringify(d)}`);
    }
    if (!["text", "date", "phone", "email", "address", "number", "link", "secret"].includes(d.valueType)) {
      throw new Error(`Invalid valueType ${d.valueType} on ${d.label}`);
    }
    if (!["ask", "fill", "never"].includes(d.agentRule)) {
      throw new Error(`Invalid agentRule ${d.agentRule} on ${d.label}`);
    }
    if (!d.variants.length) {
      throw new Error(`Detail ${d.label} has no variants`);
    }
    for (const v of d.variants) {
      if (v.sourceId != null && !sourceIds.has(v.sourceId)) {
        throw new Error(`Unknown sourceId ${v.sourceId} in ${d.label}`);
      }
      if (v.sourceId != null && v.locator == null) {
        throw new Error(`Missing locator for document-backed variant in ${d.label}`);
      }
      checkLocator(v.locator, `${d.label}:${v.value}`);
    }
    for (const h of d.history) {
      if (!["superseded", "correction", "dismissed"].includes(h.reason)) {
        throw new Error(`Invalid history reason ${h.reason}`);
      }
      if (h.variant.current !== false) {
        throw new Error(`History variant must have current=false in ${d.label}`);
      }
      if (h.variant.sourceId != null && !sourceIds.has(h.variant.sourceId)) {
        throw new Error(`Unknown history sourceId in ${d.label}`);
      }
      checkLocator(h.variant.locator, `history:${d.label}:${h.variant.value}`);
    }
  }
}

export function buildTranFamilyProfiles(cleanDir) {
  // =========================================================================
  // 1. TRẦN MINH KHOA (Father / Self — 7 documents)
  // =========================================================================
  const fRcFront = mkSource(cleanDir, {
    diskFile: "residence-card-father-front.jpg",
    fileName: "Residence Card (Front) — Trần Minh Khoa.jpg",
    kind: "Residence card",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["front"],
  });
  const fPassport = mkSource(cleanDir, {
    diskFile: "passport-father.jpg",
    fileName: "Passport — Trần Minh Khoa.jpg",
    kind: "Passport",
    documentDate: "2023-03-14",
    effectiveOn: "2023-03-14",
    expiresOn: "2033-03-14",
  });
  const fJuminhyo = mkSource(cleanDir, {
    diskFile: "juminhyo-household.jpg",
    fileName: "Certificate of Residence (Juminhyo) — Trần Family.jpg",
    kind: "Certificate of residence (Juminhyo)",
    documentDate: "2026-10-28",
    effectiveOn: "2026-10-28",
  });
  const fInsurance = mkSource(cleanDir, {
    diskFile: "health-insurance-father.jpg",
    fileName: "Health Insurance Certificate — Trần Minh Khoa.jpg",
    kind: "Health insurance certificate",
    documentDate: "2025-12-01",
    effectiveOn: "2025-12-01",
    expiresOn: "2030-11-30",
  });
  const fPayslip = mkSource(cleanDir, {
    diskFile: "payslip-father-2026-10.jpg",
    fileName: "Payslip (Oct 2026) — Trần Minh Khoa.jpg",
    kind: "Payslip",
    documentDate: "2026-10-23",
    effectiveOn: "2026-10-23",
  });
  const fBank = mkSource(cleanDir, {
    diskFile: "bank-passbook-father.jpg",
    fileName: "Bank Passbook — Trần Minh Khoa.jpg",
    kind: "Bank passbook",
    documentDate: "2026-10-27",
    effectiveOn: "2026-10-27",
  });
  const fRcBack = mkSource(cleanDir, {
    diskFile: "residence-card-father-back.jpg",
    fileName: "Residence Card (Back) — Trần Minh Khoa.jpg",
    kind: "Residence card (back)",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["back"],
  });

  const fatherSources = [fRcFront, fPassport, fJuminhyo, fInsurance, fPayslip, fBank, fRcBack];
  const fatherMeta = {
    v: 1,
    profileId: "",
    kind: "person",
    relationship: "self",
    status: "confirmed",
    sources: fatherSources.map((x) => x.source),
    details: [
      mkDetail({
        attribute: "name.full",
        label: "Full name",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN MINH KHOA",
            script: null,
            sourceId: fPassport.source.id,
            locator: pbox(0.382, 0.24, 0.233, 0.04),
            origin: "ocr",
            verified: true,
          },
          {
            value: "TRAN MINH KHOA",
            script: "Latn",
            sourceId: fRcFront.source.id,
            locator: pbox(0.098, 0.136, 0.311, 0.041),
            origin: "ocr",
            verified: true,
          },
          {
            value: "チャン ミン コア",
            script: "Kana",
            sourceId: fJuminhyo.source.id,
            locator: pbox(0.67, 0.17, 0.174, 0.018),
            origin: "ocr",
          },
          {
            value: "ﾁﾔﾝ ﾐﾝ ｺｱ",
            script: null,
            tag: "zengin",
            sourceId: fBank.source.id,
            locator: pbox(0.181, 0.222, 0.134, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "name.family",
        label: "Family name",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN",
            script: null,
            sourceId: fPassport.source.id,
            locator: pbox(0.381, 0.239, 0.078, 0.042),
            origin: "ocr",
            verified: true,
          },
          {
            value: "TRAN",
            script: "Latn",
            sourceId: fPassport.source.id,
            locator: pbox(0.381, 0.239, 0.078, 0.042),
            origin: "mrz",
            verified: true,
          },
          { value: "チャン", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "name.given",
        label: "Given name",
        agentRule: "fill",
        variants: [
          {
            value: "MINH KHOA",
            script: "Latn",
            sourceId: fPassport.source.id,
            locator: pbox(0.46, 0.239, 0.155, 0.042),
            origin: "mrz",
            verified: true,
          },
          { value: "ミン コア", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "birth.date",
        label: "Date of birth",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "1989-04-17",
            sourceId: fRcFront.source.id,
            locator: pbox(0.143, 0.23, 0.202, 0.039),
            origin: "ocr",
            verified: true,
          },
          {
            value: "平成元年4月17日",
            tag: "wareki",
            sourceId: fInsurance.source.id,
            locator: pbox(0.294, 0.4, 0.267, 0.049),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "person.sex",
        label: "Sex",
        agentRule: "fill",
        variants: [
          {
            value: "男",
            sourceId: fJuminhyo.source.id,
            locator: pbox(0.434, 0.207, 0.023, 0.016),
            origin: "ocr",
          },
          {
            value: "M",
            script: "Latn",
            sourceId: fRcFront.source.id,
            locator: pbox(0.414, 0.234, 0.057, 0.036),
            origin: "ocr",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "person.nationality",
        label: "Nationality",
        agentRule: "fill",
        variants: [
          {
            value: "ベトナム",
            script: "Kana",
            sourceId: fRcFront.source.id,
            locator: pbox(0.605, 0.233, 0.097, 0.036),
            origin: "ocr",
          },
          {
            value: "VIET NAM",
            script: "Latn",
            sourceId: fPassport.source.id,
            locator: pbox(0.383, 0.415, 0.278, 0.036),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "birth.place",
        label: "Place of birth",
        agentRule: "fill",
        variants: [{ value: "Đà Nẵng", origin: "typed" }],
      }),
      mkDetail({
        attribute: "id.residence_card.number",
        label: "Residence card number",
        agentRule: "ask",
        variants: [
          {
            value: "VK12040417AA",
            sourceId: fRcFront.source.id,
            locator: pbox(0.764, 0.06, 0.213, 0.037),
            origin: "ocr",
            verified: true,
          },
          {
            value: "VK12040417AA",
            sourceId: fRcBack.source.id,
            locator: pbox(0.795, 0.029, 0.18, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.residence_card.issued",
        label: "Residence card issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2025-04-25",
            sourceId: fRcFront.source.id,
            locator: pbox(0.477, 0.763, 0.197, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.status",
        label: "Status of residence",
        agentRule: "fill",
        variants: [
          {
            value: "技術・人文知識・国際業務",
            sourceId: fRcFront.source.id,
            locator: pbox(0.13, 0.41, 0.334, 0.044),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.period",
        label: "Period of stay",
        agentRule: "fill",
        variants: [
          {
            value: "5年",
            sourceId: fRcFront.source.id,
            locator: pbox(0.241, 0.612, 0.052, 0.045),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.expiry",
        label: "Stay expires",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2030-04-30",
            sourceId: fRcFront.source.id,
            locator: pbox(0.319, 0.612, 0.278, 0.046),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.number",
        label: "Passport number",
        agentRule: "ask",
        variants: [
          {
            value: "C9900417",
            sourceId: fPassport.source.id,
            locator: pbox(0.723, 0.154, 0.134, 0.034),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.country",
        label: "Passport issuing country",
        agentRule: "fill",
        variants: [
          {
            value: "VNM",
            sourceId: fPassport.source.id,
            locator: pbox(0.543, 0.154, 0.066, 0.034),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.issued",
        label: "Passport issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2023-03-14",
            sourceId: fPassport.source.id,
            locator: pbox(0.384, 0.583, 0.132, 0.033),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.expiry",
        label: "Passport expiry",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2033-03-14",
            sourceId: fPassport.source.id,
            locator: pbox(0.384, 0.664, 0.132, 0.034),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.national.number",
        label: "National ID number",
        agentRule: "ask",
        variants: [
          {
            value: "048089000417",
            sourceId: fPassport.source.id,
            locator: pbox(0.384, 0.501, 0.181, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.health_insurance.number",
        label: "Health insurance number",
        agentRule: "ask",
        variants: [
          {
            value: "41020517 23 00",
            sourceId: fInsurance.source.id,
            locator: pbox(0.45, 0.175, 0.499, 0.045),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "Insurer number",
        agentRule: "ask",
        variants: [
          {
            value: "01139901",
            sourceId: fInsurance.source.id,
            locator: pbox(0.262, 0.725, 0.177, 0.047),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "Resident record code",
        agentRule: "ask",
        variants: [
          {
            value: "99001234417",
            sourceId: fJuminhyo.source.id,
            locator: pbox(0.546, 0.318, 0.139, 0.017),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.issuing_authority",
        label: "Issuing authority",
        agentRule: "fill",
        variants: [
          {
            value: "東京出入国在留管理局",
            sourceId: fRcFront.source.id,
            locator: pbox(0.335, 0.708, 0.204, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.postal",
        label: "Postal code",
        valueType: "address",
        agentRule: "fill",
        variants: [{ value: "136-0072", origin: "typed" }],
      }),
      mkDetail({
        attribute: "address.full",
        label: "Address",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都江東区大島3丁目14番8号 ハナミズキ大島305号室",
            sourceId: fRcFront.source.id,
            locator: pbox(0.116, 0.338, 0.588, 0.037),
            origin: "ocr",
          },
          {
            value: "Hanamizuki Ojima 305, 3-14-8 Ojima, Koto-ku, Tokyo 136-0072",
            script: "Latn",
            origin: "typed",
          },
        ],
        history: [
          {
            reason: "superseded",
            retiredAt: "2023-05-08T00:00:00.000Z",
            variant: {
              value: "東京都品川区西大井4丁目2番11号",
              sourceId: fJuminhyo.source.id,
              locator: pbox(0.176, 0.353, 0.355, 0.017),
              origin: "ocr",
            },
          },
        ],
      }),
      mkDetail({
        attribute: "address.prefecture",
        label: "Prefecture or state",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都",
            sourceId: fRcFront.source.id,
            locator: pbox(0.116, 0.338, 0.069, 0.037),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.city",
        label: "City",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "江東区",
            sourceId: fRcFront.source.id,
            locator: pbox(0.185, 0.338, 0.069, 0.037),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.street",
        label: "Street",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "大島3丁目14番8号",
            sourceId: fRcFront.source.id,
            locator: pbox(0.254, 0.338, 0.206, 0.037),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.building",
        label: "Building",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "ハナミズキ大島305号室",
            sourceId: fRcFront.source.id,
            locator: pbox(0.466, 0.338, 0.238, 0.037),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "contact.phone",
        label: "Phone",
        valueType: "phone",
        agentRule: "fill",
        variants: [{ value: "080-4417-2290", origin: "typed" }],
      }),
      mkDetail({
        attribute: "contact.email",
        label: "Email",
        valueType: "email",
        agentRule: "fill",
        variants: [{ value: "khoa.tran@example.com", origin: "typed" }],
      }),
      mkDetail({
        attribute: "work.employer.name",
        label: "Employer",
        agentRule: "fill",
        variants: [
          {
            value: "株式会社カワセミ・システムズ",
            sourceId: fPayslip.source.id,
            locator: pbox(0.04, 0.115, 0.535, 0.026),
            origin: "ocr",
          },
          {
            value: "Kawasemi Systems Co., Ltd.",
            script: "Latn",
            origin: "typed",
          },
          {
            value: "カ)カワセミシステムズ",
            script: "Kana",
            sourceId: fBank.source.id,
            locator: pbox(0.254, 0.512, 0.139, 0.028),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "work.department",
        label: "Department",
        agentRule: "fill",
        variants: [
          {
            value: "開発本部 クラウド基盤課",
            sourceId: fPayslip.source.id,
            locator: pbox(0.595, 0.223, 0.302, 0.019),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "work.title",
        label: "Job title",
        agentRule: "fill",
        variants: [{ value: "システムエンジニア", origin: "typed" }],
      }),
      mkDetail({
        attribute: "work.employee_id",
        label: "Employee number",
        agentRule: "fill",
        variants: [
          {
            value: "K-20417",
            sourceId: fPayslip.source.id,
            locator: pbox(0.23, 0.223, 0.112, 0.018),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "work.employer.address",
        label: "Employer address",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都千代田区神田錦町2丁目7番1号",
            sourceId: fPayslip.source.id,
            locator: pbox(0.044, 0.148, 0.44, 0.018),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "work.employer.phone",
        label: "Employer phone",
        valueType: "phone",
        agentRule: "fill",
        variants: [
          {
            value: "03-6820-4410",
            sourceId: fPayslip.source.id,
            locator: pbox(0.558, 0.148, 0.181, 0.018),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.name",
        label: "Bank",
        agentRule: "fill",
        variants: [
          {
            value: "東京ひかり銀行",
            sourceId: fBank.source.id,
            locator: pbox(0.118, 0.025, 0.243, 0.053),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.code",
        label: "Bank code",
        agentRule: "fill",
        variants: [{ value: "0999", origin: "typed" }],
      }),
      mkDetail({
        attribute: "bank.branch.name",
        label: "Branch",
        agentRule: "fill",
        variants: [
          {
            value: "大島支店",
            sourceId: fBank.source.id,
            locator: pbox(0.484, 0.113, 0.096, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.branch.code",
        label: "Branch code",
        agentRule: "fill",
        variants: [
          {
            value: "218",
            sourceId: fBank.source.id,
            locator: pbox(0.182, 0.115, 0.044, 0.032),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.account.type",
        label: "Account type",
        agentRule: "fill",
        variants: [
          {
            value: "普通",
            sourceId: fBank.source.id,
            locator: pbox(0.484, 0.166, 0.055, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.account.number",
        label: "Account number",
        agentRule: "ask",
        variants: [
          {
            value: "0004172",
            sourceId: fBank.source.id,
            locator: pbox(0.182, 0.167, 0.109, 0.032),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "bank.account.holder.kana",
        label: "Account holder (kana)",
        agentRule: "fill",
        variants: [
          {
            value: "チヤン ミン コア",
            script: "Kana",
            sourceId: fBank.source.id,
            locator: pbox(0.181, 0.222, 0.134, 0.035),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "income.monthly.gross",
        label: "Monthly pay before deductions",
        valueType: "number",
        agentRule: "ask",
        variants: [
          {
            value: "466,000",
            sourceId: fPayslip.source.id,
            locator: pbox(0.837, 0.631, 0.109, 0.017),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "income.monthly.net",
        label: "Monthly pay after deductions",
        valueType: "number",
        agentRule: "ask",
        variants: [
          {
            value: "366,094 円",
            sourceId: fPayslip.source.id,
            locator: pbox(0.708, 0.86, 0.239, 0.029),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "income.monthly.base",
        label: "Monthly base pay",
        valueType: "number",
        agentRule: "ask",
        variants: [
          {
            value: "360,000",
            sourceId: fPayslip.source.id,
            locator: pbox(0.842, 0.485, 0.104, 0.016),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "Passbook closing balance",
        valueType: "number",
        agentRule: "ask",
        variants: [
          {
            value: "1,923,239",
            sourceId: fBank.source.id,
            locator: pbox(0.818, 0.841, 0.113, 0.033),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "card.brand",
        label: "Debit card brand",
        agentRule: "never",
        variants: [{ value: "VISA", origin: "typed" }],
      }),
      mkDetail({
        attribute: "card.number",
        label: "Debit card number",
        agentRule: "never",
        variants: [{ value: "4532-8910-4417-2030", origin: "typed" }],
      }),
      mkDetail({
        attribute: "card.expiry",
        label: "Debit card expiry",
        valueType: "date",
        agentRule: "never",
        variants: [{ value: "2030-04", origin: "typed" }],
      }),
      mkDetail({
        attribute: "card.holder",
        label: "Cardholder name",
        agentRule: "never",
        variants: [{ value: "TRAN MINH KHOA", script: "Latn", origin: "typed" }],
      }),
    ],
  };

  // =========================================================================
  // 2. NGUYỄN THỊ LAN ANH (Mother / Spouse — 4 documents)
  // =========================================================================
  const mRcFront = mkSource(cleanDir, {
    diskFile: "residence-card-mother-front.jpg",
    fileName: "Residence Card (Front) — Nguyễn Thị Lan Anh.jpg",
    kind: "Residence card",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["front"],
  });
  const mPassport = mkSource(cleanDir, {
    diskFile: "passport-mother.jpg",
    fileName: "Passport — Nguyễn Thị Lan Anh.jpg",
    kind: "Passport",
    documentDate: "2022-11-21",
    effectiveOn: "2022-11-21",
    expiresOn: "2032-11-21",
  });
  const mMarriage = mkSource(cleanDir, {
    diskFile: "marriage-certificate.jpg",
    fileName: "Marriage Certificate — Trần Minh Khoa & Nguyễn Thị Lan Anh.jpg",
    kind: "Marriage certificate",
    documentDate: "2016-10-07",
    effectiveOn: "2016-10-07",
  });
  const mRcBack = mkSource(cleanDir, {
    diskFile: "residence-card-mother-back.jpg",
    fileName: "Residence Card (Back) — Nguyễn Thị Lan Anh.jpg",
    kind: "Residence card (back)",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["back"],
  });

  const motherSources = [mRcFront, mPassport, mMarriage, mRcBack];
  const motherMeta = {
    v: 1,
    profileId: "",
    kind: "person",
    relationship: "spouse",
    status: "confirmed",
    sources: motherSources.map((x) => x.source),
    details: [
      mkDetail({
        attribute: "name.full",
        label: "Full name",
        agentRule: "fill",
        variants: [
          {
            value: "NGUYỄN THỊ LAN ANH",
            script: null,
            sourceId: mPassport.source.id,
            locator: pbox(0.382, 0.237, 0.286, 0.044),
            origin: "ocr",
            verified: true,
          },
          {
            value: "NGUYEN THI LAN ANH",
            script: "Latn",
            sourceId: mRcFront.source.id,
            locator: pbox(0.098, 0.13, 0.374, 0.041),
            origin: "ocr",
            verified: true,
          },
          {
            value: "グエン ティ ラン アイン",
            script: "Kana",
            origin: "typed",
          },
        ],
      }),
      mkDetail({
        attribute: "name.family",
        label: "Family name",
        agentRule: "fill",
        variants: [
          {
            value: "NGUYỄN",
            script: null,
            sourceId: mPassport.source.id,
            locator: pbox(0.382, 0.237, 0.109, 0.044),
            origin: "ocr",
            verified: true,
          },
          {
            value: "NGUYEN",
            script: "Latn",
            sourceId: mPassport.source.id,
            locator: pbox(0.382, 0.237, 0.109, 0.044),
            origin: "mrz",
            verified: true,
          },
          { value: "グエン", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "name.given",
        label: "Given name",
        agentRule: "fill",
        variants: [
          {
            value: "THỊ LAN ANH",
            script: null,
            sourceId: mPassport.source.id,
            locator: pbox(0.495, 0.245, 0.173, 0.036),
            origin: "ocr",
            verified: true,
          },
          {
            value: "THI LAN ANH",
            script: "Latn",
            sourceId: mPassport.source.id,
            locator: pbox(0.495, 0.245, 0.173, 0.036),
            origin: "mrz",
            verified: true,
          },
          { value: "ティ ラン アイン", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "birth.date",
        label: "Date of birth",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "1991-09-03",
            sourceId: mRcFront.source.id,
            locator: pbox(0.141, 0.227, 0.195, 0.039),
            origin: "ocr",
            verified: true,
          },
          { value: "平成3年9月3日", tag: "wareki", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "person.sex",
        label: "Sex",
        agentRule: "fill",
        variants: [
          {
            value: "女",
            sourceId: mRcFront.source.id,
            locator: pbox(0.408, 0.229, 0.061, 0.038),
            origin: "ocr",
          },
          {
            value: "F",
            script: "Latn",
            sourceId: mPassport.source.id,
            locator: pbox(0.752, 0.33, 0.075, 0.037),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "person.nationality",
        label: "Nationality",
        agentRule: "fill",
        variants: [
          {
            value: "ベトナム",
            script: "Kana",
            sourceId: mRcFront.source.id,
            locator: pbox(0.601, 0.229, 0.102, 0.037),
            origin: "ocr",
          },
          {
            value: "Việt Nam",
            sourceId: mMarriage.source.id,
            locator: pbox(0.35, 0.406, 0.076, 0.027),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "person.ethnicity",
        label: "Ethnicity",
        agentRule: "fill",
        variants: [
          {
            value: "Kinh",
            sourceId: mMarriage.source.id,
            locator: pbox(0.135, 0.406, 0.039, 0.026),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "spouse.name",
        label: "Spouse",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN MINH KHOA",
            sourceId: mMarriage.source.id,
            locator: pbox(0.718, 0.314, 0.171, 0.031),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.residence_card.number",
        label: "Residence card number",
        agentRule: "ask",
        variants: [
          {
            value: "VK12040418AB",
            sourceId: mRcFront.source.id,
            locator: pbox(0.765, 0.056, 0.212, 0.041),
            origin: "ocr",
            verified: true,
          },
          {
            value: "VK12040418AB",
            sourceId: mRcBack.source.id,
            locator: pbox(0.798, 0.034, 0.178, 0.03),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.residence_card.issued",
        label: "Residence card issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2025-04-25",
            sourceId: mRcFront.source.id,
            locator: pbox(0.494, 0.755, 0.2, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.status",
        label: "Status of residence",
        agentRule: "fill",
        variants: [
          {
            value: "家族滞在",
            sourceId: mRcFront.source.id,
            locator: pbox(0.125, 0.405, 0.124, 0.047),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.period",
        label: "Period of stay",
        agentRule: "fill",
        variants: [
          {
            value: "5年",
            sourceId: mRcFront.source.id,
            locator: pbox(0.256, 0.584, 0.055, 0.049),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.expiry",
        label: "Stay expires",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2030-04-30",
            sourceId: mRcFront.source.id,
            locator: pbox(0.344, 0.584, 0.301, 0.049),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "work.hours",
        label: "Working hours",
        agentRule: "fill",
        variants: [
          {
            value: "原則週28時間以内",
            sourceId: mRcBack.source.id,
            locator: pbox(0.09, 0.708, 0.178, 0.03),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.number",
        label: "Passport number",
        agentRule: "ask",
        variants: [
          {
            value: "C9900418",
            sourceId: mPassport.source.id,
            locator: pbox(0.732, 0.148, 0.121, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.country",
        label: "Passport issuing country",
        agentRule: "fill",
        variants: [
          {
            value: "VNM",
            sourceId: mPassport.source.id,
            locator: pbox(0.549, 0.148, 0.063, 0.032),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.issued",
        label: "Passport issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2022-11-21",
            sourceId: mPassport.source.id,
            locator: pbox(0.383, 0.582, 0.133, 0.033),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.expiry",
        label: "Passport expiry",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2032-11-21",
            sourceId: mPassport.source.id,
            locator: pbox(0.383, 0.664, 0.133, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.national.number",
        label: "National ID number",
        agentRule: "ask",
        variants: [
          {
            value: "001191000418",
            sourceId: mPassport.source.id,
            locator: pbox(0.383, 0.499, 0.17, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "Marriage registration date",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2016-10-07",
            sourceId: mMarriage.source.id,
            locator: pbox(0.285, 0.625, 0.09, 0.038),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.postal",
        label: "Postal code",
        valueType: "address",
        agentRule: "fill",
        variants: [{ value: "136-0072", origin: "typed" }],
      }),
      mkDetail({
        attribute: "address.full",
        label: "Address",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都江東区大島3丁目14番8号 ハナミズキ大島305号室",
            sourceId: mRcFront.source.id,
            locator: pbox(0.123, 0.331, 0.584, 0.042),
            origin: "ocr",
          },
        ],
        history: [
          {
            reason: "superseded",
            retiredAt: "2023-05-08T00:00:00.000Z",
            variant: {
              value: "Số 12 ngõ 30 phố Tạ Quang Bửu, phường Bách Khoa, quận Hai Bà Trưng, thành phố Hà Nội",
              sourceId: mMarriage.source.id,
              locator: pbox(0.055, 0.446, 0.418, 0.06),
              origin: "ocr",
            },
          },
        ],
      }),
      mkDetail({
        attribute: "address.prefecture",
        label: "Prefecture or state",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都",
            sourceId: mRcFront.source.id,
            locator: pbox(0.123, 0.333, 0.072, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.city",
        label: "City",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "江東区",
            sourceId: mRcFront.source.id,
            locator: pbox(0.194, 0.333, 0.071, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.street",
        label: "Street",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "大島3丁目14番8号",
            sourceId: mRcFront.source.id,
            locator: pbox(0.265, 0.333, 0.193, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.building",
        label: "Building",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "ハナミズキ大島305号室",
            sourceId: mRcFront.source.id,
            locator: pbox(0.462, 0.333, 0.244, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "contact.phone",
        label: "Phone",
        valueType: "phone",
        agentRule: "fill",
        variants: [{ value: "080-4417-2291", origin: "typed" }],
      }),
      mkDetail({
        attribute: "contact.email",
        label: "Email",
        valueType: "email",
        agentRule: "fill",
        variants: [{ value: "lananh.nguyen@example.com", origin: "typed" }],
      }),
    ],
  };

  // =========================================================================
  // 3. TRẦN BẢO NGỌC (Daughter / Child — 6 documents)
  // =========================================================================
  const dRcFront = mkSource(cleanDir, {
    diskFile: "residence-card-daughter-front.jpg",
    fileName: "Residence Card (Front) — Trần Bảo Ngọc.jpg",
    kind: "Residence card",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["front"],
  });
  const dPassport = mkSource(cleanDir, {
    diskFile: "passport-daughter.jpg",
    fileName: "Passport — Trần Bảo Ngọc.jpg",
    kind: "Passport",
    documentDate: "2024-07-05",
    effectiveOn: "2024-07-05",
    expiresOn: "2029-07-05",
  });
  const dSchool = mkSource(cleanDir, {
    diskFile: "school-enrolment-daughter.jpg",
    fileName: "School Enrolment Certificate — Trần Bảo Ngọc.jpg",
    kind: "School enrolment certificate",
    documentDate: "2026-10-20",
    effectiveOn: "2026-10-20",
  });
  const dInsurance = mkSource(cleanDir, {
    diskFile: "health-insurance-daughter.jpg",
    fileName: "Health Insurance Certificate — Trần Bảo Ngọc.jpg",
    kind: "Health insurance certificate",
    documentDate: "2025-12-01",
    effectiveOn: "2025-12-01",
    expiresOn: "2030-11-30",
  });
  const dBirth = mkSource(cleanDir, {
    diskFile: "birth-certificate-daughter.jpg",
    fileName: "Birth Certificate — Trần Bảo Ngọc.jpg",
    kind: "Birth certificate",
    documentDate: "2018-06-25",
    effectiveOn: "2018-06-12",
  });
  const dRcBack = mkSource(cleanDir, {
    diskFile: "residence-card-daughter-back.jpg",
    fileName: "Residence Card (Back) — Trần Bảo Ngọc.jpg",
    kind: "Residence card (back)",
    documentDate: "2025-04-25",
    effectiveOn: "2025-04-25",
    expiresOn: "2030-04-30",
    sides: ["back"],
  });

  const daughterSources = [dRcFront, dPassport, dSchool, dInsurance, dBirth, dRcBack];
  const daughterMeta = {
    v: 1,
    profileId: "",
    kind: "person",
    relationship: "child",
    status: "confirmed",
    sources: daughterSources.map((x) => x.source),
    details: [
      mkDetail({
        attribute: "name.full",
        label: "Full name",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN BẢO NGỌC",
            script: null,
            sourceId: dPassport.source.id,
            locator: pbox(0.372, 0.221, 0.218, 0.04),
            origin: "ocr",
            verified: true,
          },
          {
            value: "TRAN BAO NGOC",
            script: "Latn",
            sourceId: dRcFront.source.id,
            locator: pbox(0.1, 0.125, 0.301, 0.046),
            origin: "ocr",
            verified: true,
          },
          {
            value: "チャン バオ ゴック",
            script: "Kana",
            sourceId: dSchool.source.id,
            locator: pbox(0.711, 0.292, 0.23, 0.021),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "name.family",
        label: "Family name",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN",
            script: null,
            sourceId: dPassport.source.id,
            locator: pbox(0.372, 0.221, 0.072, 0.04),
            origin: "ocr",
            verified: true,
          },
          {
            value: "TRAN",
            script: "Latn",
            sourceId: dPassport.source.id,
            locator: pbox(0.372, 0.221, 0.072, 0.04),
            origin: "mrz",
            verified: true,
          },
          { value: "チャン", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "name.given",
        label: "Given name",
        agentRule: "fill",
        variants: [
          {
            value: "BẢO NGỌC",
            script: null,
            sourceId: dPassport.source.id,
            locator: pbox(0.451, 0.221, 0.139, 0.04),
            origin: "ocr",
            verified: true,
          },
          {
            value: "BAO NGOC",
            script: "Latn",
            sourceId: dPassport.source.id,
            locator: pbox(0.451, 0.221, 0.139, 0.04),
            origin: "mrz",
            verified: true,
          },
          { value: "バオ ゴック", script: "Kana", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "birth.date",
        label: "Date of birth",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2018-06-12",
            sourceId: dRcFront.source.id,
            locator: pbox(0.137, 0.228, 0.212, 0.039),
            origin: "ocr",
            verified: true,
          },
          { value: "平成30年6月12日", tag: "wareki", origin: "typed" },
        ],
      }),
      mkDetail({
        attribute: "birth.place",
        label: "Place of birth",
        agentRule: "fill",
        variants: [
          {
            value: "Bệnh viện Phụ sản Hà Nội",
            sourceId: dBirth.source.id,
            locator: pbox(0.182, 0.321, 0.262, 0.018),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "person.sex",
        label: "Sex",
        agentRule: "fill",
        variants: [
          {
            value: "女",
            sourceId: dSchool.source.id,
            locator: pbox(0.72, 0.344, 0.031, 0.021),
            origin: "ocr",
          },
          {
            value: "F",
            script: "Latn",
            sourceId: dPassport.source.id,
            locator: pbox(0.744, 0.313, 0.075, 0.037),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "person.nationality",
        label: "Nationality",
        agentRule: "fill",
        variants: [
          {
            value: "ベトナム",
            script: "Kana",
            sourceId: dRcFront.source.id,
            locator: pbox(0.601, 0.229, 0.092, 0.037),
            origin: "ocr",
          },
          {
            value: "Việt Nam",
            sourceId: dBirth.source.id,
            locator: pbox(0.72, 0.296, 0.097, 0.017),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "person.ethnicity",
        label: "Ethnicity",
        agentRule: "fill",
        variants: [
          {
            value: "Kinh",
            sourceId: dBirth.source.id,
            locator: pbox(0.454, 0.296, 0.049, 0.017),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "family.father.name",
        label: "Father's name",
        agentRule: "fill",
        variants: [
          {
            value: "TRẦN MINH KHOA",
            sourceId: dBirth.source.id,
            locator: pbox(0.382, 0.503, 0.225, 0.019),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "family.mother.name",
        label: "Mother's name",
        agentRule: "fill",
        variants: [
          {
            value: "NGUYỄN THỊ LAN ANH",
            sourceId: dBirth.source.id,
            locator: pbox(0.371, 0.401, 0.273, 0.019),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.residence_card.number",
        label: "Residence card number",
        agentRule: "ask",
        variants: [
          {
            value: "VK12040419AC",
            sourceId: dRcFront.source.id,
            locator: pbox(0.772, 0.056, 0.21, 0.038),
            origin: "ocr",
            verified: true,
          },
          {
            value: "VK12040419AC",
            sourceId: dRcBack.source.id,
            locator: pbox(0.805, 0.023, 0.172, 0.029),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.residence_card.issued",
        label: "Residence card issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2025-04-25",
            sourceId: dRcFront.source.id,
            locator: pbox(0.476, 0.742, 0.202, 0.037),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.status",
        label: "Status of residence",
        agentRule: "fill",
        variants: [
          {
            value: "家族滞在",
            sourceId: dRcFront.source.id,
            locator: pbox(0.126, 0.407, 0.127, 0.046),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.period",
        label: "Period of stay",
        agentRule: "fill",
        variants: [
          {
            value: "5年",
            sourceId: dRcFront.source.id,
            locator: pbox(0.247, 0.58, 0.053, 0.047),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "visa.expiry",
        label: "Stay expires",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2030-04-30",
            sourceId: dRcFront.source.id,
            locator: pbox(0.337, 0.58, 0.301, 0.047),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.number",
        label: "Passport number",
        agentRule: "ask",
        variants: [
          {
            value: "C9900419",
            sourceId: dPassport.source.id,
            locator: pbox(0.734, 0.135, 0.121, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.country",
        label: "Passport issuing country",
        agentRule: "fill",
        variants: [
          {
            value: "VNM",
            sourceId: dPassport.source.id,
            locator: pbox(0.537, 0.135, 0.065, 0.033),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.issued",
        label: "Passport issued",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2024-07-05",
            sourceId: dPassport.source.id,
            locator: pbox(0.373, 0.562, 0.129, 0.034),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.passport.expiry",
        label: "Passport expiry",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2029-07-05",
            sourceId: dPassport.source.id,
            locator: pbox(0.373, 0.644, 0.129, 0.034),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.national.number",
        label: "National ID number",
        agentRule: "ask",
        variants: [
          {
            value: "001318000419",
            sourceId: dPassport.source.id,
            locator: pbox(0.373, 0.479, 0.164, 0.035),
            origin: "mrz",
            verified: true,
          },
        ],
      }),
      mkDetail({
        attribute: "id.health_insurance.number",
        label: "Health insurance number",
        agentRule: "ask",
        variants: [
          {
            value: "41020517",
            sourceId: dInsurance.source.id,
            locator: pbox(0.401, 0.158, 0.137, 0.04),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "id.card.extra_number",
        label: "Branch number",
        agentRule: "ask",
        variants: [
          {
            value: "02",
            sourceId: dInsurance.source.id,
            locator: pbox(0.893, 0.157, 0.035, 0.04),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.postal",
        label: "Postal code",
        valueType: "address",
        agentRule: "fill",
        variants: [{ value: "136-0072", origin: "typed" }],
      }),
      mkDetail({
        attribute: "address.full",
        label: "Address",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都江東区大島3丁目14番8号 ハナミズキ大島305号室",
            sourceId: dRcFront.source.id,
            locator: pbox(0.117, 0.338, 0.581, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.prefecture",
        label: "Prefecture or state",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "東京都",
            sourceId: dRcFront.source.id,
            locator: pbox(0.117, 0.338, 0.068, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.city",
        label: "City",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "江東区",
            sourceId: dRcFront.source.id,
            locator: pbox(0.185, 0.338, 0.068, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.street",
        label: "Street",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "大島3丁目14番8号",
            sourceId: dRcFront.source.id,
            locator: pbox(0.253, 0.338, 0.197, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.building",
        label: "Building",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "ハナミズキ大島305号室",
            sourceId: dRcFront.source.id,
            locator: pbox(0.455, 0.338, 0.243, 0.039),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "address.registered_domicile",
        label: "Registered domicile",
        valueType: "address",
        agentRule: "fill",
        variants: [
          {
            value: "phường Hải Châu I, quận Hải Châu, thành phố Đà Nẵng",
            sourceId: dBirth.source.id,
            locator: pbox(0.194, 0.349, 0.56, 0.024),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: "education.school.name",
        label: "School",
        agentRule: "fill",
        variants: [
          {
            value: "江東区立みなみ大島小学校",
            sourceId: dSchool.source.id,
            locator: pbox(0.501, 0.747, 0.43, 0.026),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "Grade & class",
        agentRule: "fill",
        variants: [
          {
            value: "第3学年 2組",
            sourceId: dSchool.source.id,
            locator: pbox(0.251, 0.493, 0.185, 0.024),
            origin: "ocr",
          },
        ],
      }),
      mkDetail({
        attribute: null,
        label: "School enrolment date",
        valueType: "date",
        agentRule: "fill",
        variants: [
          {
            value: "2024-04-01",
            sourceId: dSchool.source.id,
            locator: pbox(0.251, 0.541, 0.211, 0.022),
            origin: "ocr",
          },
        ],
      }),
    ],
  };

  const profiles = [
    {
      name: "Trần Minh Khoa",
      favorite: true,
      meta: fatherMeta,
      attachments: fatherSources,
    },
    {
      name: "Nguyễn Thị Lan Anh",
      favorite: false,
      meta: motherMeta,
      attachments: motherSources,
    },
    {
      name: "Trần Bảo Ngọc",
      favorite: false,
      meta: daughterMeta,
      attachments: daughterSources,
    },
  ];

  // Household facts that a Vietnamese family's vault would hold.
  const formDetails = {
    "Trần Minh Khoa": {
      "household.relationship": "Chủ hộ",
    },
    "Nguyễn Thị Lan Anh": {
      "household.relationship": "Vợ",
    },
    "Trần Bảo Ngọc": {
      "household.relationship": "Con",
    },
  };
  const headId = fatherMeta.details.find((d) => d.attribute === "id.national.number")
    ?.variants[0]?.value;
  for (const profile of profiles) {
    for (const detail of profile.meta.details) {
      if (["id.national.number", "id.residence_card.number"].includes(detail.attribute)) {
        detail.agentRule = "fill";
      }
    }
    const details = {
      "household.head.name": "Trần Minh Khoa",
      "household.head.national_id": headId,
      ...formDetails[profile.name],
    };
    if (profile.name !== "Trần Bảo Ngọc") {
      details["address.registered_domicile"] = "phường Hải Châu, thành phố Đà Nẵng, Việt Nam";
    }
    for (const [attribute, value] of Object.entries(details)) {
      if (!value || profile.meta.details.some((d) => d.attribute === attribute)) continue;
      profile.meta.details.push(mkDetail({
        attribute,
        label: attribute.replaceAll(".", " "),
        variants: [{ value, origin: "typed" }],
      }));
    }
  }

  for (const p of profiles) {
    assertValidProfileEnvelope(p.meta);
  }

  return profiles;
}
