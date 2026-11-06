import { inject, Injectable } from "@angular/core";
import * as JSZip from "jszip";
import { firstValueFrom } from "rxjs";

import { ApiService } from "@vowkey/common/abstractions/api.service";
import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
// eslint-disable-next-line no-restricted-imports
import { EncString, EncryptService } from "@vowkey/legacy-crypto";
import { KeyService } from "@vowkey/key-management";
import { OrganizationId, UserId } from "@vowkey/common/types/guid";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { AgentTarget } from "@vowkey/common/vault/agent/targets";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import {
  DecisionRequest,
  PlannedImageFillField,
  PrivacyMode,
  ProductInference,
  ReadingServiceUnavailableError,
} from "@vowkey/common/vault/local/product-inference";
import { checksum, requestHash } from "@vowkey/common/vault/local/canonical-json";
import { CipherService } from "@vowkey/common/vault/abstractions/cipher.service";
import { CipherSdkService } from "@vowkey/common/vault/abstractions/cipher-sdk.service";
import { CipherType, FieldType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { CipherData } from "@vowkey/common/vault/models/data/cipher.data";
import { Cipher } from "@vowkey/common/vault/models/domain/cipher";
import { CipherRequest } from "@vowkey/common/vault/models/request/cipher.request";
import { CipherResponse } from "@vowkey/common/vault/models/response/cipher.response";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { chooseDetails, chooseHeldAttributes } from "@vowkey/common/vault/profile/decision-choices";
import {
  fillableProfileFieldsOf,
  profileFieldsOf,
} from "@vowkey/common/vault/profile/profile-fields";
import { ProfileDetailEdit, ProfileService } from "@vowkey/common/vault/profile/profile.service";
import { ProfileDocumentActions } from "@vowkey/vault";
import {
  agentRuleOf,
  applyProjection,
  attachSourceBytes,
  CapturedValue,
  CapturedSourceInput,
  Locator,
  migrateLegacyProfile,
  projectEnvelope,
  recordCapture,
  VariantOrigin,
  newEnvelope,
  readEnvelope,
  envelopeState,
  prepareProfileSave,
  copySourceToProfile,
  markSourceDeleted,
  profileRefOf,
  profileUsableForFill,
  VK_META_FIELD,
  writeEnvelope,
} from "@vowkey/common/vault/profile/vk-meta";

import { PdfFormField } from "../../capture/types/capture";
import { readKoreanHealthCertificate } from "./korean-health-certificate";
import * as sdk from "@vowkey/sdk-internal";
import {
  capture_document_text,
  CapturedDocument,
  ChosenField,
  decision_begin,
  decision_finish,
  decision_requests,
  decision_take_first_answers,
  decode_document_barcode,
  detail_label,
  fill_docx_with_profile,
  fill_fields_from_profile,
  fill_form_with_profiles,
  fill_hwpx_with_profile,
  fill_xlsx_with_profile,
  FieldMatch,
  Locator as SdkLocator,
  match_form_field,
  ProfileFields,
  profile_details,
  profile_stored_details,
  PureCrypto,
} from "@vowkey/sdk-internal";

export interface FilledFieldSummary {
  label: string;
  value: string;
  closeCall?: string;
}

export interface UnfilledFieldSummary {
  label: string;
}

export interface FillFormBreakdown {
  filledFields: FilledFieldSummary[];
  unfilledFields: UnfilledFieldSummary[];
  savedToDownloads: boolean;
  previewUrl?: string;
}

/** A detail read from a document, as it sits in a profile now. */
export interface AddedDetail {
  key: string;
  label: string;
  value: string;
  /** True for a machine-readable zone whose check digits all pass. */
  verified: boolean;
}

/** What adding a document did. */
export interface DocumentAdded {
  profile: CipherView;
  created: boolean;
  /** The details the profile did not have, or had differently. */
  added: AddedDetail[];
  /** Whether the original file was attached to the profile. */
  attached: boolean;
  sourceId?: string;
  operationId?: string;
  /** True when this exact document was already stored in the profile. */
  duplicate?: boolean;
}

interface DocumentOperation {
  v: 1;
  intentId: string;
  kind: "capture" | "move" | "delete";
  cipherId: string;
  sourceId: string;
  allocation?: { attachmentId: string; uploadUrl: string };
  bytes?: string;
  uploaded?: boolean;
  originCipherId?: string;
  originSourceId?: string;
  replaceSourceId?: string;
  created?: boolean;
  source?: CapturedSourceInput;
  values?: CapturedValue[];
  capturedAt?: string;
  create?: { localId: string; body: Record<string, unknown>; hash: string };
  upload?: { localId: string; body: Record<string, unknown>; hash: string; contents: string };
}

export interface PendingDocumentOperation {
  id: string;
  kind: DocumentOperation["kind"];
  profileId: string;
  sourceId: string;
  fileName: string;
}

export class CaptureProfileChoiceRequiredError extends Error {
  constructor(readonly profiles: CipherView[]) {
    super("Choose the profile this document belongs to.");
  }
}

export interface CaptureDestination {
  profileId?: string;
  operationId?: string;
  replaceSourceId?: string;
  forceNewProfile?: boolean;
}

/** Numbers printed on a document that belong to one person. */
const PERSONAL_NUMBERS = [
  "id.passport.number",
  "id.residence_card.number",
  "id.driver_license.number",
  "id.national.number",
  "id.card.number",
  "id.ssn",
  "id.mynumber",
  "id.tax.number",
  "id.tax.de_steuer_id",
  "id.pension.number",
  "id.health_insurance.number",
  "bank.account.number",
  "bank.iban",
];

/** Where a document writes the holder's whole name, in one script or another. */
const FULL_NAMES = [
  "name.full",
  "name.full.latin",
  "name.full.kanji",
  "name.full.kana",
  "name.full.hiragana",
  "bank.account.holder.kanji",
  "bank.account.holder.kana",
];

const stripHonorific = (value: string | undefined) =>
  (value ?? "").replace(/\s*(?:様|殿|氏|さん)$/u, "").trim();

const normalized = (value: string | undefined) =>
  stripHonorific(value).replace(/\s+/g, " ").trim().toUpperCase();

const foldLatin = (value: string | undefined) =>
  normalized(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "D");

const canonicalNameTokens = (value: string | undefined): string => {
  const folded = foldLatin(value)
    .replace(/[,./·・\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!folded) {
    return "";
  }
  if (/[\u3040-\u9FFF\uAC00-\uD7AF]/u.test(folded)) {
    return folded.replace(/\s+/g, "");
  }
  const tokens = folded.split(" ").filter(Boolean);
  return tokens.length >= 2 ? [...tokens].sort().join(" ") : folded;
};

const compactId = (value: string | undefined) =>
  normalized(value).replace(/[\s\-./]+/g, "");

const same = (a: string | undefined, b: string | undefined) =>
  normalized(a) !== "" && normalized(a) === normalized(b);

const sameId = (a: string | undefined, b: string | undefined) =>
  compactId(a).length >= 5 && compactId(a) === compactId(b);

const digitsOnly = (value: string | undefined) => (value ?? "").replace(/\D+/g, "");

export function nonDerivedDetailCount(captured: CapturedDocument | null | undefined): number {
  if (!captured || !(captured.details instanceof Map)) {
    return 0;
  }
  let count = 0;
  for (const [key, value] of captured.details.entries()) {
    if (value.trim() !== "" && captured.sources?.get?.(key)?.kind !== "derived") {
      count++;
    }
  }
  return count;
}

function hasPersonAnchor(read: Map<string, string>): boolean {
  if (PERSONAL_NUMBERS.some((key) => normalized(read.get(key)) !== "")) {
    return true;
  }
  if (
    normalized(read.get("contact.email")) !== "" ||
    digitsOnly(read.get("contact.phone")).length >= 7 ||
    digitsOnly(read.get("contact.phone.mobile")).length >= 7
  ) {
    return true;
  }
  for (const [key, val] of read.entries()) {
    if (
      (key.startsWith("name.") || key.startsWith("bank.account.holder")) &&
      normalized(val) !== ""
    ) {
      return true;
    }
  }
  return false;
}

/** Shared household contacts or partial names are not enough to merge people. */
export function isSamePerson(known: Map<string, string>, read: Map<string, string>): boolean {
  const birthAgrees = agreedValue(known, read, "birth.date");
  if (birthAgrees === false) {
    return false;
  }
  const numberKeys = PERSONAL_NUMBERS.filter(
    (key) => normalized(known.get(key)) !== "" && normalized(read.get(key)) !== "",
  );
  const sharedNumber = numberKeys.some(
    (key) => same(known.get(key), read.get(key)) || sameId(known.get(key), read.get(key)),
  );
  const conflictingNumber = numberKeys.some(
    (key) => !same(known.get(key), read.get(key)) && !sameId(known.get(key), read.get(key)),
  );
  if (sharedNumber && !conflictingNumber) {
    return true;
  }

  const namesAgree = nameForms(known).some((left) => nameForms(read).includes(left));
  return namesAgree && (birthAgrees === true || !conflictingNumber);
}

function agreedValue(
  known: Map<string, string>,
  read: Map<string, string>,
  key: string,
): boolean | null {
  const left = normalized(known.get(key));
  const right = normalized(read.get(key));
  if (left === "" || right === "") {
    return null;
  }
  return left === right;
}

function nameForms(details: Map<string, string>): string[] {
  const forms = FULL_NAMES.map((key) => canonicalNameTokens(details.get(key))).filter(
    (form) => form.length >= (/[\u3040-\u9FFF\uAC00-\uD7AF]/u.test(form) ? 2 : 4),
  );
  const parts = nameParts(details);
  if (parts.family !== "" && parts.given !== "") {
    forms.push([...parts.family.split(" "), ...parts.given.split(" ")].sort().join(" "));
  }
  return forms;
}

function nameParts(details: Map<string, string>): { family: string; given: string } {
  const pairs = [
    ["name.family.latin", "name.given.latin"],
    ["name.family.kanji", "name.given.kanji"],
    ["name.family.kana", "name.given.kana"],
    ["name.family.hiragana", "name.given.hiragana"],
    ["name.family", "name.given"],
  ];
  for (const [familyKey, givenKey] of pairs) {
    const family = canonicalNameTokens(details.get(familyKey));
    const given = canonicalNameTokens(details.get(givenKey));
    if (family !== "" && given !== "") {
      return { family, given };
    }
  }
  return { family: "", given: "" };
}


const TEXT_FILE = /\.(txt|md|csv|json)$/i;
const IMAGE_FILE = /\.(png|jpe?g|gif|bmp|tiff?|webp|heic)$/i;
export const FILLABLE_FORM = /\.(docx|xlsx|hwpx)$/i;
/** Field names that say nothing about the field, such as "Text12" or "Check Box3". */
const OPAQUE_NAME =
  /^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$/i;
/** Keyword scores are integer clues; 8+ is strong, and explicit autocomplete is 10. */
const CONFIDENT_LOCAL_SCORE = 8;

/** Why a photo could not be read in full: its print is too small, or the photo is too unclear. */
export type Unclear = "small" | "unclear";

/** What a document says, and whether its photo was too hard to read in full. */
export interface DocumentRead {
  captured: CapturedDocument;
  unclear: Unclear | null;
}

/** The print of a photographed page is too small to read when its lines are under this many pixels tall. */
const SMALL_PRINT_PIXELS = 10;
const TOO_SMALL_PIXELS = 7;

const UNREADABLE_PHOTO_MESSAGE =
  "Couldn't read this photo. Hold the document flat in good light and try again.";

/**
 * Whether a reading says its photo was too hard to read: text recognition reported a boundary
 * diagnostic (`too_small` / `unreadable`) or was unsure of most of the print on a page.
 */
export function unclearReading(reading: string): Unclear | null {
  let pages: { unsure?: number; lineHeight?: number; diagnostic?: string }[];
  try {
    pages = JSON.parse(reading).pages ?? [];
  } catch {
    return null;
  }
  const tooSmall = pages.find(
    (p) =>
      p.diagnostic === "too_small" ||
      (p.lineHeight != null && p.lineHeight > 0 && p.lineHeight < TOO_SMALL_PIXELS),
  );
  if (tooSmall != null) {
    return "small";
  }
  const page = pages.find(
    (p) => p.diagnostic === "unreadable" || (p.unsure ?? 0) >= 0.5,
  );
  if (page == null) {
    return null;
  }
  return page.lineHeight != null && page.lineHeight < SMALL_PRINT_PIXELS ? "small" : "unclear";
}

const ORIGINS: Record<string, VariantOrigin> = {
  mrz: "mrz",
  aamva: "barcode",
  cccd: "barcode",
  text: "text",
  decision: "ocr",
};

const MEDIA_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
};

function mediaTypeOf(fileName: string): string {
  return MEDIA_TYPES[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

const MONTH_ABBR: Record<number, string[]> = {
  1: ["JAN", "JANV", "ENE"],
  2: ["FEB", "FEVR", "FEV"],
  3: ["MAR", "MARS", "MRZ"],
  4: ["APR", "AVR", "ABR"],
  5: ["MAY", "MAI", "MAYO"],
  6: ["JUN", "JUIN", "GIU"],
  7: ["JUL", "JUIL", "LUG"],
  8: ["AUG", "AOUT", "AGO"],
  9: ["SEP", "SEPT", "SET"],
  10: ["OCT", "OKT", "OTT"],
  11: ["NOV"],
  12: ["DEC", "DEZ", "DIC"],
};

const HALFWIDTH_KANA_MAP: Record<string, string> = {
  ｦ: "ヲ", ｧ: "ア", ｨ: "イ", ｩ: "ウ", ｪ: "エ", ｫ: "オ", ｬ: "ヤ", ｭ: "ユ", ｮ: "ヨ", ｯ: "ツ",
  ｰ: "ー", ｱ: "ア", ｲ: "イ", ｳ: "ウ", ｴ: "エ", ｵ: "オ", ｶ: "カ", ｷ: "キ", ｸ: "ク", ｹ: "ケ",
  ｺ: "コ", ｻ: "サ", ｼ: "シ", ｽ: "ス", ｾ: "セ", ｿ: "ソ", ﾀ: "タ", ﾁ: "チ", ﾂ: "ツ", ﾃ: "テ",
  ﾄ: "ト", ﾅ: "ナ", ﾆ: "ニ", ﾇ: "ヌ", ﾈ: "ネ", ﾉ: "ノ", ﾊ: "ハ", ﾋ: "ヒ", ﾌ: "フ", ﾍ: "ヘ",
  ﾎ: "ホ", ﾏ: "マ", ﾐ: "ミ", ﾑ: "ム", ﾒ: "メ", ﾓ: "モ", ﾔ: "ヤ", ﾕ: "ユ", ﾖ: "ヨ", ﾗ: "ラ",
  ﾘ: "リ", ﾙ: "ル", ﾚ: "レ", ﾛ: "ロ", ﾜ: "ワ", ﾝ: "ン",
};
const HALFWIDTH_DAKUTEN_MAP: Record<string, string> = {
  ｶ: "ガ", ｷ: "ギ", ｸ: "グ", ｹ: "ゲ", ｺ: "ゴ", ｻ: "ザ", ｼ: "ジ", ｽ: "ズ", ｾ: "ゼ", ｿ: "ゾ",
  ﾀ: "ダ", ﾁ: "ヂ", ﾂ: "ヅ", ﾃ: "デ", ﾄ: "ド", ﾊ: "バ", ﾋ: "ビ", ﾌ: "ブ", ﾍ: "ベ", ﾎ: "ボ",
  ｳ: "ヴ",
};
const HALFWIDTH_HANDAKUTEN_MAP: Record<string, string> = {
  ﾊ: "パ", ﾋ: "ピ", ﾌ: "プ", ﾍ: "ペ", ﾎ: "ポ",
};
const SMALL_KANA_TO_LARGE: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ",
  ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};

function foldSingleKanaOrLatin(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x3041 && cp <= 0x3096) {
    const kata = String.fromCodePoint(cp + 0x60);
    return SMALL_KANA_TO_LARGE[kata] ?? kata;
  }
  if (SMALL_KANA_TO_LARGE[ch]) {
    return SMALL_KANA_TO_LARGE[ch];
  }
  if (ch === "\u3000") {
    return " ";
  }
  return ch
    .toUpperCase()
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "D");
}

function foldMapped(input: string): { folded: string; indices: number[] } {
  let folded = "";
  const indices: number[] = [];
  for (let i = 0; i < input.length; ) {
    const ch = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";
    if (HALFWIDTH_KANA_MAP[ch]) {
      if (next === "\uff9e" && HALFWIDTH_DAKUTEN_MAP[ch]) {
        folded += HALFWIDTH_DAKUTEN_MAP[ch];
        indices.push(i);
        i += 2;
        continue;
      }
      if (next === "\uff9f" && HALFWIDTH_HANDAKUTEN_MAP[ch]) {
        folded += HALFWIDTH_HANDAKUTEN_MAP[ch];
        indices.push(i);
        i += 2;
        continue;
      }
      folded += HALFWIDTH_KANA_MAP[ch];
      indices.push(i);
      i += 1;
      continue;
    }
    const cp = input.codePointAt(i)!;
    const step = cp > 0xffff ? 2 : 1;
    const glyph = input.slice(i, i + step);
    const norm = foldSingleKanaOrLatin(glyph);
    for (let k = 0; k < norm.length; k++) {
      folded += norm[k];
      indices.push(i);
    }
    i += step;
  }
  indices.push(input.length);
  return { folded, indices };
}

