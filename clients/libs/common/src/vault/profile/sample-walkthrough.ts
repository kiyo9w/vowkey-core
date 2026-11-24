import { Utils } from "../../platform/misc/utils";
import { CipherType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { IdentityView } from "../models/view/identity.view";

import {
  AgentRule,
  applyProjection,
  DetailVariant,
  humanDetailLabel,
  newEnvelope,
  PageLocator,
  ProfileDetail,
  ProfileSource,
  projectEnvelope,
  readEnvelope,
  resolveDetailVariant,
  valueTypeOf,
  writeEnvelope,
} from "./vk-meta";

export type SampleScenarioId = "passport" | "idcard" | "residence";

export const SAMPLE_ATTACHMENT_PREFIX = "sample:";

export interface SamplePrintedField {
  key: string;
  attribute: string;
  printedLabel: string;
  value: string;
  script?: string | null;
  origin: "mrz" | "ocr";
  verified?: boolean;
  agentRule: AgentRule;
  /** Formatted value written into the practice form (demonstrates date/country/script adaptation). */
  practiceFillValue: string;
  practiceFieldLabel: string;
  practiceFieldLabelKey?: string;
  wide?: boolean;
}

export interface SampleScenarioSpec {
  id: SampleScenarioId;
  badge: string;
  pickerLabel: string;
  profileName: string;
  fileName: string;
  sourceLabel: string;
  sourceLabelKey: string;
  documentKind: string;
  headerBandColor: string;
  headerAuthority: string;
  headerSubtitle: string;
  footerLine1: string;
  footerLine2: string;
  expiresOn: string;
  documentDate: string;
  practiceFormTitle: string;
  practiceFormTitleKey: string;
  practiceFormSubtitle: string;
  practiceFormSubtitleKey: string;
  humanFieldLabel: string;
  humanFieldLabelKey: string;
  humanFieldPlaceholder: string;
  humanFieldPlaceholderKey: string;
  fields: SamplePrintedField[];
}

const CARD_W = 960;
const CARD_H = 640;

/** Deterministic 2x3 grid coordinates on the 960x640 sample canvas so PageLocator boxes match 1:1. */
export function sampleFieldBox(index: number): {
  px: number;
  py: number;
  pw: number;
  ph: number;
  locator: PageLocator;
} {
  const col = index % 2;
  const row = Math.floor(index / 2);
  const px = col === 0 ? 272 : 604;
  const py = 148 + row * 104;
  const pw = 304;
  const ph = 72;
  return {
    px,
    py,
    pw,
    ph,
    locator: {
      kind: "page",
      page: 0,
      x: Number((px / CARD_W).toFixed(4)),
      y: Number((py / CARD_H).toFixed(4)),
      w: Number((pw / CARD_W).toFixed(4)),
      h: Number((ph / CARD_H).toFixed(4)),
    },
  };
}

export const SAMPLE_SCENARIOS: Record<SampleScenarioId, SampleScenarioSpec> = {
  passport: {
    id: "passport",
    badge: "SAMPLE",
    pickerLabel: "Passport",
    profileName: "Åsamund Østenbyen (Sample)",
    fileName: "Passport-sample.png",
    sourceLabel: "sample passport",
    sourceLabelKey: "vkWtDocPassport",
    documentKind: "Passport (sample)",
    headerBandColor: "#1E3A8A",
    headerAuthority: "SAMPLE PASSAGE DOCUMENT · PASSPORT",
    headerSubtitle: "NOR · OFFICIAL SAMPLE — NOT VALID FOR TRAVEL",
    footerLine1: "P<NOROESTENBYEN<<AASAMUND<<<<<<<<<<<<<<<<<<",
    footerLine2: "CCC0022514NOR5604230M3004157<<<<<<<<<<<<<<04",
    documentDate: "2020-04-15",
    expiresOn: "2030-04-15",
    practiceFormTitle: "International passenger check-in",
    practiceFormTitleKey: "vkWtPassportTitle",
    practiceFormSubtitle: "Practice form · Values stay on this device",
    practiceFormSubtitleKey: "vkWtPassportSub",
    humanFieldLabel: "Seat & meal note",
    humanFieldLabelKey: "vkWtPassportHuman",
    humanFieldPlaceholder: "e.g. Window · 14A",
    humanFieldPlaceholderKey: "vkWtPassportHumanHint",
    fields: [
      {
        key: "family",
        attribute: "name.family",
        printedLabel: "SURNAME / EFTERNAVN",
        value: "Østenbyen",
        origin: "mrz",
        verified: true,
        agentRule: "fill",
        practiceFieldLabel: "Surname",
        practiceFieldLabelKey: "vkWtFieldSurname",
        practiceFillValue: "ØSTENBYEN",
      },
      {
        key: "given",
        attribute: "name.given",
        printedLabel: "GIVEN NAMES / FORNAVN",
        value: "Åsamund",
        origin: "mrz",
        verified: true,
        agentRule: "fill",
        practiceFieldLabel: "Given names",
        practiceFieldLabelKey: "vkWtFieldGivenNames",
        practiceFillValue: "AASAMUND",
      },
      {
        key: "dob",
        attribute: "birth.date",
        printedLabel: "DATE OF BIRTH",
        value: "1956-04-23",
        origin: "mrz",
        verified: true,
        agentRule: "fill",
        practiceFieldLabel: "Date of birth (DD/MM/YYYY)",
        practiceFieldLabelKey: "vkWtFieldDobSlash",
        practiceFillValue: "23/04/1956",
      },
      {
        key: "nationality",
        attribute: "person.nationality",
        printedLabel: "NATIONALITY",
        value: "Norwegian",
        origin: "mrz",
        verified: true,
        agentRule: "fill",
        practiceFieldLabel: "Nationality",
        practiceFieldLabelKey: "vkWtFieldNationality",
        practiceFillValue: "Norway",
      },
      {
        key: "docno",
        attribute: "id.passport.number",
        printedLabel: "PASSPORT NO.",
        value: "CCC002251",
        origin: "mrz",
        verified: true,
        agentRule: "ask",
        practiceFieldLabel: "Passport number",
        practiceFieldLabelKey: "vkWtFieldPassportNo",
        practiceFillValue: "CCC002251",
      },
      {
        key: "expiry",
        attribute: "id.passport.expiry",
        printedLabel: "DATE OF EXPIRY",
        value: "2030-04-15",
        origin: "mrz",
        verified: true,
        agentRule: "fill",
        practiceFieldLabel: "Passport expiry (DD/MM/YYYY)",
        practiceFieldLabelKey: "vkWtFieldPassportExpiry",
        practiceFillValue: "15/04/2030",
      },
    ],
  },
  idcard: {
    id: "idcard",
    badge: "SAMPLE",
    pickerLabel: "National ID",
    profileName: "Erika Mustermann (Sample)",
    fileName: "National-ID-sample.png",
    sourceLabel: "sample national ID",
    sourceLabelKey: "vkWtDocIdCard",
    documentKind: "National ID card (sample)",
    headerBandColor: "#1F4E5F",
    headerAuthority: "PERSONALAUSWEIS · IDENTITY CARD",
    headerSubtitle: "DEU · MUSTER / SAMPLE CARD",
    footerLine1: "IDD<<LZ6311T471<<<<<<<<<<<<<<<",
    footerLine2: "8308126F3405018D<<<<<<<<<<<<<4",
    documentDate: "2024-05-02",
    expiresOn: "2034-05-01",
    practiceFormTitle: "Municipal residence registration",
    practiceFormTitleKey: "vkWtIdCardTitle",
    practiceFormSubtitle: "Practice form · Values stay on this device",
    practiceFormSubtitleKey: "vkWtIdCardSub",
    humanFieldLabel: "Move-in date",
    humanFieldLabelKey: "vkWtIdCardHuman",
    humanFieldPlaceholder: "DD.MM.YYYY",
    humanFieldPlaceholderKey: "vkWtIdCardHumanHint",
    fields: [
      {
        key: "family",
        attribute: "name.family",
        printedLabel: "NAME / SURNAME",
        value: "Mustermann",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Family name",
        practiceFieldLabelKey: "vkWtFieldFamilyName",
        practiceFillValue: "Mustermann",
      },
      {
        key: "given",
        attribute: "name.given",
        printedLabel: "VORNAMEN / GIVEN NAMES",
        value: "Erika",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Given name",
        practiceFieldLabelKey: "vkWtFieldGivenName",
        practiceFillValue: "Erika",
      },
      {
        key: "dob",
        attribute: "birth.date",
        printedLabel: "GEBURTSTAG / BIRTH DATE",
        value: "1983-08-12",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Date of birth (DD.MM.YYYY)",
        practiceFieldLabelKey: "vkWtFieldDobDot",
        practiceFillValue: "12.08.1983",
      },
      {
        key: "place",
        attribute: "birth.place",
        printedLabel: "GEBURTSORT / PLACE OF BIRTH",
        value: "Berlin",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Place of birth",
        practiceFieldLabelKey: "vkWtFieldBirthPlace",
        practiceFillValue: "Berlin",
      },
      {
        key: "docno",
        attribute: "id.card.number",
        printedLabel: "DOCUMENT NO.",
        value: "LZ6311T47",
        origin: "ocr",
        agentRule: "ask",
        practiceFieldLabel: "ID card number",
        practiceFieldLabelKey: "vkWtFieldIdCardNo",
        practiceFillValue: "LZ6311T47",
      },
      {
        key: "expiry",
        attribute: "id.card.expiry",
        printedLabel: "GÜLTIG BIS / EXPIRY",
        value: "2034-05-01",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Expiry date (DD.MM.YYYY)",
        practiceFieldLabelKey: "vkWtFieldExpiryDot",
        practiceFillValue: "01.05.2034",
      },
    ],
  },
  residence: {
    id: "residence",
    badge: "SAMPLE",
    pickerLabel: "Residence card",
    profileName: "Nguyễn Thị Linh · 阮 氏玲 (Sample)",
    fileName: "Residence-card-sample.png",
    sourceLabel: "sample residence card",
    sourceLabelKey: "vkWtDocResidence",
    documentKind: "Residence card (sample)",
    headerBandColor: "#1D4ED8",
    headerAuthority: "RESIDENCE CARD · 在留カード見本",
    headerSubtitle: "MULTI-SCRIPT SAMPLE — FOR WALKTHROUGH ONLY",
    footerLine1: "SAMPLE DOCUMENT · MULTI-SCRIPT PROFILE",
    footerLine2: "AB12345678CD · TOKYO SHINJUKU-KU",
    documentDate: "2024-04-01",
    expiresOn: "2029-04-01",
    practiceFormTitle: "Employee & bank onboarding",
    practiceFormTitleKey: "vkWtResidenceTitle",
    practiceFormSubtitle: "Practice form · Multi-script matching on this device",
    practiceFormSubtitleKey: "vkWtResidenceSub",
    humanFieldLabel: "Preferred start date",
    humanFieldLabelKey: "vkWtResidenceHuman",
    humanFieldPlaceholder: "YYYY/MM/DD",
    humanFieldPlaceholderKey: "vkWtResidenceHumanHint",
    fields: [
      {
        key: "latin",
        attribute: "name.full",
        script: "Latn",
        printedLabel: "NAME (LATIN)",
        value: "NGUYEN THI LINH",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Full name (Latin)",
        practiceFieldLabelKey: "vkWtFieldNameLatin",
        practiceFillValue: "NGUYEN THI LINH",
      },
      {
        key: "kanji",
        attribute: "name.full",
        script: "Hani",
        printedLabel: "氏名（漢字）",
        value: "阮 氏玲",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Name (Kanji)",
        practiceFieldLabelKey: "vkWtFieldNameKanji",
        practiceFillValue: "阮 氏玲",
      },
      {
        key: "kana",
        attribute: "name.full",
        script: "Kana",
        printedLabel: "フリガナ（KANA）",
        value: "グエン ティ リン",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Name (Katakana)",
        practiceFieldLabelKey: "vkWtFieldNameKana",
        practiceFillValue: "グエン ティ リン",
      },
      {
        key: "dob",
        attribute: "birth.date",
        printedLabel: "生年月日 / BIRTH DATE",
        value: "1998-03-14",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Date of birth (YYYY/MM/DD)",
        practiceFieldLabelKey: "vkWtFieldDobIso",
        practiceFillValue: "1998/03/14",
      },
      {
        key: "docno",
        attribute: "id.card.number",
        printedLabel: "在留カード番号 / CARD NO.",
        value: "AB12345678CD",
        origin: "ocr",
        agentRule: "ask",
        practiceFieldLabel: "Residence card number",
        practiceFieldLabelKey: "vkWtFieldResidenceNo",
        practiceFillValue: "AB12345678CD",
      },
      {
        key: "address",
        attribute: "address.full",
        printedLabel: "住居地 / ADDRESS",
        value: "東京都新宿区高田馬場 4-18-9-302",
        origin: "ocr",
        agentRule: "fill",
        practiceFieldLabel: "Current address",
        practiceFieldLabelKey: "vkWtFieldCurrentAddress",
        practiceFillValue: "東京都新宿区高田馬場 4-18-9-302",
        wide: true,
      },
    ],
  },
};

export const SAMPLE_SCENARIO_LIST: SampleScenarioSpec[] = [
  SAMPLE_SCENARIOS.passport,
  SAMPLE_SCENARIOS.idcard,
  SAMPLE_SCENARIOS.residence,
];

export function isSampleAttachmentId(attachmentId: string | null | undefined): boolean {
  return typeof attachmentId === "string" && attachmentId.startsWith(SAMPLE_ATTACHMENT_PREFIX);
}

export function parseSampleScenarioId(raw: string | null | undefined): SampleScenarioId {
  const cleaned = (raw ?? "").replace(/^sample:/, "") as SampleScenarioId;
  return cleaned in SAMPLE_SCENARIOS ? cleaned : "passport";
}

export function isSampleProfile(cipher: CipherView | null | undefined): boolean {
  if (!cipher || cipher.type !== CipherType.Identity) {
    return false;
  }
  const meta = readEnvelope(cipher);
  return meta?.["sample"] === true;
}

export function sampleScenarioOf(cipher: CipherView | null | undefined): SampleScenarioSpec | null {
  if (!isSampleProfile(cipher)) {
    return null;
  }
  const meta = readEnvelope(cipher!);
  const id = parseSampleScenarioId(
    typeof meta?.["sampleScenario"] === "string" ? meta["sampleScenario"] : "passport",
  );
  return SAMPLE_SCENARIOS[id];
}

export function localizeSampleScenario(
  spec: SampleScenarioSpec | null | undefined,
  t?: (key: string) => string,
): SampleScenarioSpec | null {
  if (!spec) {
    return null;
  }
  const pick = (key: string | undefined, fallback: string): string => {
    if (!key || !t) {
      return fallback;
    }
    const translated = t(key);
    return translated && translated !== key ? translated : fallback;
  };
  return {
    ...spec,
    badge: pick("vkSampleBadge", spec.badge),
    sourceLabel: pick(spec.sourceLabelKey, spec.sourceLabel),
    practiceFormTitle: pick(spec.practiceFormTitleKey, spec.practiceFormTitle),
    practiceFormSubtitle: pick(spec.practiceFormSubtitleKey, spec.practiceFormSubtitle),
    humanFieldLabel: pick(spec.humanFieldLabelKey, spec.humanFieldLabel),
    humanFieldPlaceholder: pick(spec.humanFieldPlaceholderKey, spec.humanFieldPlaceholder),
    fields: spec.fields.map((field) => ({
      ...field,
      practiceFieldLabel: pick(field.practiceFieldLabelKey, field.practiceFieldLabel),
    })),
  };
}

/**
 * Builds an Identity CipherView carrying a real `VkMetaV1` envelope (`sample: true`) with
 * `PageLocator` boxes and projected identity/custom fields so every real Vowkey fill path works.
 */
export function buildSampleProfileCipher(
  scenarioId: SampleScenarioId = "passport",
  options?: { newId?: () => string; now?: () => Date },
): CipherView {
  const spec = SAMPLE_SCENARIOS[scenarioId] ?? SAMPLE_SCENARIOS.passport;
  const newId = options?.newId ?? (() => Utils.newGuid());
  const nowIso = (options?.now?.() ?? new Date()).toISOString();

  const cipher = new CipherView();
  cipher.type = CipherType.Identity;
  cipher.name = spec.profileName;
  cipher.edit = true;
  cipher.viewPassword = true;
  cipher.identity = new IdentityView();
  cipher.fields = [];
  cipher.attachments = [];

  const profileId = newId();
  const sourceId = newId();
  const meta = newEnvelope(profileId, { kind: "person" });
  meta["sample"] = true;
  meta["sampleScenario"] = spec.id;

  const source: ProfileSource = {
    id: sourceId,
    attachmentId: `${SAMPLE_ATTACHMENT_PREFIX}${spec.id}`,
    fileName: spec.fileName,
    mediaType: "image/png",
    kind: spec.documentKind,
    documentDate: spec.documentDate,
    effectiveOn: spec.documentDate,
    capturedAt: nowIso,
    expiresOn: spec.expiresOn,
    status: "current",
  };
  meta.sources.push(source);

  const detailsByAttribute = new Map<string, ProfileDetail>();
  spec.fields.forEach((field, index) => {
    const { locator } = sampleFieldBox(index);
    const variantId = newId();
    const existing = detailsByAttribute.get(field.attribute);
    const variant: DetailVariant = {
      id: variantId,
      script: field.script ?? null,
      tag: null,
      value: field.value,
      current: true,
      sourceId,
      locator,
      verified: Boolean(field.verified),
      origin: field.origin,
    };

    if (existing) {
      existing.variants.push(variant);
      return;
    }

    const detail: ProfileDetail = {
      id: newId(),
      attribute: field.attribute,
      label: humanDetailLabel(field.attribute, field.printedLabel),
      valueType: valueTypeOf(field.attribute),
      chosenVariantId: variantId,
      agentRule: field.agentRule,
      variants: [variant],
      history: [],
      conflicts: [],
    };
    detailsByAttribute.set(field.attribute, detail);
    meta.details.push(detail);
  });

  writeEnvelope(cipher, meta);
  applyProjection(cipher, projectEnvelope(meta), []);
  return cipher;
}

/**
 * Matches a sample profile's live `VkMetaV1` details (including any edits the user made!)
 * against the scenario's practice form fields.
 */
export function fillPracticeFormFromSample(
  cipher: CipherView,
  scenarioId?: SampleScenarioId,
): {
  values: Record<string, string>;
  filledCount: number;
  humanFieldLabel: string;
} {
  const spec =
    (scenarioId ? SAMPLE_SCENARIOS[scenarioId] : sampleScenarioOf(cipher)) ??
    SAMPLE_SCENARIOS.passport;
  const meta = readEnvelope(cipher);
  const values: Record<string, string> = {};

  for (const field of spec.fields) {
    let resolved = field.practiceFillValue;
    if (meta) {
      const detail = meta.details.find((item) => item.attribute === field.attribute);
      if (detail) {
        const scriptMatch = field.script
          ? detail.variants.find((v) => v.current && v.script === field.script)
          : resolveDetailVariant(meta, detail);
        if (scriptMatch && scriptMatch.value !== field.value) {
          resolved = scriptMatch.value;
        }
      }
    }
    values[field.key] = resolved;
  }

  return {
    values,
    filledCount: spec.fields.length,
    humanFieldLabel: spec.humanFieldLabel,
  };
}

/**
 * One-action sample workspace: creates every scenario this vault does not already hold, one
 * vault record each, in SAMPLE_SCENARIO_LIST order. Because a scenario that is already there is
 * left alone, running the load again never duplicates records; after a reset (which deletes
 * sample-marked records only) the same call restores pristine copies.
 */
export async function ensureSampleWorkspace(
  records: CipherView[],
  createScenario: (scenarioId: SampleScenarioId) => Promise<CipherView | null>,
): Promise<CipherView[]> {
  const loaded = new Set(
    records
      .filter((record) => isSampleProfile(record))
      .map((record) => sampleScenarioOf(record)?.id),
  );
  const created: CipherView[] = [];
  for (const spec of SAMPLE_SCENARIO_LIST) {
    if (!loaded.has(spec.id)) {
      const record = await createScenario(spec.id);
      if (record != null) {
        created.push(record);
      }
    }
  }
  return created;
}

/**
 * Reset targets for the sample workspace: ids of sample-marked records only.
 * A user's own records are never in this list.
 */
export function sampleWorkspaceResetIds(records: CipherView[]): string[] {
  return records
    .filter((record) => isSampleProfile(record))
    .map((record) => record.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

// 1x1 transparent PNG fallback for headless Jest/Node tests without HTMLCanvasElement 2D context.
const FALLBACK_1X1_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const pngCache = new Map<SampleScenarioId, Uint8Array>();

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Renders a crisp 960x640 sample document card as PNG bytes on `<canvas>`,
 * aligned pixel-for-pixel with `sampleFieldBox()` so `Show in document` highlights every field.
 */
export async function renderSampleDocumentBytes(attachmentId: string): Promise<Uint8Array> {
  const id = parseSampleScenarioId(attachmentId);
  const cached = pngCache.get(id);
  if (cached) {
    return cached;
  }
  if (
    typeof document === "undefined" ||
    (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent ?? ""))
  ) {
    return FALLBACK_1X1_PNG;
  }
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) {
    return FALLBACK_1X1_PNG;
  }

  const spec = SAMPLE_SCENARIOS[id];

  // Outer card surface
  ctx.fillStyle = "#FAF8F3";
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Subtle security guilloche horizontal lines
  ctx.strokeStyle = "rgba(30, 58, 138, 0.045)";
  ctx.lineWidth = 1;
  for (let y = 112; y < CARD_H - 110; y += 14) {
    ctx.beginPath();
    ctx.moveTo(24, y);
    ctx.lineTo(CARD_W - 24, y);
    ctx.stroke();
  }

  // Top authority band
  ctx.fillStyle = spec.headerBandColor;
  ctx.fillRect(0, 0, CARD_W, 108);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  ctx.fillText(spec.headerAuthority, 48, 48);

  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(spec.headerSubtitle, 48, 76);

  // Top-right sample stamp pill
  const stampText = spec.badge;
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  roundRectPath(ctx, CARD_W - 188, 28, 144, 44, 10);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(stampText, CARD_W - 116, 56);
  ctx.textAlign = "left";

  // Left portrait frame (x=48..236, y=148..392)
  ctx.fillStyle = "#EDEAE2";
  roundRectPath(ctx, 48, 148, 188, 244, 14);
  ctx.fill();
  ctx.strokeStyle = "#D6D1C4";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Minimalist portrait silhouette inside frame
  ctx.fillStyle = "#B8B2A3";
  ctx.beginPath();
  ctx.arc(142, 232, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(142, 356, 68, Math.PI, 0, false);
  ctx.fill();

  ctx.fillStyle = "#6F6A5E";
  ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(spec.badge, 142, 420);
  ctx.textAlign = "left";

  // Printed detail cells (matching sampleFieldBox 1:1)
  spec.fields.forEach((field, idx) => {
    const { px, py, pw, ph } = sampleFieldBox(idx);
    ctx!.fillStyle = "rgba(255, 255, 255, 0.86)";
    roundRectPath(ctx!, px, py, pw, ph, 8);
    ctx!.fill();
    ctx!.strokeStyle = "#DFDBD0";
    ctx!.lineWidth = 1;
    ctx!.stroke();

    ctx!.fillStyle = "#6B675E";
    ctx!.font = "600 11.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx!.fillText(field.printedLabel, px + 12, py + 23);

    ctx!.fillStyle = "#161513";
    const isLong = field.value.length > 18;
    ctx!.font = `${isLong ? "600 15px" : "700 18.5px"} -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif`;
    ctx!.fillText(field.value, px + 12, py + 52, pw - 24);
  });

  // Diagonal translucent sample watermark
  ctx.save();
  ctx.translate(CARD_W * 0.56, CARD_H * 0.52);
  ctx.rotate(-0.22);
  ctx.fillStyle = "rgba(185, 28, 28, 0.08)";
  ctx.font = "800 64px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.fillText(spec.badge, 0, 0);
  ctx.restore();

  // Bottom MRZ / machine-readable zone band
  ctx.fillStyle = "#F1EFE8";
  ctx.fillRect(0, 500, CARD_W, 140);
  ctx.strokeStyle = "#DEDAD0";
  ctx.beginPath();
  ctx.moveTo(0, 500);
  ctx.lineTo(CARD_W, 500);
  ctx.stroke();

  ctx.fillStyle = "#2A2925";
  ctx.font = "600 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(spec.footerLine1, 48, 548);
  ctx.fillText(spec.footerLine2, 48, 586);

  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.split(",")[1] ?? "";
  if (!base64) {
    return FALLBACK_1X1_PNG;
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  pngCache.set(id, bytes);
  return bytes;
}