interface PieceTokenSpan {
  s: number;
  e: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function findValueSpanInPiece(
  pieceText: string,
  rawValue: string,
  attribute?: string,
): [number, number] | null {
  const value = rawValue.trim();
  if (!value || !pieceText) {
    return null;
  }
  const isMrzLine = pieceText.includes("<<") && pieceText.replace(/\s+/g, "").length >= 24;
  const upperPiece = pieceText.toUpperCase();
  const upperVal = value.toUpperCase();

  if (value.length <= 3) {
    const escaped = upperVal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const isAsciiWord = /^[A-Z0-9]+$/.test(upperVal);
    const shortRe = isAsciiWord
      ? new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9])`, "i")
      : new RegExp(escaped, "i");
    const sm = shortRe.exec(pieceText);
    if (sm != null) {
      return [sm.index, sm.index + sm[0].length];
    }
  } else {
    const directIdx = upperPiece.indexOf(upperVal);
    if (directIdx >= 0) {
      return [directIdx, directIdx + value.length];
    }
  }

  const mappedPiece = foldMapped(pieceText);
  const mappedVal = foldMapped(value).folded.replace(/\s+/g, " ").trim();
  if (mappedVal.length >= 2) {
    const foldedIdx = mappedPiece.folded.indexOf(mappedVal);
    if (foldedIdx >= 0) {
      const start = mappedPiece.indices[foldedIdx] ?? 0;
      const end =
        mappedPiece.indices[Math.min(mappedPiece.folded.length, foldedIdx + mappedVal.length)] ??
        pieceText.length;
      if (end > start) {
        const beforeChar = start > 0 ? pieceText[start - 1] : "";
        const afterChar = end < pieceText.length ? pieceText[end] : "";
        const badBoundary =
          mappedVal.length <= 3 &&
          /^[A-Z0-9]+$/.test(mappedVal) &&
          (/[A-Za-z0-9]/.test(beforeChar) || /[A-Za-z0-9]/.test(afterChar));
        if (!badBoundary) {
          return [start, end];
        }
      }
    }
  }

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoDate != null) {
    const [, yyyy, mm, dd] = isoDate;
    const yNum = Number(yyyy);
    const mNum = Number(mm);
    const dNum = Number(dd);
    const mPat = `(?:0?${mNum})`;
    const dPat = `(?:0?${dNum})`;
    const months = MONTH_ABBR[mNum] ?? [];
    const monthAlts = months.length > 0 ? `(?:${months.join("|")})[A-Z.]*` : "";
    const eraPatterns: RegExp[] = [];
    if (yNum >= 2019) {
      const rYear = yNum - 2018;
      const rTok = rYear === 1 ? `(?:元|0?1)` : `(?:0?${rYear})`;
      eraPatterns.push(
        new RegExp(`(?:令和|R)\\s*${rTok}\\s*[.年/\\-]\\s*${mPat}\\s*[.月/\\-]\\s*${dPat}(?:日|(?!\\d))`, "i"),
      );
    }
    if (yNum >= 1989 && yNum <= 2019) {
      const hYear = yNum - 1988;
      const hTok = hYear === 1 ? `(?:元|0?1)` : `(?:0?${hYear})`;
      eraPatterns.push(
        new RegExp(`(?:平成|H)\\s*${hTok}\\s*[.年/\\-]\\s*${mPat}\\s*[.月/\\-]\\s*${dPat}(?:日|(?!\\d))`, "i"),
      );
    }
    if (yNum >= 1926 && yNum <= 1989) {
      const sYear = yNum - 1925;
      const sTok = sYear === 1 ? `(?:元|0?1)` : `(?:0?${sYear})`;
      eraPatterns.push(
        new RegExp(`(?:昭和|S)\\s*${sTok}\\s*[.年/\\-]\\s*${mPat}\\s*[.月/\\-]\\s*${dPat}(?:日|(?!\\d))`, "i"),
      );
    }
    const patterns = [
      new RegExp(`(?<!\\d)${yyyy}[\\s./\\-年]+${mPat}[\\s./\\-月]+${dPat}(?:日|(?!\\d))`, "i"),
      new RegExp(`(?<!\\d)${dPat}[\\s./\\-]+${mPat}[\\s./\\-]+${yyyy}(?!\\d)`, "i"),
      new RegExp(`(?<!\\d)${mPat}[\\s./\\-]+${dPat}[\\s./\\-]+${yyyy}(?!\\d)`, "i"),
      ...(monthAlts
        ? [
            new RegExp(`(?<!\\d)${dPat}[\\s./\\-]+${monthAlts}[\\s./\\-,]+${yyyy}(?!\\d)`, "i"),
            new RegExp(`(?<![A-Z])${monthAlts}[\\s./\\-]+${dPat}[\\s./\\-,]+${yyyy}(?!\\d)`, "i"),
          ]
        : []),
      ...eraPatterns,
    ];
    for (const re of patterns) {
      const m = re.exec(pieceText);
      if (m != null) {
        return [m.index, m.index + m[0].length];
      }
    }
  }

  if (
    attribute &&
    /^(?:person\.sex|person\.nationality|address\.country)/.test(attribute)
  ) {
    const normVal = value.toLowerCase();
    for (const group of OPTION_EQUIVALENCE_GROUPS) {
      if (group.includes(normVal)) {
        const sortedSyns = [...group].sort((a, b) => b.length - a.length);
        for (const syn of sortedSyns) {
          if (syn.length === 0) {
            continue;
          }
          const esc = syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const isAscii = /^[a-z0-9 ]+$/i.test(syn);
          const re = isAscii
            ? new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, "i")
            : new RegExp(esc, "i");
          const m = re.exec(pieceText);
          if (m != null) {
            return [m.index, m.index + m[0].length];
          }
        }
      }
    }
  }

  const stripCompact = (s: string, stripChevrons: boolean) => {
    const folded = foldMapped(s);
    let out = "";
    const idxMap: number[] = [];
    const stripRe = stripChevrons ? /[\s\-./<·・,()（）]/ : /[\s\-./·・,()（）]/;
    for (let i = 0; i < folded.folded.length; i++) {
      const c = folded.folded[i];
      if (!stripRe.test(c)) {
        out += c;
        idxMap.push(folded.indices[i] ?? 0);
      }
    }
    idxMap.push(s.length);
    return { out, idxMap };
  };
  const compactVal = stripCompact(value, false).out;
  if (compactVal.length >= 5) {
    const cp = stripCompact(pieceText, isMrzLine && attribute?.startsWith("name.") === true);
    const cIdx = cp.out.indexOf(compactVal);
    if (cIdx >= 0) {
      const start = cp.idxMap[cIdx] ?? 0;
      const nextCompactIdx = cIdx + compactVal.length;
      const lastCharIdx = cp.idxMap[nextCompactIdx - 1] ?? start;
      const step =
        lastCharIdx + 1 < pieceText.length &&
        (pieceText[lastCharIdx + 1] === "\uff9e" || pieceText[lastCharIdx + 1] === "\uff9f")
          ? 2
          : 1;
      const end = Math.min(pieceText.length, lastCharIdx + step);
      if (end > start) {
        return [start, end];
      }
    }
  }

  if (/^[\d,.\s¥￥円₫$€£%+\-]+$/.test(value)) {
    const numDigits = value.replace(/\D+/g, "");
    if (numDigits.length >= 2 && numDigits.length <= 6) {
      const flexPattern = numDigits.split("").join("[,._\\s]*");
      const numRe = new RegExp(`(?<!\\d)0*${flexPattern}(?!\\d)`);
      const nm = numRe.exec(pieceText);
      if (nm != null) {
        return [nm.index, nm.index + nm[0].length];
      }
    }
  }

  if (value.includes("/")) {
    const minPartLen = attribute === "person.sex" || attribute?.endsWith(".sex") ? 1 : 3;
    for (const rawPart of value.split("/")) {
      const part = rawPart.trim();
      if (part.length >= minPartLen && part !== value) {
        const sub = findValueSpanInPiece(pieceText, part, attribute);
        if (sub != null) {
          return sub;
        }
      }
    }
  }

  return null;
}

function charVisualWeight(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (
    (cp >= 0x3000 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xff01 && cp <= 0xff60)
  ) {
    return 1.75;
  }
  if (ch === " ") {
    return 0.45;
  }
  return 1.0;
}

function narrowBoxToSpan(
  piece: {
    pageIndex: number;
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
    spans?: PieceTokenSpan[];
  },
  span: [number, number],
): SdkLocator {
  const total = Math.max(1, piece.text.length);
  const start = Math.max(0, Math.min(total, span[0]));
  const end = Math.max(start + 1, Math.min(total, span[1]));
  const fullLine = start === 0 && end >= total;

  if (!fullLine && piece.spans && piece.spans.length > 0) {
    const overlapping = piece.spans.filter((sp) => sp.e > start && sp.s < end && sp.w > 0 && sp.h > 0);
    if (overlapping.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const sp of overlapping) {
        const spLen = Math.max(1, sp.e - sp.s);
        const subStart = Math.max(sp.s, start) - sp.s;
        const subEnd = Math.min(sp.e, end) - sp.s;
        const sx = subStart > 0 ? sp.x + sp.w * (subStart / spLen) : sp.x;
        const ex = subEnd < spLen ? sp.x + sp.w * (subEnd / spLen) : sp.x + sp.w;
        minX = Math.min(minX, sx);
        maxX = Math.max(maxX, ex);
        minY = Math.min(minY, sp.y);
        maxY = Math.max(maxY, sp.y + sp.h);
      }
      if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
        const x = Math.max(0, Math.min(1, minX));
        const y = Math.max(0, Math.min(1, minY));
        const w = Math.max(0.008, Math.min(1 - x, maxX - minX));
        const h = Math.max(0.008, Math.min(1 - y, maxY - minY));
        return {
          kind: "page",
          page: piece.pageIndex,
          x,
          y,
          w,
          h,
          row: undefined,
          column: undefined,
          a1: undefined,
          table: undefined,
        };
      }
    }
  }

  let totalWeight = 0;
  let beforeWeight = 0;
  let spanWeight = 0;
  for (let i = 0; i < piece.text.length; i++) {
    const cw = charVisualWeight(piece.text[i]);
    totalWeight += cw;
    if (i < start) {
      beforeWeight += cw;
    } else if (i < end) {
      spanWeight += cw;
    }
  }
  const safeTotal = Math.max(1, totalWeight);
  const rawX = fullLine ? piece.x : piece.x + piece.w * (beforeWeight / safeTotal);
  const rawW = fullLine ? piece.w : piece.w * (spanWeight / safeTotal);
  const x = Math.max(0, Math.min(1, rawX));
  const y = Math.max(0, Math.min(1, piece.y));
  const w = Math.max(0.008, Math.min(1 - x, rawW));
  const h = Math.max(0.008, Math.min(1 - y, piece.h));
  return {
    kind: "page",
    page: piece.pageIndex,
    x,
    y,
    w,
    h,
    row: undefined,
    column: undefined,
    a1: undefined,
    table: undefined,
  };
}

/** Where the reader found a detail, in the shape the profile keeps it. */
function locatorOf(place: SdkLocator | undefined | null): Locator | null {
  if (place == null) {
    return null;
  }
  return place.kind === "cell"
    ? {
        kind: "cell",
        page: place.page,
        row: place.row ?? 0,
        column: place.column ?? 0,
        a1: place.a1 ?? null,
        table: place.table ?? null,
      }
    : { kind: "page", page: place.page, x: place.x, y: place.y, w: place.w, h: place.h };
}

/** The first date a document states for a key ending in `suffix`, such as `.issued` or `.expiry`. */
function statedDate(read: Map<string, string>, suffix: string): string | null {
  for (const [key, value] of read) {
    if (key.endsWith(suffix) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return null;
}

function extractNativeBarcodesFromReading(readingJson?: string): string | null {
  if (!readingJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(readingJson) as { pages?: { barcodes?: unknown }[] };
    const raw = parsed?.pages?.[0]?.barcodes;
    if (!Array.isArray(raw)) {
      return null;
    }
    return raw
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      .join("\n");
  } catch {
    return null;
  }
}

function piecesReadingToPlainText(readingJson?: string): string {
  if (!readingJson) {
    return "";
  }
  try {
    const parsed = JSON.parse(readingJson) as {
      pages?: { pieces?: { text?: string; x?: number; y?: number; h?: number }[] }[];
    };
    const linesOut: string[] = [];
    for (const page of parsed.pages ?? []) {
      const pieces = (page.pieces ?? []).filter(
        (p): p is { text: string; x?: number; y?: number; h?: number } =>
          typeof p?.text === "string" && p.text.trim() !== "",
      );
      const sorted = [...pieces].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
      const rows: (typeof pieces)[] = [];
      for (const piece of sorted) {
        const last = rows[rows.length - 1];
        const anchor = last?.[0];
        const tol = Math.max(anchor?.h ?? 0.02, piece.h ?? 0.02) * 0.55;
        if (
          anchor != null &&
          anchor.y != null &&
          piece.y != null &&
          Math.abs(anchor.y + (anchor.h ?? 0) * 0.5 - (piece.y + (piece.h ?? 0) * 0.5)) <= tol
        ) {
          last.push(piece);
        } else {
          rows.push([piece]);
        }
      }
      for (const row of rows) {
        linesOut.push(
          row
            .sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
            .map((p) => p.text)
            .join(" "),
        );
      }
    }
    return linesOut.join("\n");
  } catch {
    return "";
  }
}

/** Reads documents into profiles, and fills forms from them. */
@Injectable({ providedIn: "root" })
export class DocumentCaptureService {
  private accountService = inject(AccountService);
  private cipherService = inject(CipherService);
  private api = inject(ApiService);
  private paths = new WeakMap<File, string>();
  private localVault = inject(LocalVaultService, { optional: true });
  private inference = inject(ProductInference);
  private encryptService = inject(EncryptService, { optional: true });
  private keyService = inject(KeyService, { optional: true });
  private mutations: Promise<unknown> = Promise.resolve();
  private _lastFillBreakdown: FillFormBreakdown | null = null;
  private aiFillOverride = false;
  private readonly imageFillPlanCache = new Map<
    string,
    Promise<{ fields: PlannedImageFillField[] }>
  >();
  private profileService = new ProfileService(
    this.accountService,
    this.cipherService,
    this.localVault,
    inject(CipherSdkService),
  );

  setAiFillMode(enabled: boolean): void {
    this.aiFillOverride = Boolean(enabled);
  }

  getAiFillMode(): boolean {
    return this.aiFillOverride;
  }

  private canUseCloudForFill(): boolean {
    return this.privacyMode() !== "local";
  }

  private async userId(): Promise<UserId | null> {
    return (await firstValueFrom(this.accountService.activeAccount$))?.id ?? null;
  }

  private local(): LocalVaultService {
    if (this.localVault == null) {
      throw new Error("The local vault is unavailable.");
    }
    return this.localVault;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation);
    this.mutations = next.catch((): void => undefined);
    return next;
  }

  private async assertAccount(userId: UserId | null): Promise<void> {
    if (await this.userId() !== userId) {
      throw new Error("The active vault changed. Try again from that vault.");
    }
  }

  private async accountResponse(value: unknown, userId: UserId): Promise<CipherView> {
    if (value == null || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" ||
      !("revisionDate" in value) || typeof value.revisionDate !== "string" ||
      !("type" in value) || value.type !== CipherType.Identity) {
      throw new Error("The server returned an invalid profile.");
    }
    await this.assertAccount(userId);
    const data = new CipherData(new CipherResponse(value));
    await this.cipherService.upsert(data, userId);
    const profile = await this.cipherService.decrypt(new Cipher(data), userId);
    await this.assertAccount(userId);
    return profile;
  }

  private async storedProfile(id: string, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    const profile = userId != null
      ? await this.accountResponse(await this.api.send("GET", `/ciphers/${encodeURIComponent(id)}`, null, userId, true), userId)
      : (await this.local().list()).find((cipher) => cipher.id === id);
    await this.assertAccount(userId);
    if (profile == null || profile.type !== CipherType.Identity || profile.isDeleted || profile.migrationPending) {
      throw new Error("The profile is unavailable.");
    }
    return CipherView.fromSdkCipherView(profile.toSdkCipherView())!;
  }

  private async saveProfile(profile: CipherView, userId: UserId | null): Promise<CipherView> {
    await this.assertAccount(userId);
    prepareProfileSave(profile);
    const saved = userId != null
      ? await this.cipherService.updateWithServer(profile, userId)
      : await this.local().save(profile);
    await this.assertAccount(userId);
    return saved;
  }

  private async saveOperation(id: string, operation: DocumentOperation, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    const plain = JSON.stringify(operation);
    const encrypted = userId != null
      ? (await this.encryptService!.encryptString(plain, await firstValueFrom(this.keyService!.userKey$(userId)))).encryptedString
      : await this.local().seal(plain);
    await this.local().saveOperation(userId ?? `local:${await this.local().installationId()}`, id, encrypted);
  }

  private async operation(id: string, userId: UserId | null): Promise<DocumentOperation | null> {
    const encrypted = await this.local().operation(userId ?? `local:${await this.local().installationId()}`, id);
    if (encrypted == null) {
      return null;
    }
    const plain = userId != null
      ? await this.encryptService!.decryptString(new EncString(encrypted), await firstValueFrom(this.keyService!.userKey$(userId)))
      : await this.local().open(encrypted);
    await this.assertAccount(userId);
    return parseDocumentOperation(JSON.parse(plain));
  }

  private async clearOperation(id: string, userId: UserId | null): Promise<void> {
    await this.assertAccount(userId);
    await this.local().deleteOperation(userId ?? `local:${await this.local().installationId()}`, id);
  }

  async pendingOperations(): Promise<PendingDocumentOperation[]> {
    const userId = await this.userId();
    const rows = await this.local().listOperations(userId ?? `local:${await this.local().installationId()}`);
    const pending: PendingDocumentOperation[] = [];
    for (const row of rows) {
      if (!row.id.startsWith("document:")) {
        continue;
      }
      const operation = await this.operation(row.id, userId);
      if (operation != null) {
        pending.push({
          id: row.id, kind: operation.kind, profileId: operation.cipherId, sourceId: operation.sourceId,
          fileName: operation.source?.fileName ?? "Document",
        });
      }
    }
    return pending;
  }

  async retryOperation(id: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operation = await this.operation(id, userId);
      if (operation == null) {
        throw new Error("The document operation is unavailable.");
      }
      const profile = operation.kind === "capture"
        ? await this.completeCapture(id, operation, userId)
        : operation.kind === "move"
          ? await this.completeMove(id, operation, userId)
          : await this.removeDocument(operation.cipherId, operation.sourceId, userId);
      await this.clearOperation(id, userId);
      return profile;
    });
  }

  /** The people whose details the vault holds: its Identity items. */
  async profiles(): Promise<CipherView[]> {
    const userId = await this.userId();
    const ciphers = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    return ciphers.filter((cipher) => cipher.type === CipherType.Identity && !cipher.isDeleted && !cipher.migrationPending);
  }

  /** The details a profile holds, as they were saved. */
  detailsOf(profile: CipherView): Map<string, string> {
    return profile_stored_details(profileFieldsOf(profile)).details;
  }

  /** Field-by-field breakdown of the most recent fillForm / fillPdfForm call. */
  lastFillBreakdown(): FillFormBreakdown | null {
    return this._lastFillBreakdown;
  }

  /** The text of a document: what this computer reads from a PDF, Office file, photo, or plain file. */
  async readText(file: File, bytes: Uint8Array, readingJson?: string): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return new TextDecoder().decode(bytes);
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      try {
        const officeReading = readingJson || (await extractOfficePieces(file.name, bytes));
        const officeText = officePiecesToPlainText(officeReading);
        if (officeText.trim() !== "") {
          return officeText;
        }
      } catch {
        // Fall through to helper when bytes are not a valid Office zip archive.
      }
    }
    let text = await ipc.capture.readDocument(bytes, file.name);
    if (IMAGE_FILE.test(file.name)) {
      const nativeBarcodes = extractNativeBarcodesFromReading(readingJson);
      if (nativeBarcodes != null) {
        if (nativeBarcodes !== "") {
          text += "\n" + nativeBarcodes;
        }
      } else {
        try {
          text += "\n" + decode_document_barcode(bytes).text;
        } catch {
          // The photo has no barcode, which is usual.
        }
      }
    }
    return text;
  }

  private privacyMode(): PrivacyMode {
    return this.inference?.getPrivacyMode?.() ?? "masked";
  }

  /**
   * Decision is asked through an installed local model or key on this computer when present, and
   * through the hosted relay otherwise. In local-only mode, outside relays are never called.
   */
  private async decide(request: DecisionRequest, allowWhenLocal = false): Promise<unknown> {
    const isLocalMode = this.privacyMode() === "local";
    const settings = await ipc.capture.decisionSettings();
    if (isLocalMode && !allowWhenLocal && !settings?.local) {
      throw new ReadingServiceUnavailableError(0);
    }
    if (settings != null && (!isLocalMode || allowWhenLocal || settings.local)) {
      try {
        return await ipc.capture.askDecision(request);
      } catch (error) {
        if ((isLocalMode && !allowWhenLocal) || typeof this.inference?.decide !== "function") {
          throw error;
        }
      }
    }
    if (isLocalMode && !allowWhenLocal) {
      throw new ReadingServiceUnavailableError(0);
    }
    return this.inference.decide(request);
  }


  private imagePlanId(cacheKey: string): string {
    return `image-plan:${cacheKey}`;
  }

  private async storedImagePlan(
    cacheKey: string,
  ): Promise<{ fields: PlannedImageFillField[] } | null> {
    try {
      const userId = await this.userId();
      const encrypted = await this.local().operation(
        userId ?? `local:${await this.local().installationId()}`,
        this.imagePlanId(cacheKey),
      );
      if (encrypted == null) {
        return null;
      }
      const plain =
        userId != null
          ? await this.encryptService!.decryptString(
              new EncString(encrypted),
              await firstValueFrom(this.keyService!.userKey$(userId)),
            )
          : await this.local().open(encrypted);
      const parsed: unknown = JSON.parse(plain);
      if (parsed == null || typeof parsed !== "object" || !("fields" in parsed) || !Array.isArray(parsed.fields)) {
        return null;
      }
      const fields = parsed.fields.filter(
        (field): field is PlannedImageFillField =>
          field != null &&
          typeof field === "object" &&
          "sourceKey" in field &&
          typeof field.sourceKey === "string" &&
          "value" in field &&
          typeof field.value === "string" &&
          "box" in field &&
          Array.isArray(field.box) &&
          field.box.length === 4,
      );
      return { fields };
    } catch {
      return null;
    }
  }

  private async storeImagePlan(
    cacheKey: string,
    planned: { fields: PlannedImageFillField[] },
  ): Promise<void> {
    if (planned.fields.length === 0) {
      return;
    }
    try {
      const userId = await this.userId();
      const scope = userId ?? `local:${await this.local().installationId()}`;
      const plain = JSON.stringify({ fields: planned.fields });
      const encrypted =
        userId != null
          ? (
              await this.encryptService!.encryptString(
                plain,
                await firstValueFrom(this.keyService!.userKey$(userId)),
              )
            ).encryptedString
          : await this.local().seal(plain);
      await this.local().saveOperation(scope, this.imagePlanId(cacheKey), encrypted);
    } catch {
      // A plan that cannot be sealed stays in memory for this session.
    }
  }

  /** Printed pieces retain their location; standard MRZ/barcode data also works offline. */
  async read(file: File, bytes: Uint8Array): Promise<DocumentRead> {
    const year = new Date().getFullYear();
    const mode = this.privacyMode();
    if (mode === "local") {
      const localSettings = await ipc.capture.decisionSettings();
      if (!localSettings?.local) {
        return this.readLocal(file, bytes, year);
      }
      let localReading = '{"pages":[]}';
      try {
        const decisionRead = await this.readWithDecision(
          file,
          bytes,
          year,
          localSettings.perRequest ?? 0,
          (r) => {
            localReading = r;
          },
        );
        if (nonDerivedDetailCount(decisionRead.captured) > 0) {
          return decisionRead;
        }
        const fallback = await this.readLocal(file, bytes, year);
        return fallback.captured.details.size > 0 ? fallback : decisionRead;
      } catch {
        if (localReading !== '{"pages":[]}') {
          try {
            let captured = await this.readLocalStandard(file, bytes, year, localReading);
            const beforeCount = captured.details.size;
            this.mergeSpatialLabeledPieces(localReading, captured);
            this.groundCapturesToReading(localReading, captured);
            if (captured.details.size > beforeCount) {
              captured = this.withCompanionDetails(captured);
            }
            return { captured, unclear: unclearReading(localReading) };
          } catch {
            // Fall through to readLocal.
          }
        }
        return this.readLocal(file, bytes, year);
      }
    }
    const canReadVision = IMAGE_FILE.test(file.name) || /\.pdf$/i.test(file.name);
    if (mode === "cloud_vision" && canReadVision) {
      const visionRead = await this.readCloudVision(file, bytes, year);
      if (visionRead != null) {
        return visionRead;
      }
    }
    let lastReading = '{"pages":[]}';
    let lastUnclear: Unclear | null = null;
    try {
      const settings = await ipc.capture.decisionSettings();
      const decisionRead = await this.readWithDecision(file, bytes, year, settings?.perRequest ?? 0, (r) => {
        lastReading = r;
        lastUnclear = unclearReading(r);
      });
      if (
        canReadVision &&
        decisionRead.unclear !== "small" &&
        nonDerivedDetailCount(decisionRead.captured) === 0
      ) {
        const visionRead = await this.readCloudVision(file, bytes, year, lastReading);
        if (visionRead != null && nonDerivedDetailCount(visionRead.captured) > 0) {
          if (nonDerivedDetailCount(decisionRead.captured) === 0) {
            return visionRead;
          }
          return {
            captured: this.mergeDecisionAndVisionCaptures(
              decisionRead.captured,
              visionRead.captured,
            ),
            unclear: null,
          };
        }
      }
      return decisionRead;
    } catch (error) {
      let captured = await this.readLocalStandard(
        file,
        bytes,
        year,
        lastReading !== '{"pages":[]}' ? lastReading : undefined,
      );
      const beforeCount = captured.details.size;
      this.mergeSpatialLabeledPieces(lastReading, captured);
      this.groundCapturesToReading(lastReading, captured);
      if (captured.details.size > beforeCount) {
        captured = this.withCompanionDetails(captured);
      }
      if (canReadVision && lastUnclear !== "small") {
        const visionRead = await this.readCloudVision(file, bytes, year, lastReading);
        if (visionRead != null && nonDerivedDetailCount(visionRead.captured) > 0) {
          return nonDerivedDetailCount(captured) === 0
            ? visionRead
            : {
                captured: this.mergeDecisionAndVisionCaptures(captured, visionRead.captured),
                unclear: null,
              };
        }
      }
      if (captured.details.size > 0 || lastUnclear != null) {
        return { captured, unclear: lastUnclear };
      }
      throw error;
    }
  }

  private async readPiecesString(file: File, bytes: Uint8Array): Promise<string> {
    if (TEXT_FILE.test(file.name)) {
      return JSON.stringify({
        pages: [
          {
            index: 0,
            pieces: new TextDecoder()
              .decode(bytes)
              .split("\n")
              .map((text) => ({ text }))
              .filter((piece) => piece.text.trim() !== ""),
          },
        ],
      });
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      try {
        const officeReading = await extractOfficePieces(file.name, bytes);
        if (JSON.parse(officeReading).pages?.some((p: { pieces?: unknown[] }) => (p.pieces?.length ?? 0) > 0)) {
          return officeReading;
        }
      } catch {
        // Fall through to helper if archive cannot be opened.
      }
    }
    return ipc.capture.readPieces(bytes, file.name);
  }

  private withCompanionDetails(captured: CapturedDocument): CapturedDocument {
    let expanded: Map<string, string> | undefined;
    try {
      expanded = profile_details?.({
        identity: {
          title: "",
          first_name: "",
          middle_name: "",
          last_name: "",
          address1: "",
          address2: "",
          address3: "",
          city: "",
          state: "",
          postal_code: "",
          country: "",
          company: "",
          email: "",
          phone: "",
          ssn: "",
          passport_number: "",
          license_number: "",
        },
        custom: new Map(captured.details),
      })?.details;
    } catch {
      return captured;
    }
    if (!(expanded instanceof Map)) {
      return captured;
    }
    const details = new Map(captured.details);
    const sources = new Map(captured.sources);
    let changed = false;
    for (const [key, value] of expanded.entries()) {
      if (!value) {
        continue;
      }
      if (!details.has(key)) {
        details.set(key, value);
        sources.set(key, { kind: "derived", verified: false });
        changed = true;
      } else if (key === "name.full" && !sources.get(key)?.verified && details.get(key) !== value) {
        details.set(key, value);
        changed = true;
      }
    }
    return changed ? { details, sources } : captured;
  }

  private async readLocalStandard(
    file: File,
    bytes: Uint8Array,
    year: number,
    readingJson?: string,
  ): Promise<CapturedDocument> {
    const raw = capture_document_text(await this.readText(file, bytes, readingJson), year);
    return this.withCompanionDetails(raw);
  }

  private async readLocal(file: File, bytes: Uint8Array, year: number): Promise<DocumentRead> {
    let reading = '{"pages":[]}';
    try {
      reading = await this.readPiecesString(file, bytes);
    } catch {
      // Corrupt image or helper failure surfaces as unclear when text extraction is also empty.
      reading = JSON.stringify({ pages: [{ pieces: [], unsure: 1, diagnostic: "unreadable" }] });
    }
    const unclear = unclearReading(reading);
    const structured = readKoreanHealthCertificate(reading);
    if (structured) {
      this.groundCapturesToReading(reading, structured);
      return { captured: this.withCompanionDetails(structured), unclear };
    }
    let captured: CapturedDocument = { details: new Map(), sources: new Map() };
    try {
      captured = await this.readLocalStandard(file, bytes, year, reading);
    } catch {
      return { captured, unclear: unclear ?? "unclear" };
    }
    this.mergeSpatialLabeledPieces(reading, captured);
    this.groundCapturesToReading(reading, captured);
    return { captured: this.withCompanionDetails(captured), unclear };
  }

  /**
   * Grounds un-located details (MRZ, barcode, local text, Cloud Vision) to exact OCR piece boxes
   * and narrows whole-line `"Label: Value"` boxes down to the printed value span.
   */
  public groundCapturesToReading(reading: string, captured: CapturedDocument): void {
    let pages: {
      pieces?: {
        text: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        confidence?: number;
        locator?: SdkLocator;
        spans?: PieceTokenSpan[];
      }[];
    }[];
    try {
      pages = JSON.parse(reading).pages ?? [];
    } catch {
      return;
    }
    if (pages.length === 0) {
      return;
    }

    type IndexedPiece = {
      pageIndex: number;
      text: string;
      x: number;
      y: number;
      w: number;
      h: number;
      isMrz: boolean;
      spans?: PieceTokenSpan[];
    };
    const allPieces: IndexedPiece[] = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      for (const p of pages[pageIndex].pieces ?? []) {
        if (
          typeof p.text === "string" &&
          p.text.trim() !== "" &&
          typeof p.x === "number" &&
          typeof p.y === "number" &&
          typeof p.w === "number" &&
          typeof p.h === "number" &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          Number.isFinite(p.w) &&
          Number.isFinite(p.h) &&
          p.w > 0 &&
          p.h > 0
        ) {
          const cleanSpans = Array.isArray(p.spans)
            ? p.spans
                .filter(
                  (sp) =>
                    sp != null &&
                    typeof sp.s === "number" &&
                    typeof sp.e === "number" &&
                    sp.e > sp.s &&
                    typeof sp.x === "number" &&
                    typeof sp.y === "number" &&
                    typeof sp.w === "number" &&
                    typeof sp.h === "number" &&
                    Number.isFinite(sp.x) &&
                    Number.isFinite(sp.y) &&
                    Number.isFinite(sp.w) &&
                    Number.isFinite(sp.h) &&
                    sp.w > 0 &&
                    sp.h > 0,
                )
                .map((sp) => {
                  const sx = Math.max(0, Math.min(1, sp.x));
                  const sy = Math.max(0, Math.min(1, sp.y));
                  return {
                    s: Math.max(0, Math.trunc(sp.s)),
                    e: Math.max(1, Math.trunc(sp.e)),
                    x: sx,
                    y: sy,
                    w: Math.max(0, Math.min(1 - sx, sp.w)),
                    h: Math.max(0, Math.min(1 - sy, sp.h)),
                  };
                })
            : undefined;
          allPieces.push({
            pageIndex,
            text: p.text,
            x: Math.max(0, Math.min(1, p.x)),
            y: Math.max(0, Math.min(1, p.y)),
            w: Math.max(0, Math.min(1 - Math.max(0, p.x), p.w)),
            h: Math.max(0, Math.min(1 - Math.max(0, p.y), p.h)),
            isMrz: p.text.includes("<<") && p.text.replace(/\s+/g, "").length >= 24,
            ...(cleanSpans && cleanSpans.length > 0 ? { spans: cleanSpans } : {}),
          });
        }
      }
    }
    if (allPieces.length === 0) {
      return;
    }

    const baseAttrOf = (attr: string) =>
      attr.replace(/\.(?:latin|kana|hiragana|kanji|hangul|wareki|zengin)$/, "");
    const pieceMatchesAttributeLabel = (rawLabel: string, targetAttr: string): boolean => {
      if (typeof match_form_field !== "function") {
        return false;
      }
      const cleaned = rawLabel.replace(/[:：/／・.\s]+$/, "").trim();
      if (!cleaned || cleaned.length > 64) {
        return false;
      }
      try {
        const matched = match_form_field({
          id: "lbl",
          name: "",
          label: cleaned,
          placeholder: "",
          autocomplete: "",
          input_type: "text",
          section: "",
          form: "",
          pattern: "",
          max_length: 0,
          format: "",
          op_ignore: false,
        });
        if (!matched?.attribute || (matched.score ?? 0) < 0.65) {
          return false;
        }
        return (
          matched.attribute === targetAttr ||
          baseAttrOf(matched.attribute) === baseAttrOf(targetAttr)
        );
      } catch {
        return false;
      }
    };

    for (const [key, rawValue] of [...captured.details.entries()]) {
      let value = rawValue.trim();
      if (!value) {
        continue;
      }
      if ((key === "person.sex" || key.endsWith(".sex")) && value.length > 1) {
        const biSex =
          /^(?:NAM\s*\/\s*M|M\s*\/\s*NAM|男\s*[/／・.]*\s*M\.?|MALE)$/i.test(value)
            ? "M"
            : /^(?:N[ỮU]\s*\/\s*F|F\s*\/\s*N[ỮU]|女\s*[/／・.]*\s*F\.?|FEMALE)$/i.test(value)
              ? "F"
              : null;
        const mf =
          biSex == null
            ? /(?:性別|SEX|GIỚI\s*TÍNH|성별)[:：\s./]*[男女]?\s*([MF])(?![A-Za-z])/i.exec(value)
            : null;
        const cjkSex = !biSex && !mf ? /(?:性別|성별)[:：\s./]*([男女])/.exec(value) : null;
        const cleanedSex =
          biSex ??
          (mf
            ? mf[1].toUpperCase()
            : cjkSex
              ? cjkSex[1] === "女"
                ? "F"
                : "M"
              : null);
        if (cleanedSex) {
          value = cleanedSex;
          captured.details.set(key, cleanedSex);
        }
      }
      const source = captured.sources.get(key);
      if (source?.kind === "derived" || source?.locator?.kind === "cell") {
        continue;
      }
      const existingLoc = source?.locator?.kind === "page" ? source.locator : undefined;
      if (existingLoc != null) {
        const overlapping = allPieces.filter(
          (p) =>
            p.pageIndex === existingLoc.page &&
            Math.abs(p.y - existingLoc.y) <= Math.max(p.h, existingLoc.h, 0.028) &&
            p.x <= existingLoc.x + existingLoc.w + 0.03 &&
            p.x + p.w >= existingLoc.x - 0.03,
        );
        let matchedOverlap: { piece: IndexedPiece; span: [number, number] } | null = null;
        for (const p of overlapping) {
          const span = findValueSpanInPiece(p.text, value, key);
          if (span != null) {
            matchedOverlap = { piece: p, span };
            break;
          }
        }
        if (matchedOverlap != null) {
          const { piece, span } = matchedOverlap;
          const narrowed = narrowBoxToSpan(piece, span);
          if (
            existingLoc.w > narrowed.w * 1.08 ||
            existingLoc.h > narrowed.h * 1.35 ||
            Math.abs(existingLoc.x - narrowed.x) > 0.015 ||
            Math.abs(existingLoc.y - narrowed.y) > 0.015
          ) {
            captured.sources.set(key, {
              kind: source?.kind ?? "ocr",
              verified: source?.verified ?? false,
              locator: narrowed,
            });
          }
          continue;
        }
        // Keep multi-piece non-VLM boxes intact; allow drifted VLM boxes to snap if a labeled OCR piece matches below.
        if (overlapping.length > 0 && source?.kind !== "decision") {
          continue;
        }
      }

      const shortValue = value.length <= 2;
      let best: { piece: IndexedPiece; span: [number, number]; score: number } | null = null;
      for (const p of allPieces) {
        const span = findValueSpanInPiece(p.text, value, key);
        if (span == null) {
          continue;
        }
        const trimmed = p.text.trim();
        const spanLen = span[1] - span[0];
        const exactWhole = spanLen >= trimmed.length && trimmed.length === p.text.length;
        const prefixText = p.text.slice(0, span[0]);
        const hasColonPrefix = /[:：]/.test(prefixText);
        const inlineLabelMatch =
          prefixText.trim().length > 0 && pieceMatchesAttributeLabel(prefixText, key);
        const adjacentLabelMatch =
          inlineLabelMatch ||
          allPieces.some(
            (adj) =>
              adj !== p &&
              adj.pageIndex === p.pageIndex &&
              ((Math.abs(adj.y - p.y) <= Math.max(adj.h, p.h, 0.025) &&
                adj.x < p.x &&
                p.x - (adj.x + adj.w) <= 0.25) ||
                (Math.abs(adj.x - p.x) <= 0.08 &&
                  p.y > adj.y &&
                  p.y - (adj.y + adj.h) <= Math.max(adj.h * 2.2, 0.06))) &&
              pieceMatchesAttributeLabel(adj.text, key),
          );
        if (shortValue && !exactWhole && !hasColonPrefix && !adjacentLabelMatch) {
          continue;
        }
        let score = 10;
        if (!p.isMrz) {
          score += 20;
        }
        if (adjacentLabelMatch) {
          score += 25;
        }
        if (exactWhole || trimmed.length === spanLen) {
          score += 15;
        } else if (hasColonPrefix) {
          score += 12;
        } else {
          score += Math.round((spanLen / Math.max(1, p.text.length)) * 8);
        }
        if (best == null || score > best.score) {
          best = { piece: p, span, score };
        }
      }

      if (
        best != null &&
        (existingLoc == null || (source?.kind === "decision" && best.score >= 45))
      ) {
        captured.sources.set(key, {
          kind: source?.kind ?? "text",
          verified: source?.verified ?? false,
          locator: narrowBoxToSpan(best.piece, best.span),
        });
      }
    }
  }

  private mergeSpatialLabeledPieces(reading: string, captured: CapturedDocument): void {
    if (typeof match_form_field !== "function") {
      return;
    }
    let pages: {
      pieces?: {
        text: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        confidence?: number;
        locator?: SdkLocator;
      }[];
    }[];
    try {
      pages = JSON.parse(reading).pages ?? [];
    } catch {
      return;
    }
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pieces = (pages[pageIndex].pieces ?? []).filter(
        (p) => (p.confidence ?? 1) >= 0.45 && p.text.trim() !== "",
      );
      for (let i = 0; i < pieces.length - 1; i++) {
        const cur = pieces[i];
        const next = pieces[i + 1];
        const hasPunctuationCue = /[:：]\s*$/.test(cur.text) || cur.text.includes("/");
        const sameRow =
          cur.y != null &&
          next.y != null &&
          Math.abs(cur.y - next.y) <= Math.max(cur.h ?? 0.03, 0.025) &&
          (next.x ?? 0) > (cur.x ?? 0);
        const stackedBelow =
          cur.x != null &&
          next.x != null &&
          cur.y != null &&
          next.y != null &&
          Math.abs(cur.x - next.x) <= 0.06 &&
          next.y > cur.y &&
          next.y - cur.y <= Math.max((cur.h ?? 0.03) * 2.4, 0.08);
        if (!sameRow && !stackedBelow) {
          continue;
        }
        const matched = match_form_field({
          id: `p_${pageIndex}_${i}`,
          name: "",
          label: cur.text.replace(/[:：]\s*$/, "").trim(),
          placeholder: "",
          autocomplete: "",
          input_type: "text",
          section: "",
          form: "",
          pattern: "",
          max_length: 0,
          format: "",
          op_ignore: false,
        });
        const attr = matched?.attribute;
        const score = matched?.score ?? 0;
        if (!attr || (hasPunctuationCue ? score <= 0 : score < 0.75)) {
          continue;
        }
        const val = next.text.trim();
        if (!val || /[:：]\s*$/.test(val) || captured.details.has(attr)) {
          continue;
        }
        if (!hasPunctuationCue) {
          const nextMatched = match_form_field({
            id: `p_${pageIndex}_${i}_n`,
            name: "",
            label: val,
            placeholder: "",
            autocomplete: "",
            input_type: "text",
            section: "",
            form: "",
            pattern: "",
            max_length: 0,
            format: "",
            op_ignore: false,
          });
          if (nextMatched?.attribute && (nextMatched.score ?? 0) >= 0.75) {
            continue;
          }
        }
        captured.details.set(attr, val);
        const hasBox =
          next.x != null && next.y != null && next.w != null && next.h != null &&
          next.w >= 0 && next.h >= 0;
        const x = hasBox ? Math.max(0, Math.min(1, next.x!)) : 0;
        const y = hasBox ? Math.max(0, Math.min(1, next.y!)) : 0;
        captured.sources.set(attr, {
          kind: "text",
          verified: false,
          locator:
            next.locator?.kind === "cell"
              ? next.locator
              : hasBox
                ? {
                    kind: "page",
                    page: pageIndex,
                    x,
                    y,
                    w: Math.max(0, Math.min(1 - x, next.w!)),
                    h: Math.max(0, Math.min(1 - y, next.h!)),
                    row: undefined,
                    column: undefined,
                    a1: undefined,
                    table: undefined,
                  }
                : undefined,
        });
      }
    }
  }

  private async imageDataUrlFor(
    file: File,
    bytes: Uint8Array,
    maxDimension = 1560,
    jpegQuality = 0.85,
  ): Promise<{ dataUrl: string; slices?: { page: number; top: number; height: number }[] } | null> {
    if (IMAGE_FILE.test(file.name)) {
      const mime = mediaTypeOf(file.name);
      if (
        (bytes.byteLength > 180_000 || maxDimension <= 1344) &&
        typeof createImageBitmap === "function" &&
        typeof document !== "undefined"
      ) {
        try {
          const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: mime }));
          const w = bitmap.width;
          const h = bitmap.height;
          const maxSide = Math.max(w, h);
          if (maxSide > maxDimension || mime === "image/png" || mime === "image/heic") {
            const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;
            const targetW = Math.max(1, Math.round(w * scale));
            const targetH = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement("canvas");
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext("2d");
            if (ctx != null) {
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, targetW, targetH);
              ctx.drawImage(bitmap, 0, 0, targetW, targetH);
              bitmap.close?.();
              return { dataUrl: canvas.toDataURL("image/jpeg", jpegQuality) };
            }
          }
          bitmap.close?.();
        } catch {
          // Fall back to raw base64 data URL if browser bitmap decode fails.
        }
      }
      return { dataUrl: `data:${mime};base64,${Utils.fromBufferToB64(bytes)}` };
    }
    if (/\.pdf$/i.test(file.name) && typeof document !== "undefined") {
      try {
        const pdfjs = await import("pdfjs-dist");
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const pageCount = Math.min(doc.numPages, 5);
        if (pageCount <= 0) {
          return null;
        }
        const rendered: { canvas: HTMLCanvasElement; width: number; height: number }[] = [];
        for (let p = 1; p <= pageCount; p++) {
          const page = await doc.getPage(p);
          const baseVp = page.getViewport({ scale: 1.0 });
          const scale = Math.min(2.0, maxDimension / Math.max(1, Math.max(baseVp.width, baseVp.height)));
          const viewport = page.getViewport({ scale: Math.max(1.0, scale) });
          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = Math.ceil(viewport.width);
          pageCanvas.height = Math.ceil(viewport.height);
          const ctx = pageCanvas.getContext("2d");
          if (ctx == null) {
            continue;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          await page.render({ canvasContext: ctx, viewport, canvas: pageCanvas } as any).promise;
          rendered.push({ canvas: pageCanvas, width: pageCanvas.width, height: pageCanvas.height });
        }
        if (rendered.length === 0) {
          return null;
        }
        if (rendered.length === 1) {
          return { dataUrl: rendered[0].canvas.toDataURL("image/jpeg", 0.86) };
        }
        const totalWidth = Math.max(...rendered.map((r) => r.width));
        const gap = 16;
        const totalHeight =
          rendered.reduce((sum, r) => sum + r.height, 0) + gap * (rendered.length - 1);
        const stitched = document.createElement("canvas");
        stitched.width = totalWidth;
        stitched.height = totalHeight;
        const sCtx = stitched.getContext("2d");
        if (sCtx == null) {
          return { dataUrl: rendered[0].canvas.toDataURL("image/jpeg", 0.86) };
        }
        sCtx.fillStyle = "#ffffff";
        sCtx.fillRect(0, 0, totalWidth, totalHeight);
        let offsetY = 0;
        const slices: { page: number; top: number; height: number }[] = [];
        rendered.forEach((r, idx) => {
          slices.push({
            page: idx,
            top: offsetY / totalHeight,
            height: r.height / totalHeight,
          });
          sCtx.drawImage(r.canvas, 0, offsetY);
          offsetY += r.height + gap;
        });
        return { dataUrl: stitched.toDataURL("image/jpeg", 0.86), slices };
      } catch {
        return null;
      }
    }
    return null;
  }

  private mergeDecisionAndVisionCaptures(
    base: CapturedDocument,
    vision: CapturedDocument,
  ): CapturedDocument {
    const details = new Map<string, string>();
    const sources = new Map(base.sources);
    for (const [key, value] of base.details.entries()) {
      if (base.sources.get(key)?.kind !== "derived") {
        details.set(key, value);
      }
    }
    for (const [key, value] of vision.details.entries()) {
      const vSrc = vision.sources.get(key);
      if (vSrc?.kind === "derived") {
        continue;
      }
      const existingSrc = sources.get(key);
      if (existingSrc?.verified && details.has(key)) {
        continue;
      }
      if (!details.has(key)) {
        details.set(key, value);
        if (vSrc != null) {
          sources.set(key, vSrc);
        }
      } else if (existingSrc?.locator == null && vSrc?.locator != null) {
        sources.set(key, { ...existingSrc, locator: vSrc.locator } as any);
      }
    }
    return this.withCompanionDetails({ details, sources });
  }

  private reconcilePayslipArithmetic(
    details: Map<string, string>,
    altDetails: Map<string, string>,
  ): void {
    const parseAmount = (raw: string | undefined): number | null => {
      if (!raw) {
        return null;
      }
      const cleaned = raw.replace(/[¥￥円₫$€£,\s_]/g, "");
      if (!/^-?\d+$/.test(cleaned)) {
        return null;
      }
      const n = Number(cleaned);
      return Number.isSafeInteger(n) ? n : null;
    };
    const deductionKeys = [
      "income.insurance.health",
      "income.insurance.pension",
      "income.insurance.employment",
      "income.tax.income",
      "income.tax.resident",
    ];
    const totalDed = parseAmount(details.get("income.deductions.total"));
    if (totalDed != null && totalDed > 0) {
      const parsedItems = deductionKeys.map((k) => ({ key: k, val: parseAmount(details.get(k)) }));
      if (parsedItems.every((it) => it.val != null)) {
        const currentSum = parsedItems.reduce((acc, it) => acc + (it.val ?? 0), 0);
        if (currentSum !== totalDed) {
          for (const it of parsedItems) {
            const altRaw = altDetails.get(it.key);
            const altVal = parseAmount(altRaw);
            if (altVal != null && altVal !== it.val && currentSum - (it.val ?? 0) + altVal === totalDed) {
              details.set(it.key, altRaw!);
              break;
            }
          }
        }
      }
    }
  }

  private async readCloudVision(
    file: File,
    bytes: Uint8Array,
    year: number,
    existingReading?: string,
  ): Promise<DocumentRead | null> {
    if (typeof this.inference?.readDocumentVision !== "function") {
      return null;
    }
    const rendered = await this.imageDataUrlFor(file, bytes);
    if (rendered == null) {
      return null;
    }
    try {
      const localTask = (async () => {
        let reading = existingReading ?? '{"pages":[]}';
        let unclear: Unclear | null = existingReading ? unclearReading(existingReading) : null;
        if (!existingReading) {
          try {
            reading = await this.readPiecesString(file, bytes);
            unclear = unclearReading(reading);
          } catch {
            unclear = "unclear";
          }
        }
        let local: CapturedDocument = { details: new Map(), sources: new Map() };
        try {
          local = await this.readLocalStandard(file, bytes, year, reading);
        } catch {
          // Local OCR helper failure does not block Cloud Vision.
        }
        return { reading, unclear, local };
      })();

      const [vision, { reading, unclear, local }] = await Promise.all([
        this.inference.readDocumentVision(rendered.dataUrl, file.name),
        localTask,
      ]);
      if (vision == null) {
        return null;
      }
      this.mergeSpatialLabeledPieces(reading, local);
      const details = new Map<string, string>();
      const sources = new Map(local.sources);
      for (const [key, value] of local.details.entries()) {
        if (local.sources.get(key)?.verified) {
          details.set(key, value);
        }
      }
      let visionCount = 0;
      for (const [rawKey, rawVal] of Object.entries(vision.details ?? {})) {
        const value = typeof rawVal === "string" ? rawVal.trim() : "";
        if (!rawKey || !value) {
          continue;
        }
        visionCount++;
        if (sources.get(rawKey)?.verified && details.has(rawKey)) {
          continue;
        }
        details.set(rawKey, value);
        let locator: SdkLocator | undefined;
        const rawBox = vision.locators?.[rawKey];
        if (
          rawBox != null &&
          Number.isFinite(rawBox.x) &&
          Number.isFinite(rawBox.y) &&
          Number.isFinite(rawBox.w) &&
          Number.isFinite(rawBox.h) &&
          rawBox.w > 0 &&
          rawBox.h > 0
        ) {
          let page = Math.max(0, Math.trunc(rawBox.page));
          let y = rawBox.y;
          let h = rawBox.h;
          if (page === 0 && rendered.slices && rendered.slices.length > 1) {
            const centerY = rawBox.y + rawBox.h * 0.5;
            const slice =
              rendered.slices.find(
                (s) => centerY >= s.top && centerY <= s.top + s.height,
              ) ?? rendered.slices[0];
            page = slice.page;
            y = (rawBox.y - slice.top) / Math.max(0.01, slice.height);
            h = rawBox.h / Math.max(0.01, slice.height);
          }
          const cx = Math.max(0, Math.min(1, rawBox.x));
          const cy = Math.max(0, Math.min(1, y));
          locator = {
            kind: "page",
            page,
            x: cx,
            y: cy,
            w: Math.max(0.008, Math.min(1 - cx, rawBox.w)),
            h: Math.max(0.008, Math.min(1 - cy, h)),
            row: undefined,
            column: undefined,
            a1: undefined,
            table: undefined,
          };
        }
        sources.set(rawKey, {
          kind: "decision",
          verified: false,
          ...(locator != null ? { locator } : {}),
        } as any);
      }
      for (const [key, value] of local.details.entries()) {
        if (!details.has(key) && local.sources.get(key)?.kind !== "derived") {
          details.set(key, value);
        }
      }
      this.reconcilePayslipArithmetic(details, local.details);
      if (visionCount === 0 && nonDerivedDetailCount(local) === 0) {
        return null;
      }
      const grounded = { details, sources };
      this.groundCapturesToReading(reading, grounded);
      const merged = this.withCompanionDetails(grounded);
      return {
        captured: merged,
        unclear: visionCount > 0 || merged.details.size > 0 ? null : unclear,
      };
    } catch {
      return null;
    }
  }

  private async readWithDecision(
    file: File,
    bytes: Uint8Array,
    year: number,
    perRequest: number,
    onReading?: (reading: string) => void,
  ): Promise<DocumentRead> {
    const reading = await this.readPiecesString(file, bytes);
    onReading?.(reading);
    const structured = readKoreanHealthCertificate(reading);
    if (structured) {
      this.groundCapturesToReading(reading, structured);
      return { captured: this.withCompanionDetails(structured), unclear: unclearReading(reading) };
    }
    const ask = async (requests: string) => {
      if (requests === "[]") {
        return [];
      }
      const parsed = JSON.parse(requests) as DecisionRequest[];
      return parsed.length === 0 ? [] : Promise.all(parsed.map((r) => this.decide(r)));
    };

    let plan = decision_begin(reading, perRequest);
    plan = decision_take_first_answers(
      plan,
      JSON.stringify(await ask(decision_requests(plan, false))),
    );
    const second = await ask(decision_requests(plan, true));

    let barcode = "";
    if (IMAGE_FILE.test(file.name)) {
      const nativeBarcodes = extractNativeBarcodesFromReading(reading);
      if (nativeBarcodes != null) {
        barcode = nativeBarcodes;
      } else {
        try {
          barcode = decode_document_barcode(bytes).text;
        } catch {
          // The photo has no barcode, which is usual.
        }
      }
    }
    const captured = decision_finish(plan, JSON.stringify(second), barcode, year);
    this.groundCapturesToReading(reading, captured);
    return {
      captured,
      unclear: unclearReading(reading),
    };
  }

  /** Adds what a document says to the profile it belongs to, or to a new one. */
  async add(text: string, file: File, bytes: Uint8Array): Promise<DocumentAdded | null> {
    return this.addCaptured(capture_document_text(text, new Date().getFullYear()), file, bytes);
  }

  /** Adds the details read from a document to the profile it belongs to, or to a new one. */
  async addCaptured(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination = {},
  ): Promise<DocumentAdded | null> {
    return this.exclusive(() => this.capture(captured, file, bytes, destination));
  }

  private async capture(
    captured: CapturedDocument,
    file: File,
    bytes: Uint8Array,
    destination: CaptureDestination,
  ): Promise<DocumentAdded | null> {
    const read = new Map([...captured.details].filter(([key]) => captured.sources.get(key)?.kind !== "derived"));
    if (read.size === 0 && destination.profileId == null) {
      return null;
    }
    const fileSha256 = await checksum(bytes);
    const mediaType = mediaTypeOf(file.name);
    const userId = await this.userId();
    const profiles = userId != null ? await this.cipherService.getAllDecrypted(userId) : await this.local().list();
    await this.assertAccount(userId);
    const liveProfiles = profiles.filter(
      (profile) =>
        profile.type === CipherType.Identity &&
        !profile.isDeleted &&
        !profile.migrationPending &&
        (envelopeState(profile) === "none" || profileUsableForFill(profile)),
    );

    if (destination.replaceSourceId == null) {
      const valueMatchesVariant = (attrKey: string, a: string, b: string): boolean =>
        attrKey.startsWith("id.") || attrKey.endsWith(".number") ? sameId(a, b) : same(a, b);

      const findDuplicateIn = async (
        candidates: CipherView[],
      ): Promise<{ profile: CipherView; sourceId: string } | null> => {
        for (const candidate of candidates) {
          const env = readEnvelope(candidate);
          if (env == null) {
            continue;
          }
          const candidateDetails = this.detailsOf(candidate);
          for (const src of env.sources) {
            if (src.status === "deleted" || src.attachmentId == null) {
              continue;
            }
            if (src.sha256 != null && src.sha256 === fileSha256) {
              return { profile: candidate, sourceId: src.id };
            }
            const sameFileMeta =
              src.fileName.toLowerCase() === file.name.toLowerCase() &&
              src.mediaType === mediaType;
            if (src.sha256 == null && sameFileMeta) {
              try {
                const existingBytes = await this.documentBytes(candidate.id, src.id);
                if ((await checksum(existingBytes)) === fileSha256) {
                  return { profile: candidate, sourceId: src.id };
                }
              } catch {
                // Fall back to semantic content check below when legacy attachment bytes cannot be read.
              }
            }
            if (read.size > 0) {
              const srcVariantAttrs = new Set<string>();
              for (const det of env.details) {
                if (det.variants.some((vr) => vr.sourceId === src.id)) {
                  srcVariantAttrs.add(det.attribute ?? det.id);
                }
              }
              const sufficientOverlap =
                (srcVariantAttrs.size >= 2 &&
                  read.size >= Math.max(2, Math.ceil(srcVariantAttrs.size * 0.8))) ||
                (src.sha256 == null && sameFileMeta);
              if (!sufficientOverlap) {
                continue;
              }
              const allSameOnSource = [...read].every(([k, v]) => {
                const knownVal = candidateDetails.get(k);
                const inCandidate =
                  (knownVal != null && valueMatchesVariant(k, knownVal, v)) ||
                  env.details.some(
                    (d) =>
                      (d.attribute === k ||
                        d.attribute ===
                          k.replace(/\.(?:latin|kana|hiragana|kanji|hangul|wareki|zengin)$/, "")) &&
                      d.variants.some((vr) => valueMatchesVariant(k, vr.value, v)),
                  );
                if (!inCandidate) {
                  return false;
                }
                const baseAttr = k.replace(
                  /\.(?:latin|kana|hiragana|kanji|hangul|wareki|zengin)$/,
                  "",
                );
                return env.details.some(
                  (d) =>
                    (d.attribute === k || d.attribute === baseAttr) &&
                    d.variants.some(
                      (variant) =>
                        variant.sourceId === src.id &&
                        valueMatchesVariant(k, variant.value, v),
                    ),
                );
              });
              if (allSameOnSource) {
                return { profile: candidate, sourceId: src.id };
              }
            }
          }
        }
        return null;
      };

      if (destination.profileId != null) {
        const targetCandidate = liveProfiles.find((p) => p.id === destination.profileId);
        const dupInTarget = targetCandidate != null ? await findDuplicateIn([targetCandidate]) : null;
        if (dupInTarget != null) {
          return {
            profile: await this.storedProfile(dupInTarget.profile.id, userId),
            created: false,
            added: [],
            attached: true,
            sourceId: dupInTarget.sourceId,
            duplicate: true,
          };
        }
      } else {
        const dupAnywhere = await findDuplicateIn(liveProfiles);
        if (dupAnywhere != null) {
          return {
            profile: await this.storedProfile(dupAnywhere.profile.id, userId),
            created: false,
            added: [],
            attached: true,
            sourceId: dupAnywhere.sourceId,
            duplicate: true,
          };
        }
      }
    }

    const matches = destination.forceNewProfile
      ? []
      : liveProfiles.filter((profile) => isSamePerson(this.detailsOf(profile), read));
    if (matches.length > 1 && destination.profileId == null) {
      throw new CaptureProfileChoiceRequiredError(matches);
    }
    if (
      !destination.forceNewProfile &&
      matches.length === 0 &&
      destination.profileId == null &&
      liveProfiles.length > 0 &&
      !hasPersonAnchor(read)
    ) {
      throw new CaptureProfileChoiceRequiredError(liveProfiles);
    }
    const existing = destination.profileId != null
      ? await this.storedProfile(destination.profileId, userId)
      : !destination.forceNewProfile && matches.length === 1
        ? await this.storedProfile(matches[0].id, userId)
        : null;
    if (existing != null && !existing.edit) {
      throw new Error("This profile is read-only.");
    }
    const profile = existing ?? this.newProfile(read, file);
    profile.id ||= crypto.randomUUID();
    const known = existing != null ? this.detailsOf(existing) : new Map<string, string>();
    const added = [...read].filter(([key, value]) => known.get(key) !== value).map(([key, value]) => ({
      key, value, label: detail_label(key), verified: captured.sources.get(key)?.verified ?? false,
    }));
    const operation: DocumentOperation = {
      v: 1, kind: "capture", cipherId: profile.id, sourceId: crypto.randomUUID(),
      intentId: crypto.randomUUID(), bytes: Utils.fromBufferToB64(bytes), capturedAt: new Date().toISOString(),
      created: existing == null, replaceSourceId: destination.replaceSourceId,
      source: {
        fileName: file.name, mediaType, kind: "document", sha256: fileSha256,
        documentDate: statedDate(read, ".issued"), expiresOn: statedDate(read, ".expiry"),
      },
      values: [...read].map(([key, value]) => {
        const source = captured.sources.get(key);
        return { key, value, origin: ORIGINS[source?.kind ?? "text"] ?? "ocr",
          verified: source?.verified ?? false, locator: locatorOf(source?.locator) };
      }),
    };
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (destination.replaceSourceId != null && !meta.sources.some((source) =>
      source.id === destination.replaceSourceId && source.status !== "deleted" && source.attachmentId != null)) {
      throw new Error("The document being replaced is unavailable.");
    }
    if (userId == null) {
      const attachmentId = crypto.randomUUID();
      this.commitCaptureMetadata(profile, operation, attachmentId);
      const saved = await this.local().save(profile, [{ id: attachmentId, fileName: file.name, bytes }]);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId };
    }
    const operationId = `document:${operation.intentId}`;
    if (existing == null) {
      writeEnvelope(profile, newEnvelope(profile.id));
      const context = await this.cipherService.encrypt(profile, userId);
      const body: Record<string, unknown> = JSON.parse(JSON.stringify(new CipherRequest(context)));
      if (typeof body.key !== "string" || !body.key) {
        throw new Error("The profile's encryption key is unavailable.");
      }
      body.migrationPending = false;
      operation.create = { localId: profile.id, body, hash: await requestHash(body) };
    }
    await this.saveOperation(operationId, operation, userId);
    try {
      const saved = await this.completeCapture(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return { profile: saved, created: existing == null, added, attached: true, sourceId: operation.sourceId, operationId };
    } catch {
      profile.id = operation.cipherId;
      return { profile, created: existing == null, added, attached: false, sourceId: operation.sourceId, operationId };
    }
  }

  private commitCaptureMetadata(profile: CipherView, operation: DocumentOperation, attachmentId: string): void {
    const meta = migrateLegacyProfile(profile, { labelOf: detail_label });
    if (!meta.sources.some((source) => source.id === operation.sourceId)) {
      const previous = [...projectEnvelope(meta).text.keys()];
      let firstId = true;
      recordCapture(meta, operation.source!, operation.values!, {
        labelOf: detail_label, now: () => new Date(operation.capturedAt!),
        newId: () => { if (firstId) { firstId = false; return operation.sourceId; } return crypto.randomUUID(); },
      });
      attachSourceBytes(meta, operation.sourceId, attachmentId);
      if (operation.replaceSourceId != null) {
        const old = meta.sources.find((source) => source.id === operation.replaceSourceId);
        if (old == null || old.status === "deleted" || old.attachmentId == null) {
          throw new Error("The document being replaced is unavailable.");
        }
        old.status = "retained";
      }
      writeEnvelope(profile, meta);
      applyProjection(profile, projectEnvelope(meta), previous);
    }
  }

  private async completeCapture(id: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    if (userId == null) {
      throw new Error("Local document saves are atomic and do not need an upload retry.");
    }
    if (operation.create != null) {
      const create = operation.create;
      const response: unknown = await this.api.send("POST", "/ciphers", {
        ...create.body, migrationId: operation.intentId, localResourceId: create.localId, requestHash: create.hash,
      }, userId, true);
      const created = await this.accountResponse(response, userId);
      operation.cipherId = created.id;
      await this.saveOperation(id, operation, userId);
    }
    let profile = await this.storedProfile(operation.cipherId, userId);
    const committed = readEnvelope(profile)?.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId != null) {
      return profile;
    }
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    const bytes = new Uint8Array(Utils.fromB64ToArray(operation.bytes!));
    await this.uploadDocument(profile, id, operation, bytes, userId);
    profile = await this.storedProfile(operation.cipherId, userId);
    this.commitCaptureMetadata(profile, operation, operation.allocation!.attachmentId);
    const saved = await this.saveProfile(profile, userId);
    if (!readEnvelope(saved)?.sources.some((source) =>
      source.id === operation.sourceId && source.attachmentId === operation.allocation!.attachmentId)) {
      throw new Error("The document was uploaded but its profile update was not acknowledged.");
    }
    return saved;
  }

  private async uploadDocument(profile: CipherView, id: string, operation: DocumentOperation, bytes: Uint8Array, userId: UserId): Promise<void> {
    await this.assertAccount(userId);
    if (operation.uploaded) {
      return;
    }
    if (operation.upload == null) {
      const { cipher } = await this.cipherService.encrypt(profile, userId);
      const key = profile.organizationId == null
        ? await firstValueFrom(this.keyService!.userKey$(userId))
        : (await firstValueFrom(this.keyService!.orgKeys$(userId)))[profile.organizationId as OrganizationId];
      if (key == null) {
        throw new Error("Unlock the vault to upload this document.");
      }
      const encoded = key.toEncoded();
      try {
        const localId = crypto.randomUUID();
        const prepared = PureCrypto.encrypt_legacy_attachment(cipher.toSdkCipher(), {
          id: localId, fileName: operation.source!.fileName,
        }, bytes, encoded);
        const contents = Uint8Array.from(prepared.contents);
        const body = {
          key: prepared.attachment.key, fileName: prepared.attachment.fileName,
          fileSize: contents.byteLength, bytesChecksum: await checksum(contents),
          lastKnownRevisionDate: profile.revisionDate.toISOString(),
        };
        operation.upload = { localId, body, hash: await requestHash(body), contents: Utils.fromBufferToB64(contents) };
      } finally {
        encoded.fill(0);
      }
      await this.saveOperation(id, operation, userId);
    }
    const upload = operation.upload;
    const allocation: unknown = await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/v2`, {
      ...upload.body, migrationId: operation.intentId, localResourceId: upload.localId, requestHash: upload.hash,
    }, userId, true);
    if (allocation == null || typeof allocation !== "object" ||
      !("attachmentId" in allocation) || typeof allocation.attachmentId !== "string" ||
      !("url" in allocation) || typeof allocation.url !== "string") {
      throw new Error("The attachment allocation was not acknowledged.");
    }
    operation.allocation = { attachmentId: allocation.attachmentId, uploadUrl: allocation.url };
    await this.saveOperation(id, operation, userId);
    await this.assertAccount(userId);
    const form = new FormData();
    form.append("data", new Blob([new Uint8Array(Utils.fromB64ToArray(upload.contents)).buffer]), "attachment");
    await this.api.send("POST", `/ciphers/${encodeURIComponent(profile.id)}/attachment/${encodeURIComponent(operation.allocation.attachmentId)}`,
      form, userId, false);
    operation.uploaded = true;
    await this.saveOperation(id, operation, userId);
  }

  async retryCapture(operationId: string): Promise<CipherView> {
    return this.retryOperation(operationId);
  }

  /** Saves an explicit correction, alternative selection, dismissal or detail deletion. */
  async editDetail(profileId: string, edit: ProfileDetailEdit): Promise<CipherView> {
    return this.exclusive(() => this.profileService.edit(profileId, edit));
  }

  /** A replacement is a new capture source; retained history keeps the old bytes and locator. */
  async replaceDocument(
    profileId: string, sourceId: string, captured: CapturedDocument, file: File, bytes: Uint8Array,
  ): Promise<DocumentAdded | null> {
    return this.addCaptured(captured, file, bytes, { profileId, replaceSourceId: sourceId });
  }

  /** Deletes only bytes. Saved details and history retain the original logical source id. */
  async deleteDocument(profileId: string, sourceId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      const userId = await this.userId();
      const operationId = `document:delete:${profileId}:${sourceId}`;
      const operation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "delete", cipherId: profileId, sourceId,
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.removeDocument(profileId, sourceId, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async removeDocument(profileId: string, sourceId: string, userId: UserId | null): Promise<CipherView> {
    let profile = await this.storedProfile(profileId, userId);
    if (!profile.edit) {
      throw new Error("This profile is read-only.");
    }
    let meta = migrateLegacyProfile(profile);
    const source = meta.sources.find((candidate) => candidate.id === sourceId);
    if (source == null) {
      throw new Error("The document is unavailable.");
    }
    const attachmentId = source.attachmentId;
    if (userId == null) {
      markSourceDeleted(meta, sourceId);
      writeEnvelope(profile, meta);
      const present = attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId);
      return this.local().save(profile, [], present ? [attachmentId] : []);
    }
    if (attachmentId != null && profile.attachments.some((attachment) => attachment.id === attachmentId)) {
      await this.cipherService.deleteAttachmentWithServer(profileId, attachmentId, userId, false);
      profile = await this.storedProfile(profileId, userId);
      meta = migrateLegacyProfile(profile);
    }
    markSourceDeleted(meta, sourceId);
    writeEnvelope(profile, meta);
    return this.saveProfile(profile, userId);
  }

  /** Downloads only the original source's bytes; a deleted source never substitutes a replacement. */
  async documentBytes(profileId: string, sourceId: string): Promise<Uint8Array> {
    return this.profileService.bytes(profileId, sourceId);
  }

  /** The origin is retired only after a verified destination source update is acknowledged. */
  async moveDocument(originId: string, sourceId: string, destinationId: string): Promise<CipherView> {
    return this.exclusive(async () => {
      if (originId === destinationId) {
        throw new Error("Choose a different destination profile.");
      }
      const userId = await this.userId();
      const operationId = `document:move:${originId}:${sourceId}:${destinationId}`;
      const origin = await this.storedProfile(originId, userId);
      const destination = await this.storedProfile(destinationId, userId);
      const source = readEnvelope(origin)?.sources.find((item) => item.id === sourceId);
      if (!origin.edit || !destination.edit || source == null || source.status === "deleted" || source.attachmentId == null) {
        throw new Error("Both profiles must be editable and the document must be available.");
      }
      const operation: DocumentOperation = await this.operation(operationId, userId) ?? {
        v: 1, intentId: crypto.randomUUID(), kind: "move", cipherId: destinationId, sourceId: crypto.randomUUID(),
        originCipherId: originId, originSourceId: sourceId,
        source: { fileName: source.fileName, mediaType: source.mediaType, kind: source.kind },
      };
      await this.saveOperation(operationId, operation, userId);
      const saved = await this.completeMove(operationId, operation, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  private async completeMove(operationId: string, operation: DocumentOperation, userId: UserId | null): Promise<CipherView> {
    let destination = await this.storedProfile(operation.cipherId, userId);
    const origin = await this.storedProfile(operation.originCipherId!, userId);
    if (!origin.edit || !destination.edit) {
      throw new Error("Both profiles must be editable to move a document.");
    }
    const originMeta = migrateLegacyProfile(origin);
    let meta = migrateLegacyProfile(destination);
    const committed = meta.sources.find((source) => source.id === operation.sourceId);
    if (committed?.attachmentId == null) {
      const bytes = await this.documentBytes(origin.id, operation.originSourceId!);
      await this.assertAccount(userId);
      const previous = [...projectEnvelope(meta).text.keys()];
      if (userId == null) {
        const attachmentId = crypto.randomUUID();
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), previous);
        destination = await this.local().save(destination, [{ id: attachmentId, fileName: operation.source!.fileName, bytes }]);
      } else {
        await this.uploadDocument(destination, operationId, operation, bytes, userId);
        destination = await this.storedProfile(destination.id, userId);
        meta = migrateLegacyProfile(destination);
        const currentNames = [...projectEnvelope(meta).text.keys()];
        copySourceToProfile(meta, originMeta, operation.originSourceId!, operation.sourceId, operation.allocation!.attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), currentNames);
        destination = await this.saveProfile(destination, userId);
      }
    }
    const savedSource = readEnvelope(destination)?.sources.find((source) => source.id === operation.sourceId);
    if (savedSource?.attachmentId == null || savedSource.status === "deleted") {
      throw new Error("The destination document was not committed.");
    }
    await this.removeDocument(origin.id, operation.originSourceId!, userId);
    return destination;
  }

  /**
   * Copies an attached document and its provenance-linked details into `destinationId` without
   * removing it from `originId` (used for shared household records like `住民票` or marriage certificates).
   */
  async copyDocumentToProfile(
    originId: string,
    sourceId: string,
    destinationId: string,
  ): Promise<CipherView> {
    return this.exclusive(async () => {
      if (originId === destinationId) {
        return this.storedProfile(destinationId, await this.userId());
      }
      const userId = await this.userId();
      const origin = await this.storedProfile(originId, userId);
      let destination = await this.storedProfile(destinationId, userId);
      const originMeta = migrateLegacyProfile(origin);
      const source = originMeta.sources.find((item) => item.id === sourceId);
      if (
        !destination.edit ||
        source == null ||
        source.status === "deleted" ||
        source.attachmentId == null
      ) {
        throw new Error("The destination profile must be editable and the document must be available.");
      }
      let meta = migrateLegacyProfile(destination);
      if (
        source.sha256 != null &&
        meta.sources.some(
          (existing) =>
            existing.status !== "deleted" &&
            existing.attachmentId != null &&
            existing.sha256 === source.sha256,
        )
      ) {
        return destination;
      }
      const newSourceId = crypto.randomUUID();
      const bytes = await this.documentBytes(origin.id, sourceId);
      await this.assertAccount(userId);
      if (userId == null) {
        const previous = [...projectEnvelope(meta).text.keys()];
        const attachmentId = crypto.randomUUID();
        copySourceToProfile(meta, originMeta, sourceId, newSourceId, attachmentId);
        writeEnvelope(destination, meta);
        applyProjection(destination, projectEnvelope(meta), previous);
        return this.local().save(destination, [
          { id: attachmentId, fileName: source.fileName, bytes },
        ]);
      }
      const operationId = `document:copy:${originId}:${sourceId}:${destinationId}`;
      const operation: DocumentOperation = {
        v: 1,
        intentId: crypto.randomUUID(),
        kind: "move",
        cipherId: destinationId,
        sourceId: newSourceId,
        originCipherId: originId,
        originSourceId: sourceId,
        source: { fileName: source.fileName, mediaType: source.mediaType, kind: source.kind },
      };
      await this.uploadDocument(destination, operationId, operation, bytes, userId);
      destination = await this.storedProfile(destination.id, userId);
      meta = migrateLegacyProfile(destination);
      const currentNames = [...projectEnvelope(meta).text.keys()];
      copySourceToProfile(
        meta,
        originMeta,
        sourceId,
        newSourceId,
        operation.allocation!.attachmentId,
      );
      writeEnvelope(destination, meta);
      applyProjection(destination, projectEnvelope(meta), currentNames);
      const saved = await this.saveProfile(destination, userId);
      await this.clearOperation(operationId, userId);
      return saved;
    });
  }

  /**
   * Builds a profile's effective `ProfileFields` by merging any non-deleted Vault items
   * (`Card`, `Login`, `SecureNote`, `ApiKey`, `Environment`) explicitly linked to `profile.id`
   * without overwriting the profile's own stored details.
   */
  async effectiveProfileFields(profile: CipherView): Promise<ProfileFields> {
    const base = fillableProfileFieldsOf(profile);
    if (!profile.id) {
      return base;
    }
    let ciphers: CipherView[] = [];
    try {
      const userId = await this.userId();
      if (userId != null) {
        if (typeof this.cipherService?.getAllDecrypted === "function") {
          const listed = await this.cipherService.getAllDecrypted(userId);
          ciphers = Array.isArray(listed) ? listed : [];
        }
      } else if (this.localVault != null && typeof this.localVault.list === "function") {
        const listed = await this.localVault.list();
        ciphers = Array.isArray(listed) ? listed : [];
      }
    } catch {
      return base;
    }

    const linked = ciphers.filter(
      (item) =>
        item != null &&
        item.id !== profile.id &&
        item.type !== CipherType.Identity &&
        !item.isDeleted &&
        !item.migrationPending &&
        profileRefOf(item) === profile.id,
    );
    if (linked.length === 0) {
      return base;
    }

    const profileEnv = readEnvelope(profile);
    const blockedOnProfile = new Set<string>();
    for (const detail of profileEnv?.details ?? []) {
      if (agentRuleOf(detail) === "never") {
        if (detail.attribute) {
          blockedOnProfile.add(detail.attribute);
        }
        if (detail.label) {
          blockedOnProfile.add(detail.label);
        }
      }
    }

    const identity = { ...base.identity };
    const custom = new Map(base.custom);
    let activeItemEnv: ReturnType<typeof readEnvelope> = null;
    const setIfEmpty = (key: string, rawVal: string | null | undefined) => {
      const val = (rawVal ?? "").trim();
      if (
        !key ||
        !val ||
        custom.get(key) ||
        blockedOnProfile.has(key) ||
        activeItemEnv?.details?.some(
          (d) => (d.attribute === key || d.label === key) && agentRuleOf(d) === "never",
        )
      ) {
        return;
      }
      custom.set(key, val);
    };
    const mergeLabeledText = (rawLabel: string, rawVal: string | null | undefined) => {
      const label = rawLabel.trim();
      const val = (rawVal ?? "").trim();
      if (!label || !val || label === VK_META_FIELD) {
        return;
      }
      if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/i.test(label)) {
        setIfEmpty(label, val);
      }
      if (typeof match_form_field === "function") {
        try {
          const matched = match_form_field({
            id: "linked",
            name: "",
            label,
            placeholder: "",
            autocomplete: "",
            input_type: "text",
            section: "",
            form: "",
            pattern: "",
            max_length: 0,
            format: "",
            op_ignore: false,
          });
          if (matched?.attribute && (matched.score ?? 0) >= 0.75) {
            setIfEmpty(matched.attribute, val);
          }
        } catch {
          // Ignore matcher failures on free-form note labels.
        }
      }
    };

    for (const item of linked) {
      activeItemEnv = readEnvelope(item);
      if (item.type === CipherType.Card && item.card != null) {
        setIfEmpty("card.holder", item.card.cardholderName);
        setIfEmpty("card.number", item.card.number);
        setIfEmpty("card.brand", item.card.brand);
        setIfEmpty("card.exp_month", item.card.expMonth);
        setIfEmpty("card.exp_year", item.card.expYear);
        if (item.card.expMonth && item.card.expYear) {
          setIfEmpty(
            "card.expiry",
            `${item.card.expMonth.trim().padStart(2, "0")}/${item.card.expYear.trim().slice(-2)}`,
          );
        }
        setIfEmpty("card.cvv", item.card.code);
      } else if (item.type === CipherType.Login && item.login != null) {
        const username = item.login.username?.trim() ?? "";
        if (username) {
          setIfEmpty("login.username", username);
          if (username.includes("@")) {
            if (!identity.email) {
              identity.email = username;
            }
            setIfEmpty("contact.email", username);
          }
        }
        const firstUri = item.login.uris?.find((u) => Boolean(u?.uri?.trim()))?.uri?.trim();
        if (firstUri) {
          setIfEmpty("contact.website", firstUri);
        }
      }
      for (const field of item.fields ?? []) {
        if (
          field.type === FieldType.Text &&
          field.name &&
          field.name !== VK_META_FIELD &&
          field.value
        ) {
          mergeLabeledText(field.name, field.value);
        }
      }
      if (item.notes) {
        for (const line of item.notes.split(/\r?\n/)) {
          const kv = /^([^:：]{1,48})[:：]\s*(.+)$/.exec(line.trim());
          if (kv != null) {
            mergeLabeledText(kv[1], kv[2]);
          }
        }
      }
    }

    return { identity, custom };
  }

  /** Associations resolve only their explicit accessible, confirmed profile. */
  async associatedProfile(item: CipherView): Promise<CipherView | null> {
    const id = profileRefOf(item);
    if (id == null) {
      return null;
    }
    const profile = (await this.profiles()).find((candidate) => candidate.id === id);
    return profileUsableForFill(profile) ? profile! : null;
  }

  private newProfile(read: Map<string, string>, file: File): CipherView {
    const latinGiven = read.get("name.given.latin")?.trim();
    const latinFamily = read.get("name.family.latin")?.trim();
    const given = read.get("name.given")?.trim();
    const family = read.get("name.family")?.trim();
    const profile = new CipherView();
    profile.type = CipherType.Identity;
    profile.edit = true;
    profile.identity = new IdentityView();
    profile.name =
      (latinGiven && latinFamily ? `${latinGiven} ${latinFamily}` : undefined) ??
      read.get("name.full.latin")?.trim() ??
      (given && family ? `${given} ${family}` : undefined) ??
      read.get("name.full")?.trim() ??
      latinGiven ??
      latinFamily ??
      given ??
      family ??
      file.name.replace(/\.[^.]+$/, "");
    return profile;
  }

  /** Fills a Word, Excel or Hangul form from a profile and saves the copy beside the original. */
  async fillForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const profileFields = await this.effectiveProfileFields(profile);
    const { extraAllowedDetails } = await this.effectiveRoleProfiles(profile, profileFields);
    const mergedDetails = new Map(profile_details(profileFields).details);
    for (const [k, v] of Object.entries(extraAllowedDetails)) {
      if (!mergedDetails.has(k) && v) {
        mergedDetails.set(k, v);
      }
    }
    if (!mergedDetails.get("emergency.name") && mergedDetails.get("spouse.name.full")) {
      mergedDetails.set("emergency.name", mergedDetails.get("spouse.name.full")!);
      if (mergedDetails.get("spouse.name.full.kana")) {
        mergedDetails.set("emergency.name.kana", mergedDetails.get("spouse.name.full.kana")!);
      }
      if (!mergedDetails.get("emergency.phone") && mergedDetails.get("spouse.contact.phone")) {
        mergedDetails.set("emergency.phone", mergedDetails.get("spouse.contact.phone")!);
      }
      if (!mergedDetails.get("emergency.relation")) {
        mergedDetails.set("emergency.relation", "Spouse");
      }
    }
    const details = { details: mergedDetails };
    const lower = file.name.toLowerCase();
    let outBytes = bytes;
    let filledCount = 0;
    let filledFields: FilledFieldSummary[] = [];
    let unfilledFields: UnfilledFieldSummary[] = [];
    let structuredOfficeForm = false;

    const decisionSettings =
      lower.endsWith(".docx") || lower.endsWith(".xlsx")
        ? await ipc.capture.decisionSettings()
        : null;
    const canAskSemanticOffice =
      (this.canUseCloudForFill() && typeof this.inference?.describe === "function") ||
      Boolean(decisionSettings?.local);
    if (lower.endsWith(".docx") || lower.endsWith(".xlsx")) {
      try {
        const extra = lower.endsWith(".docx")
          ? await this.describeAndFillRemainingDocx(
              file.name,
              bytes,
              profileFields,
              bytes,
              profile,
              canAskSemanticOffice,
            )
          : await this.describeAndFillRemainingXlsx(
              file.name,
              bytes,
              profileFields,
              bytes,
              profile,
              canAskSemanticOffice,
            );
        structuredOfficeForm = extra.filled > 0 || extra.unfilledFields.length > 0;
        outBytes = extra.bytes;
        filledCount = extra.filled;
        filledFields = extra.filledFields;
        unfilledFields = extra.unfilledFields;
      } catch {
        // Offline or ReadingServiceUnavailableError falls back cleanly to local office fill.
      }
    }
    if (!structuredOfficeForm) {
      const result = lower.endsWith(".docx")
        ? fill_docx_with_profile(bytes, details)
        : lower.endsWith(".xlsx")
          ? fill_xlsx_with_profile(bytes, details)
          : fill_hwpx_with_profile(bytes, details);
      outBytes = Uint8Array.from(result.bytes);
      filledCount = result.report.filled_count;
      filledFields = (result.report.entries ?? []).map((entry) => ({
        label: entry.label || entry.target,
        value: entry.value,
        ...(entry.owner && entry.owner !== "applicant" ? { closeCall: entry.owner } : {}),
      }));
    }

    const sourcePath = this.sourcePathOf(file);
    this._lastFillBreakdown = {
      filledFields,
      unfilledFields,
      savedToDownloads: !sourcePath,
    };

    if (filledCount === 0) {
      return { path: null, filled: 0 };
    }
    const path = await ipc.capture.saveCopy({
      sourcePath,
      name: file.name,
      bytes: outBytes,
    });
    return { path, filled: filledCount };
  }

  private async effectiveRoleProfiles(
    primary: CipherView,
    primaryFields: ProfileFields,
  ): Promise<{
    profiles?: Map<string, ProfileFields>;
    extraAllowedDetails: Record<string, string>;
  }> {
    const extraAllowedDetails: Record<string, string> = {};
    let allProfiles: CipherView[] = [];
    try {
      allProfiles = await this.profiles();
    } catch {
      return { extraAllowedDetails };
    }
    const siblings = allProfiles.filter(
      (p) => p != null && p.id && p.id !== primary.id && profileUsableForFill(p),
    );
    if (siblings.length === 0) {
      return { extraAllowedDetails };
    }
    const profiles = new Map<string, ProfileFields>([["applicant", primaryFields]]);
    let depIdx = 0;
    let memberIdx = 0;
    const recordAllowed = (rolePrefix: string, cipher: CipherView, pf: ProfileFields) => {
      const env = readEnvelope(cipher);
      const blocked = new Set<string>();
      for (const d of env?.details ?? []) {
        if (agentRuleOf(d) === "never" && d.attribute) {
          blocked.add(d.attribute);
        }
      }
      for (const [k, v] of profile_details(pf).details.entries()) {
        const base = k.replace(/\.(?:latin|kana|hiragana|kanji|hangul|wareki|zengin)$/, "");
        if (!blocked.has(k) && !blocked.has(base) && v.trim()) {
          const prefixed = `${rolePrefix}.${k}`;
          if (!extraAllowedDetails[prefixed]) {
            extraAllowedDetails[prefixed] = v.trim();
          }
        }
      }
    };

    for (const member of siblings) {
      const pf = await this.effectiveProfileFields(member);
      const rel = (readEnvelope(member)?.relationship ?? "").trim().toLowerCase();
      memberIdx++;
      const hmRole = `household_member.${memberIdx}`;
      if (!profiles.has(hmRole)) {
        profiles.set(hmRole, pf);
      }
      if (rel === "spouse" || rel === "partner" || rel === "wife" || rel === "husband") {
        if (!profiles.has("spouse")) {
          profiles.set("spouse", pf);
          recordAllowed("spouse", member, pf);
        }
      } else if (rel === "child" || rel === "dependent" || rel === "son" || rel === "daughter") {
        depIdx++;
        const depRole = depIdx === 1 ? "dependent" : `dependent.${depIdx}`;
        profiles.set(depRole, pf);
        recordAllowed(depRole, member, pf);
      } else if (rel === "parent" || rel === "father" || rel === "mother") {
        if (!profiles.has("parent")) {
          profiles.set("parent", pf);
          recordAllowed("parent", member, pf);
        }
      } else if (rel === "guardian") {
        if (!profiles.has("guardian")) {
          profiles.set("guardian", pf);
          recordAllowed("guardian", member, pf);
        }
      } else if (rel === "household_head" || rel === "head") {
        if (!profiles.has("household_head")) {
          profiles.set("household_head", pf);
          recordAllowed("household_head", member, pf);
        }
      } else {
        recordAllowed(hmRole, member, pf);
      }
    }
    return { profiles: profiles.size > 1 ? profiles : undefined, extraAllowedDetails };
  }

  private async decodeImageLuma(
    bytes: Uint8Array,
  ): Promise<{ gray: Uint8Array; width: number; height: number } | null> {
    if (
      bytes.length < 32 ||
      typeof createImageBitmap !== "function" ||
      typeof document === "undefined"
    ) {
      return null;
    }
    try {
      const bitmap = await createImageBitmap(new Blob([bytes.slice()]));
      const width = bitmap.width;
      const height = bitmap.height;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (ctx == null) {
        bitmap.close?.();
        return null;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
        gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
      }
      return { gray, width, height };
    } catch {
      return null;
    }
  }

  /** Fills a PDF or photographed paper form from a profile and saves the copy beside the original. */
  async fillPdfForm(
    file: File,
    bytes: Uint8Array,
    profile: CipherView,
  ): Promise<{ path: string | null; filled: number }> {
    const isImage = IMAGE_FILE.test(file.name);
    const willPlanImageFill =
      isImage && this.canUseCloudForFill() && typeof this.inference?.planImageFill === "function";

    const profileFields = await this.effectiveProfileFields(profile);
    const { profiles: roleProfiles, extraAllowedDetails } = await this.effectiveRoleProfiles(
      profile,
      profileFields,
    );
    const fillProfiles = new Map<string, Map<string, string>>();
    if (roleProfiles) {
      for (const [owner, fields] of roleProfiles) {
        fillProfiles.set(owner, profile_details(fields).details);
      }
    } else {
      fillProfiles.set("applicant", profile_details(profileFields).details);
    }

    const snapFn = (
      sdk as {
        snap_image_fill_boxes?: (
          luma: Uint8Array,
          w: number,
          h: number,
          pieces: string,
          planned: string,
          page: number,
        ) => string;
      }
    ).snap_image_fill_boxes;

    const planImageTask: Promise<{
      planned: { fields: PlannedImageFillField[] };
      luma: { gray: Uint8Array; width: number; height: number } | null;
      rawPieces: {
        text?: string;
        x?: number;
        y?: number;
        w?: number;
        h?: number;
        locator?: { x?: number; y?: number; w?: number; h?: number };
      }[];
    } | null> = willPlanImageFill
      ? (async () => {
          try {
            const env = readEnvelope(profile);
            const blockedAttrs = new Set<string>();
            for (const d of env?.details ?? []) {
              const rule = agentRuleOf(d);
              if (rule === "never" && d.attribute) {
                blockedAttrs.add(d.attribute);
              }
            }
            const detailsMap = profile_details(profileFields).details;
            const allowedDetails: Record<string, string> = { ...extraAllowedDetails };
            for (const [k, v] of detailsMap.entries()) {
              const base = k.replace(/\.(?:latin|kana|hiragana|kanji|hangul|wareki|zengin)$/, "");
              if (!blockedAttrs.has(k) && !blockedAttrs.has(base) && v.trim()) {
                allowedDetails[k] = v.trim();
              }
            }
            const lumaPromise = this.decodeImageLuma(bytes);
            const piecesPromise: Promise<unknown[]> =
              typeof snapFn === "function"
                ? this.readPiecesString(file, bytes)
                    .then((raw): unknown[] => JSON.parse(raw)?.pages?.[0]?.pieces ?? [])
                    .catch((): unknown[] => [])
                : Promise.resolve([]);
            const rendered = await this.imageDataUrlFor(file, bytes, 1280, 0.82);
            if (rendered == null) {
              return null;
            }
            let cacheKey: string | null = null;
            const deniedSig = [...blockedAttrs].sort().join(",");
            if (bytes.byteLength >= 256 && profile.id) {
              const fileHash = await checksum(bytes);
              const detailsSig = await requestHash(allowedDetails);
              cacheKey = `${fileHash}:${profile.id}:${detailsSig}:${deniedSig}`;
            }
            let planPromise = cacheKey ? this.imageFillPlanCache.get(cacheKey) : undefined;
            if (planPromise == null && cacheKey) {
              const stored = await this.storedImagePlan(cacheKey);
              if (stored) {
                planPromise = Promise.resolve(stored);
                this.imageFillPlanCache.set(cacheKey, planPromise);
              }
            }
            if (planPromise == null) {
              const callPlan = this.inference.planImageFill(rendered.dataUrl, allowedDetails, file.name);
              if (cacheKey) {
                if (this.imageFillPlanCache.size >= 12) {
                  const oldest = this.imageFillPlanCache.keys().next().value;
                  if (oldest != null) {
                    this.imageFillPlanCache.delete(oldest);
                  }
                }
                const key = cacheKey;
                const guarded = callPlan
                  .then(async (planned) => {
                    await this.storeImagePlan(key, planned);
                    return planned;
                  })
                  .catch((err) => {
                    this.imageFillPlanCache.delete(key);
                    throw err;
                  });
                this.imageFillPlanCache.set(cacheKey, guarded);
                planPromise = guarded;
              } else {
                planPromise = callPlan;
              }
            }
            const [planned, luma, rawPieces] = await Promise.all([
              planPromise,
              lumaPromise,
              piecesPromise,
            ]);
            return { planned, luma: planned.fields.length > 0 ? luma : null, rawPieces };
          } catch {
            return null;
          }
        })()
      : Promise.resolve(null);

    const localFormTask = (async () => {
      const fields = (await ipc.capture.readPdfForm(bytes, file.name)).filter(
        (field) =>
          field.type === "text" || field.type === "select-one" || field.type === "checkbox",
      );
      const inputs = fields.map(pdfFieldInput);
      let { matches } = fill_form_with_profiles({
        fields: inputs,
        profiles: fillProfiles,
        explicit_fill: true,
      });
      const fullyBound = matches.length > 0 && matches.every((match) => match.score >= 10);

      // On pure photographed paper forms where 2D vision planning is already running in parallel,
      // non-comb/cell 1D guesses are superseded by 2D boxes, so only resolve structured comb/cell slots.
      const pureVisualImageForm =
        willPlanImageFill && fields.length >= 5 && fields.every((f) => f.key.startsWith("box:"));
      const skipSemanticPdfInference =
        fullyBound ||
        (!this.aiFillOverride &&
          matches.length > 0 &&
          matches.every(
            (match) => match.score >= CONFIDENT_LOCAL_SCORE && Boolean(match.value?.trim()),
          ));
      const decisionSettings =
        inputs.length > 0 && !pureVisualImageForm && !skipSemanticPdfInference
          ? await ipc.capture.decisionSettings()
          : null;
      if (
        !pureVisualImageForm &&
        !skipSemanticPdfInference &&
        (this.canUseCloudForFill() || Boolean(decisionSettings?.local)) &&
        inputs.length > 0
      ) {
        const choices = await this.semanticChoicesFor(
          file.name,
          fields,
          inputs,
          matches,
          profile,
          profileFields,
        );
        if (choices.length > 0 || inputs.some((input) => input.format !== "")) {
          matches = fill_form_with_profiles({
            fields: inputs,
            profiles: fillProfiles,
            explicit_fill: true,
            choices,
          }).matches;
        }
      }
      return { fields, matches };
    })();

    const [{ fields, matches }, visionOutcome] = await Promise.all([localFormTask, planImageTask]);

    const values: Record<string, string> = {};
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const seenUnfilled = new Set<string>();

    matches.forEach((match, index) => {
      const field = fields[index];
      const displayLabel = (field.label || field.tooltip || field.name || field.key).trim();
      let value = match.value?.trim();
      if (value) {
        if (field.type === "select-one") {
          value = resolveSelectOption(value, field.options);
        } else if (field.type === "checkbox") {
          value = matchesCheckboxChoice(value, field) ? "true" : undefined;
        } else if (field.maxLength > 0) {
          value = value.slice(0, field.maxLength);
        }
      }
      if (value) {
        values[field.key] = value;
        const closeCall =
          match.owner && match.owner !== "applicant"
            ? match.owner
            : match.score > 0 && match.score < CONFIDENT_LOCAL_SCORE
              ? detail_label(match.attribute)
              : undefined;
        filledFields.push({
          label: displayLabel,
          value: field.type === "checkbox" && value === "true" ? "✓" : value,
          ...(closeCall ? { closeCall } : {}),
        });
      } else if (
        field.type !== "checkbox" &&
        match.owner !== "official_only" &&
        displayLabel &&
        !OPAQUE_NAME.test(displayLabel) &&
        !seenUnfilled.has(displayLabel)
      ) {
        seenUnfilled.add(displayLabel);
        unfilledFields.push({ label: displayLabel });
      }
    });

    if (visionOutcome != null) {
      const { planned, luma, rawPieces } = visionOutcome;
      let plannedFields = planned.fields;
      if (luma != null && typeof snapFn === "function") {
        try {
          let ocrPiecesJson = "[]";
          try {
            ocrPiecesJson = JSON.stringify(
              rawPieces
                .map((p) => {
                  const left = p.x ?? p.locator?.x;
                  const top = p.y ?? p.locator?.y;
                  const width = p.w ?? p.locator?.w;
                  const height = p.h ?? p.locator?.h;
                  return p.text &&
                    left != null &&
                    top != null &&
                    width != null &&
                    height != null
                    ? { text: p.text, left, top, width, height }
                    : null;
                })
                .filter((p: unknown) => p != null),
            );
          } catch {
            ocrPiecesJson = "[]";
          }
          const snappedJson = snapFn(
            luma.gray,
            luma.width,
            luma.height,
            ocrPiecesJson,
            JSON.stringify(planned.fields.map((f) => ({ ...f, key: f.sourceKey }))),
            0,
          );
          const parsedSnapped = JSON.parse(snappedJson);
          if (Array.isArray(parsedSnapped)) {
            plannedFields = parsedSnapped.map((s, idx) => ({
              ...planned.fields[idx],
              ...s,
              sourceKey: s.key || planned.fields[idx]?.sourceKey || "",
            }));
          }
        } catch {
          // Keep raw VLM boxes when pixel-level snap cannot run.
        }
      }
      if (plannedFields.length >= 5) {
        // A complete image plan replaces inferred cells too: ruled paper boxes are not
        // authenticated widgets and can belong to another person or a section heading.
        for (const existingKey of Object.keys(values)) {
          if (existingKey.startsWith("box:")) {
            delete values[existingKey];
          }
        }
        filledFields.length = 0;
      }
      const existingEntries = Object.keys(values)
        .map((key) => {
          const p = key.split(":");
          return p.length >= 6 && p[0] === "box"
            ? { key, x: Number(p[2]), y: Number(p[3]), w: Number(p[4]), h: Number(p[5]) }
            : null;
        })
        .filter(
          (r): r is { key: string; x: number; y: number; w: number; h: number } => r != null,
        );

      for (const pf of plannedFields) {
        const [bx, top, bw, bh] = pf.box;
        const bottomY = Math.max(0, Math.min(1, 1 - top - bh));
        const overlapping = existingEntries.filter((er) => {
          const ix = Math.max(0, Math.min(bx + bw, er.x + er.w) - Math.max(bx, er.x));
          const iy = Math.max(0, Math.min(bottomY + bh, er.y + er.h) - Math.max(bottomY, er.y));
          const inter = ix * iy;
          if (inter <= 0) {
            return false;
          }
          const minArea = Math.max(1e-6, Math.min(bw * bh, er.w * er.h));
          return inter / minArea >= 0.25;
        });
        // Keep pixel-exact `:comb:` / `:cell` boxes when already matched; replace plain 1D guesses.
        if (overlapping.some((er) => er.key.includes(":comb:") || er.key.endsWith(":cell"))) {
          continue;
        }
        for (const er of overlapping) {
          delete values[er.key];
        }
        let key = `box:0:${bx.toFixed(4)}:${bottomY.toFixed(4)}:${bw.toFixed(4)}:${bh.toFixed(4)}`;
        let val = pf.value;
        if (pf.action === "circle") {
          key += ":circle";
        } else if (pf.action === "check") {
          key += ":check";
          val = "✓";
        } else if (pf.comb && pf.comb >= 2) {
          key += luma != null ? `:vlm:comb:${pf.comb}` : `:comb:${pf.comb}`;
        } else if (luma != null) {
          key += ":vlm";
        }
        values[key] = val;
        existingEntries.push({ key, x: bx, y: bottomY, w: bw, h: bh });
        const lbl = (pf.label || detail_label(pf.sourceKey) || pf.sourceKey).trim();
        filledFields.push({ label: lbl, value: val });
        const uIdx = unfilledFields.findIndex(
          (u) => u.label.toLowerCase() === lbl.toLowerCase(),
        );
        if (uIdx >= 0) {
          unfilledFields.splice(uIdx, 1);
        }
      }
    }

    const sourcePath = this.sourcePathOf(file);
    this._lastFillBreakdown = {
      filledFields,
      unfilledFields,
      savedToDownloads: !sourcePath,
    };

    if (Object.keys(values).length === 0) {
      return { path: null, filled: 0 };
    }
    const filledResult = await ipc.capture.fillPdfForm({
      sourcePath,
      name: file.name,
      bytes,
      values,
    });
    const previewUrl = await this.renderFilledPreview(file.name, filledResult.bytes);
    if (previewUrl && this._lastFillBreakdown) {
      this._lastFillBreakdown = { ...this._lastFillBreakdown, previewUrl };
    }
    return { path: filledResult.path, filled: filledResult.filled };
  }

  private async renderFilledPreview(
    fileName: string,
    filledBytes?: Uint8Array,
  ): Promise<string | undefined> {
    if (!filledBytes || filledBytes.byteLength === 0) {
      return undefined;
    }
    if (IMAGE_FILE.test(fileName)) {
      const ext = fileName.toLowerCase();
      const mime = ext.endsWith(".jpg") || ext.endsWith(".jpeg") ? "image/jpeg" : "image/png";
      return `data:${mime};base64,${Utils.fromBufferToB64(filledBytes)}`;
    }
    if (/\.pdf$/i.test(fileName) && typeof document !== "undefined") {
      try {
        const pdfjs = await import("pdfjs-dist");
        const doc = await pdfjs.getDocument({ data: filledBytes.slice() }).promise;
        if (doc.numPages <= 0) {
          return undefined;
        }
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (ctx == null) {
          return undefined;
        }
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise;
        return canvas.toDataURL("image/jpeg", 0.86);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private async semanticChoicesFor(
    fileName: string,
    rawFields: PdfFormField[],
    inputs: ReturnType<typeof pdfFieldInput>[],
    localMatches: FieldMatch[],
    profile: CipherView,
    effectiveFields?: ProfileFields,
  ): Promise<ChosenField[]> {
    const byIndex = new Map<number, ChosenField>();
    const explicitNoneIndices = new Set<number>();

    // A field the local matcher already filled with confidence is not asked about again, and
    // neither is one the describe call has just resolved.
    const unresolvedIndexes = inputs
      .map((_, index) => index)
      .filter((index) => {
        const local = localMatches[index];
        return (
          local == null ||
          local.score < CONFIDENT_LOCAL_SCORE ||
          !local.attribute ||
          !local.value?.trim()
        );
      });

    if (
      this.canUseCloudForFill() &&
      unresolvedIndexes.length > 0 &&
      typeof this.inference?.describe === "function"
    ) {
      try {
        const described = await this.describeFormInputs(
          fileName, rawFields, inputs, unresolvedIndexes,
          [...profile_details(effectiveFields ?? await this.effectiveProfileFields(profile)).details.keys()],
        );
        for (const item of described) {
          if (item.format) {
            inputs[item.index].format ||= item.format;
          }
          if (!inputs[item.index].section && item.whose !== "applicant") {
            inputs[item.index].section = item.whose;
          }
          const id = inputs[item.index].id;
          if (item.whose === "official_only") {
            byIndex.set(item.index, { id, attribute: "", owner: "official_only" });
          } else if (item.explicitNone) {
            explicitNoneIndices.add(item.index);
            byIndex.set(item.index, { id, attribute: "", owner: item.whose });
          } else if (item.whose !== "applicant" && item.whose !== "employer") {
            byIndex.set(item.index, {
              id,
              attribute: isPersonScopedAttribute(item.detail) ? item.detail : "",
              owner: item.whose,
            });
          } else if (item.detail) {
            byIndex.set(item.index, {
              id,
              attribute: item.detail,
              owner: item.whose,
            });
          }
        }
      } catch {
        // Offline or ReadingServiceUnavailableError falls back to Decision or local matching.
      }
    }

    try {
      const askIndexes = unresolvedIndexes.filter((index) => !byIndex.has(index));
      const askInputs = askIndexes.map((index) => inputs[index]);
      const askIndexById = new Map(askIndexes.map((index) => [inputs[index].id, index] as const));
      const decisionChoices =
        askInputs.length === 0 ? [] : await this.choicesFor(askInputs, profile, effectiveFields);
      for (const choice of decisionChoices) {
        const idx = askIndexById.get(choice.id);
        if (idx == null || explicitNoneIndices.has(idx)) {
          continue;
        }
        if (choice.attribute || (choice.owner && choice.owner !== "applicant")) {
          byIndex.set(idx, {
            id: inputs[idx].id,
            attribute: choice.attribute,
            owner: choice.owner || "applicant",
          });
        }
      }
    } catch {
      // Offline or ReadingServiceUnavailableError keeps local / described matches.
    }

    return [...byIndex.values()];
  }

  private async describeFormInputs(
    fileName: string,
    rawFields: PdfFormField[],
    inputs: ReturnType<typeof pdfFieldInput>[],
    askIndexes: number[],
    heldAttributes: readonly string[] = [],
  ): Promise<
    { index: number; detail: string; whose: string; format: string; explicitNone: boolean }[]
  > {
    const CHUNK_SIZE = 75;
    const out: {
      index: number;
      detail: string;
      whose: string;
      format: string;
      explicitNone: boolean;
    }[] = [];
    // Independent chunks are described concurrently; a slow chunk does not hold the rest back.
    const chunks: number[][] = [];
    for (let i = 0; i < askIndexes.length; i += CHUNK_SIZE) {
      chunks.push(askIndexes.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(
      chunks.map(async (chunk, chunkIndex) => {
        try {
          const sectionIds = new Map<string, string>([["", "main"]]);
          const sections: { id: string; label: string }[] = [{ id: "main", label: fileName }];
          for (const index of chunk) {
            const sec = inputs[index].section.trim();
            if (sec && !sectionIds.has(sec)) {
              const secId = `sec_${sections.length}`;
              sectionIds.set(sec, secId);
              sections.push({ id: secId, label: sec });
            }
          }
          const agentFields = chunk.map((index) => ({
            id: `f_${index}`,
            sectionId: sectionIds.get(inputs[index].section.trim()) ?? "main",
            label: inputs[index].label,
            type: inputs[index].input_type,
            options: (rawFields[index]?.options ?? []).slice(0, 350),
            ...(inputs[index].format ? { format: inputs[index].format } : {}),
          }));
          const signatureSource = JSON.stringify(
            agentFields.map((f) => [f.id, f.sectionId, f.label, f.type, f.options]),
          );
          const formSignature = fnv1aHex(signatureSource);
          const target: AgentTarget = {
            targetId: `file:${fileName}:${chunkIndex}`,
            kind: "file",
            destinationKey: `file:${fileName}`,
            generation: "1",
            display: fileName,
            formSignature,
            sections,
            fields: agentFields,
          };
          const asks = await this.inference.describe(target);
          for (const ask of asks.fields) {
            const idx = Number(ask.id.replace(/^f_/, ""));
            if (!Number.isInteger(idx) || idx < 0 || idx >= inputs.length) {
              continue;
            }
            const rawDetail = (ask.attribute ?? ask.what ?? "").trim();
            const explicitNone = rawDetail === "none";
            const detail =
              explicitNone || rawDetail === "unknown" || !rawDetail.includes(".")
                ? ""
                : rawDetail;
            const whose = normalizeWhose(ask.owner ?? ask.whose);
            const format = ask.format?.label?.trim() ?? "";
            if (!detail && !explicitNone && whose === "applicant" && !format) {
              continue;
            }
            out.push({
              index: idx,
              detail,
              whose,
              format,
              explicitNone,
            });
          }
        } catch {
          // A chunk the service cannot read keeps the other chunks; it falls back locally.
        }
      }),
    );
    const held = new Set(heldAttributes);
    const unresolved = out.filter((item) =>
      item.whose === "applicant" && (item.explicitNone || !held.has(item.detail)),
    );
    if (held.size > 0 && unresolved.length > 0) {
      try {
        const chosen = await chooseHeldAttributes(
          unresolved.map(({ index }) => ({
            id: `f_${index}`, label: inputs[index].label,
            section: inputs[index].section, format: inputs[index].format,
          })),
          heldAttributes,
          (request) => this.decide(request as DecisionRequest),
        );
        for (const item of unresolved) {
          const attribute = chosen.get(`f_${item.index}`);
          if (attribute) {
            item.detail = attribute;
            item.explicitNone = false;
          }
        }
      } catch {
        // A missing decision leaves only the unresolved fields empty.
      }
    }
    return out;
  }

  private async describeAndFillRemainingDocx(
    fileName: string,
    docxBytes: Uint8Array,
    profileFields: ReturnType<typeof profileFieldsOf>,
    origDocxBytes?: Uint8Array,
    profile?: CipherView,
    allowSemanticAsk = true,
  ): Promise<{
    bytes: Uint8Array;
    filled: number;
    filledFields: FilledFieldSummary[];
    unfilledFields: UnfilledFieldSummary[];
  }> {
    const zip = await new JSZip().loadAsync(docxBytes);
    const docEntry = zip.file("word/document.xml");
    if (docEntry == null) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const xml = await docEntry.async("string");
    let origXmlDoc = xml;
    if (origDocxBytes != null) {
      const origZip = await new JSZip().loadAsync(origDocxBytes);
      const origDoc = origZip.file("word/document.xml");
      if (origDoc != null) {
        origXmlDoc = await origDoc.async("string");
      }
    }
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const extractText = (fragment: string) => {
      let out = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(fragment)) != null) {
        out += xmlUnescape(m[1]);
      }
      return out.trim();
    };
    const parseRows = (sourceXml: string) => {
      const parsed: {
        start: number;
        end: number;
        xml: string;
        cells: { start: number; end: number; xml: string; text: string }[];
      }[] = [];
      let rm: RegExpExecArray | null;
      rowRe.lastIndex = 0;
      while ((rm = rowRe.exec(sourceXml)) != null) {
        const rXml = rm[0];
        const cells: { start: number; end: number; xml: string; text: string }[] = [];
        let cm: RegExpExecArray | null;
        cellRe.lastIndex = 0;
        while ((cm = cellRe.exec(rXml)) != null) {
          cells.push({
            start: cm.index,
            end: cm.index + cm[0].length,
            xml: cm[0],
            text: extractText(cm[0]),
          });
        }
        parsed.push({ start: rm.index, end: rm.index + rXml.length, xml: rXml, cells });
      }
      return parsed;
    };

    const rows = parseRows(xml);
    const origRows = origXmlDoc === xml ? rows : parseRows(origXmlDoc);

    const candidates: { rowIdx: number; cellIdx: number; label: string; format: string }[] = [];
    const seenCells = new Set<string>();
    rows.forEach((row, rIdx) => {
      row.cells.forEach((cell, cIdx) => {
        const original = origRows[rIdx]?.cells[cIdx] ?? cell;
        const paragraphs = original.xml.match(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g) ?? [];
        const parts = paragraphs.map(extractText).filter(Boolean);
        const origLabel = parts[0] ?? original.text;
        const format = parts.slice(1).join(" ");
        if (!origLabel || origLabel.length > 120) {
          return;
        }
        if (cIdx + 1 < row.cells.length && row.cells[cIdx + 1].text === "") {
          const key = `${rIdx}:${cIdx + 1}`;
          if (!seenCells.has(key)) {
            seenCells.add(key);
            candidates.push({ rowIdx: rIdx, cellIdx: cIdx + 1, label: origLabel, format });
          }
        } else if (
          rIdx + 1 < rows.length &&
          cIdx < rows[rIdx + 1].cells.length &&
          rows[rIdx + 1].cells[cIdx].text === ""
        ) {
          const key = `${rIdx + 1}:${cIdx}`;
          if (!seenCells.has(key)) {
            seenCells.add(key);
            candidates.push({ rowIdx: rIdx + 1, cellIdx: cIdx, label: origLabel, format });
          }
        }
      });
    });

    if (candidates.length === 0) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const rawFields: PdfFormField[] = candidates.map((c, idx): PdfFormField => ({
      key: `docx_${idx}`,
      name: "",
      tooltip: "",
      label: c.label,
      type: "text",
      maxLength: 0,
      options: [],
    }));
    const inputs = rawFields.map((field, index) => ({
      ...pdfFieldInput(field), format: candidates[index].format,
    }));
    let { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFields,
      explicit_fill: true,
      choices: [],
    });
    const unresolvedIndexes = inputs
      .map((_, index) => index)
      .filter((index) => {
        const local = matches[index];
        return (
          local == null ||
          local.score < CONFIDENT_LOCAL_SCORE ||
          !local.attribute ||
          !local.value?.trim()
        );
      });
    if (allowSemanticAsk && unresolvedIndexes.length > 0) {
      const choices: ChosenField[] = [];
      if (this.canUseCloudForFill() && typeof this.inference?.describe === "function") {
        const described = await this.describeFormInputs(
          fileName,
          rawFields,
          inputs,
          unresolvedIndexes,
          [...profile_details(profileFields).details.keys()],
        );
        for (const item of described) {
          if (item.format) {
            inputs[item.index].format ||= item.format;
          }
          const attr =
            item.whose === "official_only"
              ? ""
              : item.whose !== "applicant" &&
                  item.whose !== "employer" &&
                  !isPersonScopedAttribute(item.detail)
                ? ""
                : item.detail;
          choices.push({ id: inputs[item.index].id, attribute: attr, owner: item.whose });
        }
      } else if (profile != null) {
        const askInputs = unresolvedIndexes.map((idx) => inputs[idx]);
        choices.push(...(await this.choicesFor(askInputs, profile, profileFields)));
      }
      if (choices.length > 0 || inputs.some((inp) => inp.format !== "")) {
        matches = fill_fields_from_profile({
          fields: inputs,
          profile: profileFields,
          explicit_fill: true,
          choices,
        }).matches;
      }
    }

    const replacements = new Map<string, string>();
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const eaFont = eastAsianFontName();
    matches.forEach((match, idx) => {
      const target = candidates[idx];
      const val = match.value?.trim();
      if (!val) {
        if (match.owner !== "official_only") {
          unfilledFields.push({ label: target.label });
        }
        return;
      }
      const origXml = rows[target.rowIdx].cells[target.cellIdx].xml;
      const hasEastAsian = Array.from(val).some((ch) => (ch.codePointAt(0) ?? 0) >= 0x3000);
      const rPr = hasEastAsian
        ? `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="${eaFont}"/></w:rPr>`
        : "";
      const run = `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(val)}</w:t></w:r>`;
      const injected = origXml.includes("</w:p>")
        ? origXml.replace(/<\/w:p>/, `${run}</w:p>`)
        : origXml.replace(/<\/w:tc>$/, `<w:p>${run}</w:p></w:tc>`);
      replacements.set(`${target.rowIdx}:${target.cellIdx}`, injected);
      filledFields.push({ label: target.label, value: val });
    });
    if (replacements.size === 0) {
      return { bytes: docxBytes, filled: 0, filledFields: [], unfilledFields };
    }

    let rebuilt = "";
    let lastPos = 0;
    rows.forEach((row, rIdx) => {
      rebuilt += xml.slice(lastPos, row.start);
      let rowOut = "";
      let cellLast = 0;
      row.cells.forEach((cell, cIdx) => {
        rowOut += row.xml.slice(cellLast, cell.start);
        rowOut += replacements.get(`${rIdx}:${cIdx}`) ?? cell.xml;
        cellLast = cell.end;
      });
      rowOut += row.xml.slice(cellLast);
      rebuilt += rowOut;
      lastPos = row.end;
    });
    rebuilt += xml.slice(lastPos);
    zip.file("word/document.xml", rebuilt);
    return {
      bytes: await zip.generateAsync({ type: "uint8array" }),
      filled: replacements.size,
      filledFields,
      unfilledFields,
    };
  }

  private async describeAndFillRemainingXlsx(
    fileName: string,
    xlsxBytes: Uint8Array,
    profileFields: ReturnType<typeof profileFieldsOf>,
    origXlsxBytes?: Uint8Array,
    profile?: CipherView,
    allowSemanticAsk = true,
  ): Promise<{
    bytes: Uint8Array;
    filled: number;
    filledFields: FilledFieldSummary[];
    unfilledFields: UnfilledFieldSummary[];
  }> {
    const zip = await new JSZip().loadAsync(xlsxBytes);
    const sharedEntry = zip.file("xl/sharedStrings.xml");
    const sharedStrings: string[] = [];
    if (sharedEntry != null) {
      const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let sm: RegExpExecArray | null;
      while ((sm = siRe.exec(sXml)) != null) {
        let txt = "";
        let tm: RegExpExecArray | null;
        tRe.lastIndex = 0;
        while ((tm = tRe.exec(sm[1])) != null) {
          txt += xmlUnescape(tm[1]);
        }
        sharedStrings.push(txt.trim());
      }
    }

    const shadedStyles = new Set<string>();
    const stylesEntry = zip.file("xl/styles.xml");
    if (stylesEntry != null) {
      const stylesXml = await stylesEntry.async("string");
      const shadedFills = new Set<number>();
      const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g;
      let fm: RegExpExecArray | null;
      let fIdx = 0;
      while ((fm = fillRe.exec(stylesXml)) != null) {
        const body = fm[1] ?? "";
        if (body.includes('patternType="solid"')) {
          const rgbMatch = /<fgColor\b[^>]*\brgb="([0-9A-Fa-f]{6,8})"/.exec(body);
          const hex = rgbMatch?.[1]?.toUpperCase() ?? "";
          const rgb6 = hex.length === 8 ? hex.slice(2) : hex;
          if (body.includes('tint="-') || (rgb6 !== "" && rgb6 !== "FFFFFF")) {
            shadedFills.add(fIdx);
          }
        }
        fIdx++;
      }
      const xfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
      if (xfsMatch != null) {
        const xfRe = /<xf\b([^>]*)(?:\/>|>[\s\S]*?<\/xf>)/g;
        let xm: RegExpExecArray | null;
        let sIdx = 0;
        while ((xm = xfRe.exec(xfsMatch[1])) != null) {
          const fidMatch = /\bfillId="(\d+)"/.exec(xm[1] ?? "");
          if (fidMatch != null && shadedFills.has(Number(fidMatch[1]))) {
            shadedStyles.add(String(sIdx));
          }
          sIdx++;
        }
      }
    }

    const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
    if (sheetEntry == null) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }
    const sheetXml = await sheetEntry.async("string");
    let origSheetXml = sheetXml;
    if (origXlsxBytes != null) {
      const origZip = await new JSZip().loadAsync(origXlsxBytes);
      const origSheet = origZip.file("xl/worksheets/sheet1.xml");
      if (origSheet != null) {
        origSheetXml = await origSheet.async("string");
      }
    }

    const colToIdx = (col: string) => {
      let n = 0;
      for (let i = 0; i < col.length; i++) {
        n = n * 26 + (col.charCodeAt(i) - 64);
      }
      return n;
    };
    const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
    const parseSheetCells = (xmlStr: string) => {
      const list: {
        start: number;
        end: number;
        attrs: string;
        col: string;
        colNum: number;
        row: string;
        rowNum: number;
        style: string;
        text: string;
        raw: string;
      }[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(xmlStr)) != null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
        if (refMatch == null) {
          continue;
        }
        const styleMatch = /\bs="(\d+)"/.exec(attrs);
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        let text = "";
        if (typeMatch?.[1] === "s" && valMatch != null) {
          text = sharedStrings[Number(valMatch[1])] ?? "";
        } else if (inlineMatch != null) {
          text = xmlUnescape(inlineMatch[1]).trim();
        } else if (valMatch != null) {
          text = xmlUnescape(valMatch[1]).trim();
        }
        list.push({
          start: cm.index,
          end: cm.index + cm[0].length,
          attrs,
          col: refMatch[1],
          colNum: colToIdx(refMatch[1]),
          row: refMatch[2],
          rowNum: Number(refMatch[2]),
          style: styleMatch?.[1] ?? "",
          text,
          raw: cm[0],
        });
      }
      return list;
    };

    const cells = parseSheetCells(sheetXml);
    const origCells = origSheetXml === sheetXml ? cells : parseSheetCells(origSheetXml);
    const origLabelMap = new Map<string, string>();
    for (const c of origCells) {
      if (c.text !== "") {
        origLabelMap.set(`${c.colNum}:${c.rowNum}`, c.text);
      }
    }

    type XlsxCandidate =
      | { kind: "cell"; cellIdx: number; label: string }
      | { kind: "drawing"; boxIdx: number; label: string };
    const candidates: XlsxCandidate[] = [];

    for (let i = 0; i < cells.length - 1; i++) {
      const cur = cells[i];
      const next = cells[i + 1];
      const origLabel = origLabelMap.get(`${cur.colNum}:${cur.rowNum}`) ?? "";
      const bothShaded = shadedStyles.has(cur.style) && shadedStyles.has(next.style);
      if (
        !bothShaded &&
        cur.row === next.row &&
        origLabel !== "" &&
        origLabel.length <= 120 &&
        next.text === ""
      ) {
        candidates.push({ kind: "cell", cellIdx: i + 1, label: origLabel });
      }
    }

    const drawingEntry = zip.file("xl/drawings/drawing1.xml");
    let drawingXml = "";
    const drawingBlocks: { start: number; end: number; raw: string }[] = [];
    if (drawingEntry != null) {
      drawingXml = await drawingEntry.async("string");
      const ancRe = /<xdr:(?:twoCellAnchor|oneCellAnchor)\b[^>]*>[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g;
      let am: RegExpExecArray | null;
      while ((am = ancRe.exec(drawingXml)) != null) {
        const block = am[0];
        const bIdx = drawingBlocks.length;
        drawingBlocks.push({ start: am.index, end: am.index + block.length, raw: block });
        if (!block.includes("<xdr:sp") || !block.includes("<xdr:txBody>")) {
          continue;
        }
        const isWhite =
          block.includes('txBox="1"') ||
          block.includes('lastClr="FFFFFF"') ||
          block.includes('val="FFFFFF"');
        if (!isWhite) {
          continue;
        }
        let existing = "";
        const atRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
        let tm: RegExpExecArray | null;
        while ((tm = atRe.exec(block)) != null) {
          existing += xmlUnescape(tm[1]);
        }
        if (existing.trim() !== "") {
          continue;
        }
        const fromMatch = /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>[\s\S]*?<\/xdr:from>/.exec(
          block,
        );
        if (fromMatch == null) {
          continue;
        }
        const col1 = Number(fromMatch[1]) + 1;
        const row1 = Number(fromMatch[2]) + 1;
        let lbl = origLabelMap.get(`${col1}:${row1}`) ?? "";
        if (!lbl) {
          for (let c = col1; c >= 1; c--) {
            const hit = origLabelMap.get(`${c}:${row1}`);
            if (hit) {
              lbl = hit;
              break;
            }
          }
        }
        if (!lbl && row1 > 1) {
          for (let c = Math.max(1, col1 - 2); c <= col1 + 1; c++) {
            const hit = origLabelMap.get(`${c}:${row1 - 1}`);
            if (hit) {
              lbl = hit;
              break;
            }
          }
        }
        if (lbl && lbl.length <= 120) {
          candidates.push({ kind: "drawing", boxIdx: bIdx, label: lbl });
        }
      }
    }

    if (candidates.length === 0) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields: [] };
    }

    const rawFields: PdfFormField[] = candidates.map((c, idx): PdfFormField => ({
      key: `xlsx_${idx}`,
      name: "",
      tooltip: "",
      label: c.label,
      type: "text",
      maxLength: 0,
      options: [],
    }));
    const inputs = rawFields.map(pdfFieldInput);
    let { matches } = fill_fields_from_profile({
      fields: inputs,
      profile: profileFields,
      explicit_fill: true,
      choices: [],
    });
    const unresolvedIndexes = inputs
      .map((_, index) => index)
      .filter((index) => {
        const local = matches[index];
        return (
          local == null ||
          local.score < CONFIDENT_LOCAL_SCORE ||
          !local.attribute ||
          !local.value?.trim()
        );
      });
    if (allowSemanticAsk && unresolvedIndexes.length > 0) {
      const choices: ChosenField[] = [];
      if (this.canUseCloudForFill() && typeof this.inference?.describe === "function") {
        const described = await this.describeFormInputs(
          fileName,
          rawFields,
          inputs,
          unresolvedIndexes,
          [...profile_details(profileFields).details.keys()],
        );
        for (const item of described) {
          if (item.format) {
            inputs[item.index].format ||= item.format;
          }
          const attr =
            item.whose === "official_only"
              ? ""
              : item.whose !== "applicant" &&
                  item.whose !== "employer" &&
                  !isPersonScopedAttribute(item.detail)
                ? ""
                : item.detail;
          choices.push({ id: inputs[item.index].id, attribute: attr, owner: item.whose });
        }
      } else if (profile != null) {
        const askInputs = unresolvedIndexes.map((idx) => inputs[idx]);
        choices.push(...(await this.choicesFor(askInputs, profile, profileFields)));
      }
      if (choices.length > 0 || inputs.some((inp) => inp.format !== "")) {
        matches = fill_fields_from_profile({
          fields: inputs,
          profile: profileFields,
          explicit_fill: true,
          choices,
        }).matches;
      }
    }

    const cellReplacements = new Map<number, string>();
    const drawingReplacements = new Map<number, string>();
    const filledFields: FilledFieldSummary[] = [];
    const unfilledFields: UnfilledFieldSummary[] = [];
    const eaFont = eastAsianFontName();
    matches.forEach((match, idx) => {
      const cand = candidates[idx];
      const val = match.value?.trim();
      if (!val) {
        if (match.owner !== "official_only") {
          unfilledFields.push({ label: cand.label });
        }
        return;
      }
      if (cand.kind === "cell") {
        const targetCell = cells[cand.cellIdx];
        const cleanAttrs = targetCell.attrs.replace(/\s*\bt="[^"]*"/g, "");
        cellReplacements.set(
          cand.cellIdx,
          `<c${cleanAttrs} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`,
        );
      } else {
        const block = drawingBlocks[cand.boxIdx].raw;
        const run = `<a:r><a:rPr sz="900"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="${eaFont}"/></a:rPr><a:t>${xmlEscape(val)}</a:t></a:r>`;
        const endParaPos = block.indexOf("<a:endParaRPr");
        const closePPos = block.lastIndexOf("</a:p>");
        if (endParaPos >= 0) {
          drawingReplacements.set(
            cand.boxIdx,
            `${block.slice(0, endParaPos)}${run}${block.slice(endParaPos)}`,
          );
        } else if (closePPos >= 0) {
          drawingReplacements.set(
            cand.boxIdx,
            `${block.slice(0, closePPos)}${run}${block.slice(closePPos)}`,
          );
        }
      }
      filledFields.push({ label: cand.label, value: val });
    });
    const totalReplaced = cellReplacements.size + drawingReplacements.size;
    if (totalReplaced === 0) {
      return { bytes: xlsxBytes, filled: 0, filledFields: [], unfilledFields };
    }

    if (cellReplacements.size > 0) {
      let rebuilt = "";
      let lastPos = 0;
      cells.forEach((cell, idx) => {
        rebuilt += sheetXml.slice(lastPos, cell.start);
        rebuilt += cellReplacements.get(idx) ?? cell.raw;
        lastPos = cell.end;
      });
      rebuilt += sheetXml.slice(lastPos);
      zip.file("xl/worksheets/sheet1.xml", rebuilt);
    }
    if (drawingReplacements.size > 0 && drawingXml !== "") {
      let dRebuilt = "";
      let dLast = 0;
      drawingBlocks.forEach((blk, idx) => {
        dRebuilt += drawingXml.slice(dLast, blk.start);
        dRebuilt += drawingReplacements.get(idx) ?? blk.raw;
        dLast = blk.end;
      });
      dRebuilt += drawingXml.slice(dLast);
      zip.file("xl/drawings/drawing1.xml", dRebuilt);
    }
    return {
      bytes: await zip.generateAsync({ type: "uint8array" }),
      filled: totalReplaced,
      filledFields,
      unfilledFields,
    };
  }

  /** Matching sends field descriptions and held attribute names; values stay in the vault. */
  private async choicesFor(
    fields: ReturnType<typeof pdfFieldInput>[],
    profile: CipherView,
    effectiveFields?: ProfileFields,
  ): Promise<ChosenField[]> {
    const resolvedFields = effectiveFields ?? (await this.effectiveProfileFields(profile));
    const held = [...(profile_details(resolvedFields)?.details?.keys() ?? [])];
    const settings = await ipc.capture.decisionSettings();
    return chooseDetails(
      fields,
      held,
      (r) => this.decide(r as DecisionRequest, false),
      settings?.perRequest ?? 0,
    );
  }

  /** Where a file handed over by path, rather than dropped in this window, lives. */
  rememberPath(file: File, path: string): void {
    this.paths.set(file, path);
  }

  private sourcePathOf(file: File): string | undefined {
    const remembered = this.paths.get(file);
    if (remembered) {
      return remembered;
    }
    try {
      return ipc.capture.pathForFile(file) || undefined;
    } catch {
      return undefined;
    }
  }

  /** Whether the PDF contains interactive form fields. */
  isPdfForm(bytes: Uint8Array): boolean {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 512 * 1024));
    return head.includes("/AcroForm") || (head.includes("<field") && head.includes("xfa"));
  }

  /** Whether a file's name marks it as a blank form to be filled rather than a source document. */
  isFormFileName(name: string): boolean {
    return /(?:form|todoke|shinsei|tokhai|to[\s_-]*khai|ct01|tk1|bhxh|isa|change|application|declaration|arrival|onboarding|届|申請書|申告書|申込書|届出書)/i.test(
      name,
    );
  }

  /**
   * Classifies a dropped or chosen file from its content and visual layout rather than its filename,
   * returning `"form"`, `"document"`, or `"ambiguous"`.
   */
  async classifyDroppedFile(
    file: File,
    bytes: Uint8Array,
  ): Promise<"form" | "document" | "ambiguous"> {
    if (/\.hwpx$/i.test(file.name)) {
      return "form";
    }
    if (/\.(docx|xlsx)$/i.test(file.name)) {
      return classifyOfficeArchive(file.name, bytes, this.isFormFileName(file.name));
    }
    if (/\.pdf$/i.test(file.name) && this.isPdfForm(bytes)) {
      return "form";
    }
    if (!/\.(?:pdf|png|jpe?g|webp|heic|tiff?)$/i.test(file.name)) {
      return "document";
    }
    if (typeof ipc !== "undefined" && typeof ipc.capture?.classifyFile === "function") {
      try {
        const res = await ipc.capture.classifyFile(bytes, file.name);
        if (res?.kind === "form" || res?.kind === "document" || res?.kind === "ambiguous") {
          return res.kind;
        }
      } catch {
        // Helper classification failure falls back cleanly below.
      }
    }
    return this.isFormFileName(file.name) ? "form" : "document";
  }
}

export function documentProfileActionsFactory(documents: DocumentCaptureService): ProfileDocumentActions {
  return {
    remove: (profileId, sourceId) => documents.deleteDocument(profileId, sourceId),
    move: (profileId, sourceId, destinationId) => documents.moveDocument(profileId, sourceId, destinationId),
    profiles: () => documents.profiles(),
    pending: () => documents.pendingOperations(),
    retry: (id) => documents.retryOperation(id),
    replace: async (profileId, sourceId, file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { captured, unclear } = await documents.read(file, bytes);
      if (unclear != null && nonDerivedDetailCount(captured) === 0) {
        throw new Error(UNREADABLE_PHOTO_MESSAGE);
      }
      const result = await documents.replaceDocument(profileId, sourceId, captured, file, bytes);
      if (result == null) {
        throw new Error("No details were found. The original document is unchanged.");
      }
      if (!result.attached) {
        throw new Error("The replacement upload is waiting. Retry it from the quick bar.");
      }
      return result.profile;
    },
  };
}

function validLocator(value: unknown): boolean {
  if (value == null) { return true; }
  if (typeof value !== "object" || Array.isArray(value) || !("kind" in value) || !("page" in value) ||
    !Number.isInteger(value.page) || Number(value.page) < 0) { return false; }
  if (value.kind === "page") {
    if (!("x" in value && "y" in value && "w" in value && "h" in value)) { return false; }
    return [value.x, value.y, value.w, value.h].every((coordinate) =>
      typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1) &&
      Number(value.x) + Number(value.w) <= 1.000001 && Number(value.y) + Number(value.h) <= 1.000001;
  }
  return value.kind === "cell" && "row" in value && "column" in value &&
    Number.isInteger(value.row) && Number(value.row) >= 0 && Number.isInteger(value.column) && Number(value.column) >= 0 &&
    (!("a1" in value) || value.a1 == null || typeof value.a1 === "string") &&
    (!("table" in value) || value.table == null || Number.isInteger(value.table) && Number(value.table) >= 0);
}

function parseDocumentOperation(value: unknown): DocumentOperation {
  const unreadable = new Error("The document operation is unreadable. Its saved data has been kept.");
  if (value == null || typeof value !== "object" || Array.isArray(value)) { throw unreadable; }
  // The journal is encrypted; still validate its complete consumed shape before dispatching it.
  const operation = value as DocumentOperation;
  if (operation.v !== 1 || !["capture", "move", "delete"].includes(operation.kind) ||
    ![operation.intentId, operation.cipherId, operation.sourceId].every((id) => typeof id === "string" && !!id) ||
    operation.uploaded != null && typeof operation.uploaded !== "boolean" ||
    operation.created != null && typeof operation.created !== "boolean" ||
    operation.replaceSourceId != null && typeof operation.replaceSourceId !== "string") { throw unreadable; }
  if (operation.kind !== "delete") {
    const source = operation.source;
    if (source == null || typeof source !== "object" ||
      ![source.fileName, source.mediaType, source.kind].every((entry) => typeof entry === "string") ||
      ![source.documentDate, source.effectiveOn, source.expiresOn].every((date) =>
        date == null || typeof date === "string") ||
      (source.sha256 != null && typeof source.sha256 !== "string") ||
      source.sides != null && (!Array.isArray(source.sides) || !source.sides.every((side) => typeof side === "string"))) { throw unreadable; }
  }
  if (operation.kind === "capture" && (typeof operation.bytes !== "string" ||
    typeof operation.capturedAt !== "string" || !Number.isFinite(Date.parse(operation.capturedAt)) ||
    !Array.isArray(operation.values) || !operation.values.every((entry) => entry != null && typeof entry === "object" &&
      typeof entry.key === "string" && typeof entry.value === "string" && typeof entry.verified === "boolean" &&
      ["mrz", "barcode", "ocr", "chip", "text", "typed", "correction", "derived", "import"].includes(entry.origin) &&
      validLocator(entry.locator)))) { throw unreadable; }
  if (operation.kind === "move" && (![operation.originCipherId, operation.originSourceId].every((id) =>
    typeof id === "string" && !!id))) { throw unreadable; }
  for (const key of ["create", "upload"] as const) {
    const payload = operation[key];
    if (payload != null && (typeof payload !== "object" || typeof payload.localId !== "string" ||
      typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/.test(payload.hash) ||
      payload.body == null || typeof payload.body !== "object" || Array.isArray(payload.body))) { throw unreadable; }
  }
  if (operation.upload != null && (typeof operation.upload.contents !== "string" ||
    typeof operation.upload.body.key !== "string" || typeof operation.upload.body.fileName !== "string" ||
    typeof operation.upload.body.bytesChecksum !== "string" ||
    !Number.isInteger(operation.upload.body.fileSize) || Number(operation.upload.body.fileSize) < 0)) { throw unreadable; }
  if (operation.allocation != null && (typeof operation.allocation !== "object" ||
    typeof operation.allocation.attachmentId !== "string" || typeof operation.allocation.uploadUrl !== "string")) { throw unreadable; }
  if (operation.uploaded && (operation.upload == null || operation.allocation == null)) { throw unreadable; }
  return operation;
}

/** What the engine needs to know about a PDF field: the words that name it, as a person reads them. */
function pdfFieldInput(field: PdfFormField) {
  const words = [field.tooltip, field.label, field.name]
    .map((word) => word.trim())
    .filter((word) => word !== "" && !OPAQUE_NAME.test(word));
  return {
    id: field.name || field.key,
    name: field.name,
    label: [...new Set(words)].join(" — ") || field.label || field.name,
    placeholder: "",
    autocomplete: "",
    input_type:
      field.type === "select-one"
        ? "select-one"
        : field.type === "checkbox"
          ? "checkbox"
          : "text",
    section: field.section?.trim() ?? "",
    form: "",
    pattern: "",
    max_length: Math.max(0, field.maxLength),
    format: "",
    op_ignore: false,
  };
}

const PERSON_SCOPED_PREFIXES = [
  "name.",
  "birth.",
  "person.",
  "id.",
  "visa.",
  "address.",
  "contact.",
  "work.",
  "education.",
  "income.",
  "bank.",
  "tax.",
  "family.",
  "custom.",
];

function isPersonScopedAttribute(detail: string): boolean {
  return PERSON_SCOPED_PREFIXES.some((prefix) => detail.startsWith(prefix));
}

const OPTION_EQUIVALENCE_GROUPS: string[][] = [
  ["f", "female", "女", "女性", "nữ", "nu", "féminin", "feminin", "weiblich", "femenino", "femmina"],
  ["m", "male", "男", "男性", "nam", "masculin", "männlich", "masculino", "maschio"],
  ["yes", "true", "1", "有", "あり", "có", "ja", "oui", "sí", "si"],
  ["no", "false", "0", "無", "なし", "không", "khong", "nein", "non"],
  ["married", "既婚", "配偶者あり", "verheiratet", "marié", "mariée", "casado", "casada", "đã kết hôn"],
  ["single", "unmarried", "未婚", "独身", "配偶者なし", "ledig", "célibataire", "soltero", "soltera", "độc thân"],
  ["vnm", "vn", "vietnam", "viet nam", "việt nam", "ベトナム", "越南"],
  ["jpn", "jp", "japan", "nippon", "japon", "日本", "日本国"],
  ["usa", "us", "united states", "united states of america", "états-unis", "etats-unis", "estados unidos", "アメリカ", "米国", "アメリカ合衆国"],
  ["kor", "kr", "korea", "south korea", "republic of korea", "corée", "coree", "韓国", "大韓民国", "대한민국"],
  ["chn", "cn", "china", "chine", "中国", "中華人民共和国"],
  ["twn", "tw", "taiwan", "taïwan", "台湾"],
  ["hkg", "hk", "hong kong", "香港"],
  ["sgp", "sg", "singapore", "singapour", "シンガポール"],
  ["tha", "th", "thailand", "thaïlande", "thailande", "タイ"],
  ["idn", "id", "indonesia", "indonésie", "indonesie", "インドネシア"],
  ["phl", "ph", "philippines", "フィリピン"],
  ["ind", "in", "india", "inde", "インド"],
  ["aus", "au", "australia", "australie", "オーストラリア"],
  ["can", "ca", "canada", "カナダ"],
  ["gbr", "gb", "uk", "united kingdom", "great britain", "royaume-uni", "イギリス", "英国"],
  ["deu", "de", "germany", "deutschland", "deutsch", "german", "allemagne", "alemania", "ドイツ"],
  ["fra", "fr", "france", "frankreich", "francia", "フランス"],
  ["bra", "br", "brazil", "brasil", "brésil", "bresil", "ブラジル"],
  ["esp", "es", "spain", "españa", "espana", "espagne", "spanien", "スペイン"],
  ["ita", "it", "italy", "italia", "italie", "italien", "イタリア"],
  ["nld", "nl", "netherlands", "nederland", "pays-bas", "niederlande", "オランダ"],
  ["che", "ch", "switzerland", "schweiz", "suisse", "svizzera", "スイス"],
];

export function resolveSelectOption(value: string, options: string[]): string | undefined {
  const norm = value.trim().toLowerCase();
  if (!norm || options.length === 0) {
    return undefined;
  }
  const exact = options.find((opt) => opt.trim().toLowerCase() === norm);
  if (exact != null) {
    return exact;
  }
  for (const group of OPTION_EQUIVALENCE_GROUPS) {
    if (group.includes(norm)) {
      const matched = options.find((opt) => {
        const clean = opt.trim().toLowerCase();
        if (group.includes(clean)) {
          return true;
        }
        // Check multi-word synonyms first (e.g. "viet nam", "united states", "royaume-uni")
        if (group.some((syn) => syn.length >= 4 && syn.includes(" ") && clean === syn)) {
          return true;
        }
        const tokens = clean.split(/[\s\-–—/()（）\[\]:,・]+/).filter(Boolean);
        // Never match 1- or 2-letter ISO codes inside multi-word options (e.g. French "REPUBLIQUE DE", "AFRIQUE DU")
        return (
          tokens.length <= 4 &&
          tokens.some((tok) => (tokens.length === 1 || tok.length >= 4) && group.includes(tok))
        );
      });
      if (matched != null) {
        return matched;
      }
    }
  }
  if (norm.length >= 3) {
    return options.find((opt) => {
      const clean = opt.trim().toLowerCase();
      return clean.startsWith(`${norm} `) || clean.endsWith(`(${norm})`);
    });
  }
  return undefined;
}

function matchesCheckboxChoice(value: string, field: PdfFormField): boolean {
  const norm = value.trim().toLowerCase();
  if (norm === "true" || norm === "1" || norm === "yes") {
    return true;
  }
  const labels = [field.label, field.tooltip, field.name]
    .map((s) => s.trim())
    .filter((s) => s !== "" && !OPAQUE_NAME.test(s));
  if (resolveSelectOption(value, labels) != null) {
    return true;
  }
  // A sex checkbox is the choice itself ("weiblich"), while the profile value stays "F".
  return (
    (norm === "f" || norm === "m") &&
    labels.some((label) => resolveSelectOption(label, [norm === "f" ? "female" : "male"]) != null)
  );
}

function normalizeWhose(raw: string | undefined): string {
  const clean = (raw ?? "").trim().toLowerCase();
  if (
    clean === "" ||
    clean === "self" ||
    clean === "applicant" ||
    clean === "holder" ||
    clean === "person" ||
    clean === "user"
  ) {
    return "applicant";
  }
  if (clean === "company" || clean === "organization") {
    return "employer";
  }
  if (clean === "agent" || clean === "representative" || clean === "legal_representative") {
    return "preparer";
  }
  if (clean === "office" || clean === "official" || clean === "for_official_use") {
    return "official_only";
  }
  return clean;
}

function fnv1aHex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((code >>> 8) | ((code & 0xff) << 8)), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function eastAsianFontName(): string {
  if (typeof navigator !== "undefined" && !/Mac/i.test(navigator.platform ?? "")) {
    return "Microsoft YaHei";
  }
  return "Hiragino Sans";
}

interface OfficePiece {
  text: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  confidence?: number;
  locator?: {
    kind: "cell";
    page: number;
    row: number;
    column: number;
    a1?: string;
    table?: number;
  };
}

export async function extractOfficePieces(fileName: string, bytes: Uint8Array): Promise<string> {
  const sdkExtract = (
    sdk as unknown as { extract_office_pieces?: (b: Uint8Array, n: string) => string }
  ).extract_office_pieces;
  if (typeof sdkExtract === "function") {
    try {
      const out = sdkExtract(bytes, fileName);
      if (out && out !== "{}") {
        return out;
      }
    } catch {
      // Fall through to JSZip XML extractor.
    }
  }

  const zip = await new JSZip().loadAsync(bytes);
  if (/\.docx$/i.test(fileName)) {
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      return JSON.stringify({ pages: [] });
    }
    const xml = await docEntry.async("string");
    const pieces: OfficePiece[] = [];
    const blockRe = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const readXmlText = (fragment: string): string => {
      let acc = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(fragment)) != null) {
        acc += xmlUnescape(m[1]);
      }
      return acc.replace(/\s+/g, " ").trim();
    };
    let bm: RegExpExecArray | null;
    let tableIndex = 0;
    let syntheticRow = 0;
    while ((bm = blockRe.exec(xml)) != null) {
      const block = bm[0];
      if (block.startsWith("<w:tbl")) {
        let rm: RegExpExecArray | null;
        rowRe.lastIndex = 0;
        let rowIdx = 0;
        while ((rm = rowRe.exec(block)) != null) {
          const cells: string[] = [];
          let cm: RegExpExecArray | null;
          cellRe.lastIndex = 0;
          while ((cm = cellRe.exec(rm[0])) != null) {
            cells.push(readXmlText(cm[0]));
          }
          const colCount = Math.max(cells.length, 1);
          cells.forEach((cellText, colIdx) => {
            if (!cellText) {
              return;
            }
            const x = Math.min(0.95, colIdx / colCount);
            const y = Math.min(0.95, syntheticRow * 0.025);
            pieces.push({
              text: cellText,
              x,
              y,
              w: Math.min(1 - x, 1 / colCount),
              h: 0.02,
              confidence: 1,
              locator: {
                kind: "cell",
                page: 0,
                table: tableIndex,
                row: rowIdx,
                column: colIdx,
              },
            });
          });
          rowIdx++;
          syntheticRow++;
        }
        tableIndex++;
      } else {
        const text = readXmlText(block);
        if (text) {
          const y = Math.min(0.95, syntheticRow * 0.025);
          pieces.push({
            text,
            x: 0.05,
            y,
            w: 0.9,
            h: 0.02,
            confidence: 1,
          });
          syntheticRow++;
        }
      }
    }
    return JSON.stringify({ pages: [{ index: 0, pieces }] });
  }

  // .xlsx
  const sharedStrings: string[] = [];
  const sharedEntry = zip.file("xl/sharedStrings.xml");
  if (sharedEntry) {
    const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let sm: RegExpExecArray | null;
    while ((sm = siRe.exec(sXml)) != null) {
      let txt = "";
      let tm: RegExpExecArray | null;
      tRe.lastIndex = 0;
      while ((tm = tRe.exec(sm[1])) != null) {
        txt += xmlUnescape(tm[1]);
      }
      sharedStrings.push(txt.trim());
    }
  }
  const sheetNames = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(/sheet(\d+)\.xml/i.exec(a)?.[1] ?? 0);
      const nb = Number(/sheet(\d+)\.xml/i.exec(b)?.[1] ?? 0);
      return na - nb;
    });
  const colToIndex = (col: string): number => {
    let n = 0;
    for (let i = 0; i < col.length; i++) {
      n = n * 26 + (col.charCodeAt(i) - 64);
    }
    return Math.max(0, n - 1);
  };
  const pages: { index: number; pieces: OfficePiece[] }[] = [];
  const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
  for (let sheetIdx = 0; sheetIdx < sheetNames.length; sheetIdx++) {
    const entry = zip.file(sheetNames[sheetIdx]);
    if (!entry) {
      continue;
    }
    const xml = await entry.async("string");
    const pieces: OfficePiece[] = [];
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(xml)) != null) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const refMatch = /\br="([A-Z]+)(\d+)"/.exec(attrs);
      if (!refMatch) {
        continue;
      }
      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
      const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
      let text = "";
      if (typeMatch?.[1] === "s" && valMatch != null) {
        text = sharedStrings[Number(valMatch[1])] ?? "";
      } else if (inlineMatch != null) {
        text = xmlUnescape(inlineMatch[1]).trim();
      } else if (valMatch != null) {
        text = xmlUnescape(valMatch[1]).trim();
      }
      if (!text) {
        continue;
      }
      const colZero = colToIndex(refMatch[1]);
      const rowZero = Math.max(0, Number(refMatch[2]) - 1);
      const x = Math.min(0.92, colZero * 0.12);
      const y = Math.min(0.95, rowZero * 0.025);
      pieces.push({
        text,
        x,
        y,
        w: Math.min(1 - x, 0.11),
        h: 0.02,
        confidence: 1,
        locator: {
          kind: "cell",
          page: sheetIdx,
          row: rowZero,
          column: colZero,
          a1: `${refMatch[1]}${refMatch[2]}`,
        },
      });
    }
    pages.push({ index: sheetIdx, pieces });
  }
  return JSON.stringify({ pages });
}

function officePiecesToPlainText(reading: string): string {
  try {
    const pages = (JSON.parse(reading).pages ?? []) as { pieces?: OfficePiece[] }[];
    const lines: string[] = [];
    for (const page of pages) {
      let currentRowKey = "";
      let rowTokens: string[] = [];
      for (const piece of page.pieces ?? []) {
        const loc = piece.locator;
        const rowKey = loc ? `${loc.page}:${loc.table ?? -1}:${loc.row}` : `p:${lines.length}:${rowTokens.length}`;
        if (loc && rowKey === currentRowKey) {
          rowTokens.push(piece.text);
        } else {
          if (rowTokens.length > 0) {
            lines.push(rowTokens.join("\t"));
          }
          currentRowKey = loc ? rowKey : "";
          rowTokens = [piece.text];
        }
      }
      if (rowTokens.length > 0) {
        lines.push(rowTokens.join("\t"));
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function classifyOfficeArchive(
  fileName: string,
  bytes: Uint8Array,
  nameLooksLikeForm: boolean,
): Promise<"form" | "document" | "ambiguous"> {
  const sdkClassify = (
    sdk as unknown as { classify_office_bytes?: (b: Uint8Array, n: string) => string }
  ).classify_office_bytes;
  if (typeof sdkClassify === "function") {
    try {
      const raw = sdkClassify(bytes, fileName);
      const parsedKind = raw.trim().startsWith("{")
        ? (JSON.parse(raw) as { kind?: string }).kind
        : raw;
      if (parsedKind === "form" || parsedKind === "document" || parsedKind === "ambiguous") {
        return parsedKind;
      }
    } catch {
      // Fall through to JSZip inspection.
    }
  }

  let zip: JSZip;
  try {
    zip = await new JSZip().loadAsync(bytes);
  } catch {
    return "form";
  }

  let emptySlots = 0;
  let populatedPairs = 0;
  let proseBlocks = 0;

  if (/\.docx$/i.test(fileName)) {
    const docEntry = zip.file("word/document.xml");
    if (!docEntry) {
      return "form";
    }
    const xml = await docEntry.async("string");
    const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    const textRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    const getText = (frag: string) => {
      let s = "";
      let m: RegExpExecArray | null;
      textRe.lastIndex = 0;
      while ((m = textRe.exec(frag)) != null) {
        s += xmlUnescape(m[1]);
      }
      return s.replace(/\s+/g, " ").trim();
    };
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(xml)) != null) {
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[0])) != null) {
        cells.push(getText(cm[0]));
      }
      for (let i = 0; i < cells.length; i++) {
        const cur = cells[i];
        if (!cur) {
          continue;
        }
        if (/_{3,}|□|\[\s{2,}\]/.test(cur)) {
          emptySlots++;
        }
        if (i + 1 < cells.length) {
          if (cells[i + 1] === "") {
            emptySlots++;
          } else if (cur.length <= 60) {
            populatedPairs++;
          }
        }
      }
    }
    const withoutTables = xml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, "");
    const pRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
    let pm: RegExpExecArray | null;
    while ((pm = pRe.exec(withoutTables)) != null) {
      const txt = getText(pm[0]);
      if (/_{4,}|□|\[\s{2,}\]/.test(txt)) {
        emptySlots++;
      } else if (txt.length >= 60 || /[:：]\s*\S+/.test(txt)) {
        proseBlocks++;
      }
    }
  } else {
    const sharedStrings: string[] = [];
    const sharedEntry = zip.file("xl/sharedStrings.xml");
    if (sharedEntry) {
      const sXml = (await sharedEntry.async("string")).replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "");
      const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
      const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let sm: RegExpExecArray | null;
      while ((sm = siRe.exec(sXml)) != null) {
        let txt = "";
        let tm: RegExpExecArray | null;
        tRe.lastIndex = 0;
        while ((tm = tRe.exec(sm[1])) != null) {
          txt += xmlUnescape(tm[1]);
        }
        sharedStrings.push(txt.trim());
      }
    }
    const sheetEntry = zip.file("xl/worksheets/sheet1.xml");
    if (!sheetEntry) {
      return "form";
    }
    const xml = await sheetEntry.async("string");
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    const cellRe = /<c\b([^>]*?)(?:>([\s\S]*?)<\/c>|\/>)/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRe.exec(xml)) != null) {
      const rowCells: { col: string; text: string }[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rMatch[1])) != null) {
        const attrs = cm[1] ?? "";
        const body = cm[2] ?? "";
        const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const valMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        const inlineMatch = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(body);
        let text = "";
        if (typeMatch?.[1] === "s" && valMatch != null) {
          text = sharedStrings[Number(valMatch[1])] ?? "";
        } else if (inlineMatch != null) {
          text = xmlUnescape(inlineMatch[1]).trim();
        } else if (valMatch != null) {
          text = xmlUnescape(valMatch[1]).trim();
        }
        rowCells.push({ col: refMatch?.[1] ?? "", text });
      }
      for (let i = 0; i < rowCells.length; i++) {
        const cur = rowCells[i].text;
        if (!cur) {
          continue;
        }
        if (/_{3,}|□/.test(cur)) {
          emptySlots++;
        }
        if (i + 1 < rowCells.length) {
          if (rowCells[i + 1].text === "") {
            emptySlots++;
          } else {
            populatedPairs++;
          }
        }
      }
    }
  }

  const docSignals = populatedPairs + proseBlocks * 2;
  if (emptySlots > 0 && (nameLooksLikeForm || emptySlots >= docSignals)) {
    return "form";
  }
  if (docSignals >= 2 && emptySlots === 0) {
    return "document";
  }
  if (emptySlots > 0 && docSignals >= 2) {
    return "ambiguous";
  }
  return nameLooksLikeForm ? "form" : emptySlots > 0 ? "form" : docSignals > 0 ? "document" : "form";
}
