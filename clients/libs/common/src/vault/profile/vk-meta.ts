import { Utils } from "../../platform/misc/utils";
import { CipherType, FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";

/** The Hidden custom field that carries a profile's detail envelope, or an item's profile link. */
export const VK_META_FIELD = "vk.meta";

export type AgentRule = "ask" | "fill" | "never";

export type ValueType =
  "text" | "date" | "phone" | "email" | "address" | "number" | "link" | "secret";

export type VariantOrigin =
  "mrz" | "barcode" | "ocr" | "chip" | "text" | "typed" | "correction" | "derived" | "import";

/** A box on a page, as fractions of the page from its top left corner. */
export interface PageLocator {
  kind: "page";
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A cell of a sheet or a table. `row` and `column` count from 0. */
export interface CellLocator {
  kind: "cell";
  page: number;
  row: number;
  column: number;
  /** An Excel cell's reference. A Word cell has none. */
  a1: string | null;
  /** The table of a Word file; null until a reader gives one. */
  table: number | null;
}

export type Locator = PageLocator | CellLocator;

export interface DetailVariant {
  id: string;
  /** An ISO 15924 script subtag, or null. */
  script: string | null;
  /** An open companion-format label such as "wareki", or null. */
  tag: string | null;
  value: string;
  /** False for a value that was replaced and is kept as history. */
  current: boolean;
  sourceId: string | null;
  locator: Locator | null;
  /** True only when the applicable machine-readable verification passed. */
  verified: boolean;
  origin: VariantOrigin;
}

export interface HistoryEntry {
  variant: DetailVariant;
  retiredAt: string;
  reason: "superseded" | "correction" | "dismissed";
}

export interface ProfileDetail {
  id: string;
  /** The canonical vocabulary key, or null for a label a form or document printed. */
  attribute: string | null;
  label: string;
  valueType: ValueType;
  chosenVariantId: string | null;
  agentRule: AgentRule;
  variants: DetailVariant[];
  history: HistoryEntry[];
  conflicts: unknown[];
}

export interface ProfileSource {
  id: string;
  attachmentId: string | null;
  fileName: string;
  mediaType: string;
  /** The reader's open label for what the document is. */
  kind: string;
  documentDate: string | null;
  effectiveOn: string | null;
  capturedAt: string;
  expiresOn: string | null;
  sides?: string[];
  status: "current" | "retained" | "deleted";
}

/** The envelope of a profile (an Identity item). Keys this version does not know are kept. */
export interface VkMetaV1 {
  v: 1;
  profileId: string;
  kind: "person" | "organization";
  relationship: string | null;
  status: "confirmed" | "draft";
  details: ProfileDetail[];
  sources: ProfileSource[];
  [unknown: string]: unknown;
}

/** What a login, a card or a key carries instead: a link to the profile it is for. */
export interface ProfileRefMeta {
  v: 1;
  profileRef?: { cipherId: string | null } | null;
  [unknown: string]: unknown;
}

// ---- reading and writing the field ------------------------------------------------------------

function metaField(cipher: CipherView): FieldView | undefined {
  return (cipher.fields ?? []).find((f) => f.name === VK_META_FIELD);
}

export type EnvelopeState = "none" | "v1" | "unsupported" | "unreadable";

/** What the carrier field holds. A version other than 1 is left as it is and never rewritten. */
export function envelopeState(cipher: CipherView): EnvelopeState {
  const fields = (cipher.fields ?? []).filter((field) => field.name === VK_META_FIELD);
  if (fields.length === 0) {
    return "none";
  }
  if (fields.length !== 1 || !fields[0].value) {
    return "unreadable";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fields[0].value);
  } catch {
    return "unreadable";
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "unreadable";
  }
  if (!("v" in parsed) || parsed.v !== 1) {
    return "unsupported";
  }
  return (cipher.type === CipherType.Identity ? isProfileEnvelope(parsed) : isProfileLink(parsed))
    ? "v1"
    : "unreadable";
}

/** The validated profile envelope of a type 4 item, with unknown keys left intact. */
export function readEnvelope(cipher: CipherView): VkMetaV1 | null {
  if (cipher.type !== CipherType.Identity || envelopeState(cipher) !== "v1") {
    return null;
  }
  const parsed: unknown = JSON.parse(metaField(cipher)!.value!);
  return isProfileEnvelope(parsed) ? parsed : null;
}

/** Stores the envelope. Refuses to overwrite one it does not understand. */
export function writeEnvelope(cipher: CipherView, meta: VkMetaV1): void {
  if (cipher.type !== CipherType.Identity || !isProfileEnvelope(meta)) {
    throw new Error("Profile details require a valid type 4 envelope.");
  }
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    throw new Error("This profile's details are unreadable or from a newer version and are left as they are.");
  }
  stampAgentRules(meta);
  setMetaValue(cipher, JSON.stringify(meta));
}

function setMetaValue(cipher: CipherView, value: string): void {
  cipher.fields ??= [];
  const existing = metaField(cipher);
  if (existing != null) {
    existing.value = value;
    existing.type = FieldType.Hidden;
    return;
  }
  const field = new FieldView();
  field.name = VK_META_FIELD;
  field.value = value;
  field.type = FieldType.Hidden;
  cipher.fields.push(field);
}

/** The profile an item is linked to, for a login, a card or a key. */
export function profileRefOf(cipher: CipherView): string | null {
  if (cipher.type === CipherType.Identity || envelopeState(cipher) !== "v1") {
    return null;
  }
  const parsed: unknown = JSON.parse(metaField(cipher)!.value!);
  return isProfileLink(parsed) ? (parsed.profileRef?.cipherId ?? null) : null;
}

/** Links an item to a profile, or clears the link. Nothing but the id is stored. */
export function setProfileRef(cipher: CipherView, cipherId: string | null): void {
  if (cipher.type === CipherType.Identity) {
    throw new Error("A profile keeps its own details and is not linked with profileRef.");
  }
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    throw new Error("This item's link was written by a newer version and is left as it is.");
  }
  const existing: unknown = state === "v1" ? JSON.parse(metaField(cipher)!.value!) : null;
  if (isProfileEnvelope(existing)) {
    throw new Error("This item's link was written by a newer version and is left as it is.");
  }
  const meta: ProfileRefMeta =
    existing != null && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as ProfileRefMeta) }
      : { v: 1 };
  meta.v = 1;
  meta.profileRef = cipherId == null ? null : { cipherId };
  setMetaValue(cipher, JSON.stringify(meta));
}

function isProfileLink(value: unknown): value is ProfileRefMeta {
  if (value == null || typeof value !== "object" || Array.isArray(value) || !("v" in value) || value.v !== 1) {
    return false;
  }
  if (["profileId", "details", "sources"].some((key) => key in value)) {
    return false;
  }
  if (!("profileRef" in value) || value.profileRef == null) {
    return true;
  }
  const ref = value.profileRef;
  return typeof ref === "object" && !Array.isArray(ref) && "cipherId" in ref &&
    (ref.cipherId == null || typeof ref.cipherId === "string");
}

function isProfileEnvelope(value: unknown): value is VkMetaV1 {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return "v" in value && value.v === 1 && !("profileRef" in value) &&
    "profileId" in value && typeof value.profileId === "string" &&
    "kind" in value && (value.kind === "person" || value.kind === "organization") &&
    "relationship" in value && (value.relationship == null || typeof value.relationship === "string") &&
    "status" in value && (value.status === "confirmed" || value.status === "draft") &&
    "details" in value && Array.isArray(value.details) && value.details.every(isDetail) &&
    "sources" in value && Array.isArray(value.sources) && value.sources.every(isSource);
}

function isDetail(value: unknown): value is ProfileDetail {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "attribute" in value && (value.attribute == null || typeof value.attribute === "string") &&
    "label" in value && typeof value.label === "string" &&
    "valueType" in value && typeof value.valueType === "string" &&
    ["text", "date", "phone", "email", "address", "number", "link", "secret"].includes(value.valueType) &&
    "chosenVariantId" in value && (value.chosenVariantId == null || typeof value.chosenVariantId === "string") &&
    (!("agentRule" in value) || ["ask", "fill", "never"].includes(String(value.agentRule))) &&
    "variants" in value && Array.isArray(value.variants) && value.variants.every(isVariant) &&
    "history" in value && Array.isArray(value.history) && value.history.every((entry) =>
      entry != null && typeof entry === "object" && "variant" in entry && isVariant(entry.variant) &&
      "retiredAt" in entry && typeof entry.retiredAt === "string" && "reason" in entry &&
      ["superseded", "correction", "dismissed"].includes(String(entry.reason))) &&
    "conflicts" in value && Array.isArray(value.conflicts);
}

function isVariant(value: unknown): value is DetailVariant {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "script" in value && (value.script == null || typeof value.script === "string") &&
    "tag" in value && (value.tag == null || typeof value.tag === "string") &&
    "value" in value && typeof value.value === "string" &&
    "current" in value && typeof value.current === "boolean" &&
    "sourceId" in value && (value.sourceId == null || typeof value.sourceId === "string") &&
    "verified" in value && typeof value.verified === "boolean" &&
    "origin" in value && ["mrz", "barcode", "ocr", "chip", "text", "typed", "correction", "derived", "import"].includes(String(value.origin)) &&
    "locator" in value && (value.locator == null || isLocator(value.locator));
}

function isLocator(value: unknown): value is Locator {
  if (value == null || typeof value !== "object" || !("page" in value) ||
    typeof value.page !== "number" || !Number.isInteger(value.page) || value.page < 0 || !("kind" in value)) {
    return false;
  }
  if (value.kind === "page") {
    return ["x", "y", "w", "h"].every((key) => {
      const entry = Reflect.get(value, key);
      return typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 1;
    });
  }
  return value.kind === "cell" && "row" in value && typeof value.row === "number" &&
    Number.isInteger(value.row) && value.row >= 0 && "column" in value &&
    typeof value.column === "number" && Number.isInteger(value.column) && value.column >= 0 &&
    "a1" in value && (value.a1 == null || typeof value.a1 === "string") &&
    "table" in value && (value.table == null || (typeof value.table === "number" && Number.isInteger(value.table) && value.table >= 0));
}

function isSource(value: unknown): value is ProfileSource {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return "id" in value && typeof value.id === "string" && value.id.length > 0 &&
    "attachmentId" in value && (value.attachmentId == null || typeof value.attachmentId === "string") &&
    ["fileName", "mediaType", "kind", "capturedAt"].every((key) => typeof Reflect.get(value, key) === "string") &&
    ["documentDate", "effectiveOn", "expiresOn"].every((key) => key in value &&
      (Reflect.get(value, key) == null || typeof Reflect.get(value, key) === "string")) &&
    "status" in value && ["current", "retained", "deleted"].includes(String(value.status)) &&
    (!("sides" in value) || (Array.isArray(value.sides) && value.sides.every((side) => typeof side === "string")));
}

/**
 * Whether fill may use a linked profile: the profile exists, is not in the trash and is
 * confirmed. A draft, a missing or an unreadable profile leaves the link unavailable and never
 * falls back to the account owner's details.
 */
export function profileUsableForFill(profile: CipherView | null | undefined): boolean {
  if (profile == null || profile.type !== CipherType.Identity || profile.isDeleted || profile.migrationPending) {
    return false;
  }
  const envelope = readEnvelope(profile);
  return envelope != null && envelope.status === "confirmed";
}

// ---- vocabulary ---------------------------------------------------------------------------------

/** Names that two sources spell differently; the first of each pair is the canonical key. */
const RENAMES: readonly (readonly [legacy: string, canonical: string])[] = [
  ["id.drivers_license.number", "id.driver_license.number"],
  ["id.drivers_license.issue_date", "id.driver_license.issued"],
  ["id.drivers_license.expiry_date", "id.driver_license.expiry"],
  ["address.state", "address.prefecture"],
  ["passport.number", "id.passport.number"],
  ["sex", "person.sex"],
];

/** A name suffix and what it stands for: a script of the same value, or a companion format. */
const SUFFIXES: readonly { suffix: string; script: string | null; tag: string | null }[] = [
  { suffix: ".latin", script: "Latn", tag: null },
  { suffix: ".kana", script: "Kana", tag: null },
  { suffix: ".hiragana", script: "Hira", tag: null },
  { suffix: ".kanji", script: "Hani", tag: null },
  { suffix: ".hangul", script: "Hang", tag: null },
  { suffix: ".wareki", script: null, tag: "wareki" },
  { suffix: ".zengin", script: null, tag: "zengin" },
];

/** The Identity item's own fields and the detail each holds. */
export const IDENTITY_ATTRIBUTES = [
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
] as const;

export type IdentityWireKey = (typeof IDENTITY_ATTRIBUTES)[number][0];

export function canonicalAttribute(name: string): string {
  return RENAMES.find(([legacy]) => legacy === name)?.[1] ?? name;
}

/** Splits a stored name into its detail and the script or companion format it carries. */
export function splitKey(key: string): {
  attribute: string;
  script: string | null;
  tag: string | null;
} {
  const canonical = canonicalAttribute(key);
  for (const { suffix, script, tag } of SUFFIXES) {
    if (canonical.endsWith(suffix) && canonical.length > suffix.length) {
      return { attribute: canonicalAttribute(canonical.slice(0, -suffix.length)), script, tag };
    }
  }
  return { attribute: canonical, script: null, tag: null };
}

/** The name a variant is stored under, so a filler that reads custom fields by name still finds it. */
export function joinKey(attribute: string, script: string | null, tag: string | null): string {
  const found = SUFFIXES.find((s) => s.script === script && s.tag === tag);
  return found != null ? attribute + found.suffix : attribute;
}

export function valueTypeOf(attribute: string | null): ValueType {
  if (attribute == null) {
    return "text";
  }
  if (
    /(^|\.)(date|expiry|issued|birth)(\.|$)|_date$/.test(attribute) ||
    attribute === "birth.date"
  ) {
    return "date";
  }
  if (attribute === "contact.email") {
    return "email";
  }
  if (attribute === "contact.phone") {
    return "phone";
  }
  if (attribute.startsWith("address.")) {
    return "address";
  }
  return "text";
}

// ---- building and editing ---------------------------------------------------------------------

export interface BuildOptions {
  newId?: () => string;
  now?: () => Date;
  /** A person-readable label for a canonical key; the key itself when not given. */
  labelOf?: (attribute: string) => string;
}

const ids = (o?: BuildOptions) => o?.newId ?? (() => Utils.newGuid());
const clock = (o?: BuildOptions) => o?.now ?? (() => new Date());

export function newEnvelope(
  profileId: string,
  options?: { kind?: "person" | "organization" },
): VkMetaV1 {
  return {
    v: 1,
    profileId,
    kind: options?.kind ?? "person",
    relationship: null,
    status: "confirmed",
    details: [],
    sources: [],
  };
}

function newDetail(attribute: string | null, label: string, options?: BuildOptions): ProfileDetail {
  return {
    id: ids(options)(),
    attribute,
    label,
    valueType: valueTypeOf(attribute),
    chosenVariantId: null,
    agentRule: "ask",
    variants: [],
    history: [],
    conflicts: [],
  };
}

function newVariant(
  value: string,
  fields: Partial<DetailVariant> & { origin: VariantOrigin },
  options?: BuildOptions,
): DetailVariant {
  return {
    id: ids(options)(),
    script: null,
    tag: null,
    value,
    current: true,
    sourceId: null,
    locator: null,
    verified: false,
    ...fields,
  };
}

const sameValue = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

function findDetail(meta: VkMetaV1, attribute: string): ProfileDetail | undefined {
  return meta.details.find((d) => d.attribute === attribute);
}

function sourceOf(meta: VkMetaV1, id: string | null): ProfileSource | undefined {
  return id == null ? undefined : meta.sources.find((s) => s.id === id);
}

/**
 * Which of two current values of one slot is the later document's, by the dates the documents
 * state. Returns null when the dates do not order them; the time a document was added never does.
 */
function newerByDates(
  a: ProfileSource | undefined,
  b: ProfileSource | undefined,
): "a" | "b" | null {
  if (a == null || b == null) {
    return null;
  }
  for (const key of ["effectiveOn", "documentDate"] as const) {
    if (a[key] != null && b[key] != null && a[key] !== b[key]) {
      return a[key]! > b[key]! ? "a" : "b";
    }
  }
  return null;
}

/**
 * The value fill writes for a detail among its current values: the person's choice while it is
 * still current, else the one from the latest effective document, else the latest dated one, else
 * the greatest source id. The other current values are the close call's alternatives.
 */
export function winnerAmong(
  meta: VkMetaV1,
  detail: ProfileDetail,
  candidates: DetailVariant[],
): DetailVariant | null {
  if (candidates.length === 0) {
    return null;
  }
  const chosen = candidates.find((v) => v.id === detail.chosenVariantId);
  if (chosen != null) {
    return chosen;
  }
  const rank = (v: DetailVariant, key: "effectiveOn" | "documentDate") =>
    sourceOf(meta, v.sourceId)?.[key] ?? "";
  return [...candidates].sort(
    (a, b) =>
      rank(b, "effectiveOn").localeCompare(rank(a, "effectiveOn")) ||
      rank(b, "documentDate").localeCompare(rank(a, "documentDate")) ||
      (b.sourceId ?? "").localeCompare(a.sourceId ?? "") ||
      b.id.localeCompare(a.id),
  )[0];
}

/** The current values of a detail, in the slot a script or companion format gives them. */
function slot(detail: ProfileDetail, script: string | null, tag: string | null): DetailVariant[] {
  return detail.variants.filter((v) => v.current && v.script === script && v.tag === tag);
}

/**
 * The value a detail stands for with no variant named. A person's choice wins while it is still
 * current; otherwise document dates and stable source ids determine the winner.
 */
export function resolveDetailVariant(meta: VkMetaV1, detail: ProfileDetail): DetailVariant | null {
  const current = detail.variants.filter((variant) => variant.current);
  const chosen = current.find((variant) => variant.id === detail.chosenVariantId);
  return chosen ?? winnerAmong(meta, detail, current.filter((variant) => variant.tag == null));
}

/**
 * The variant an Identity wire field holds. `firstName` prefers Latin even when the person chose
 * another script, matching the Identity projection. Every other wire key uses the chosen variant.
 */
export function projectedIdentityVariant(
  meta: VkMetaV1,
  detail: ProfileDetail,
  wire: IdentityWireKey,
): DetailVariant | null {
  if (wire !== "firstName") {
    return resolveDetailVariant(meta, detail);
  }
  const latin = detail.variants.filter((v) => v.current && v.tag == null && v.script === "Latn");
  return winnerAmong(meta, detail, latin) ?? resolveDetailVariant(meta, detail);
}

/** The other current values of the winner's slot, for the marker beside a filled field. */
export function alternativesOf(meta: VkMetaV1, detail: ProfileDetail): DetailVariant[] {
  const winner = resolveDetailVariant(meta, detail);
  if (winner == null) {
    return [];
  }
  return slot(detail, winner.script, winner.tag).filter(
    (variant, index, variants) => !sameValue(variant.value, winner.value) &&
      variants.findIndex((other) => sameValue(other.value, variant.value)) === index,
  );
}

function retire(
  detail: ProfileDetail,
  variant: DetailVariant,
  reason: HistoryEntry["reason"],
  options?: BuildOptions,
) {
  detail.variants = detail.variants.filter((v) => v.id !== variant.id);
  detail.history.push({
    variant: { ...variant, current: false },
    retiredAt: clock(options)().toISOString(),
    reason,
  });
  if (detail.chosenVariantId === variant.id) {
    detail.chosenVariantId = null;
  }
}

/** A source whose values have all left the current set is kept, marked retained, with its bytes. */
function settleSources(meta: VkMetaV1): void {
  for (const source of meta.sources) {
    if (source.status === "deleted") {
      continue;
    }
    const used = meta.details.some((d) =>
      d.variants.some((v) => v.current && v.sourceId === source.id),
    );
    source.status = used ? "current" : "retained";
  }
}

export interface CapturedValue {
  /** The stored name: a canonical key, with a script or companion suffix when it has one. */
  key: string;
  value: string;
  origin: VariantOrigin;
  verified: boolean;
  locator?: Locator | null;
}

export interface CapturedSourceInput {
  fileName: string;
  mediaType: string;
  kind: string;
  documentDate?: string | null;
  effectiveOn?: string | null;
  expiresOn?: string | null;
  sides?: string[];
}

export interface CaptureResult {
  sourceId: string;
  /** Keys whose value the profile did not have or had differently. */
  changed: string[];
}

/**
 * Records what a document said. A value joins the detail it is for as a variant that points at the
 * document and the place on it. When it differs from a current value of the same slot, the later
 * document by its stated dates takes over and the other goes to history; with no date to order them
 * both stay current, and fill writes one and shows the other.
 */
export function recordCapture(
  meta: VkMetaV1,
  source: CapturedSourceInput,
  values: CapturedValue[],
  options?: BuildOptions,
): CaptureResult {
  const sourceId = ids(options)();
  const entry: ProfileSource = {
    id: sourceId,
    attachmentId: null,
    fileName: source.fileName,
    mediaType: source.mediaType,
    kind: source.kind,
    documentDate: source.documentDate ?? null,
    effectiveOn: source.effectiveOn ?? null,
    capturedAt: clock(options)().toISOString(),
    expiresOn: source.expiresOn ?? null,
    status: "current",
  };
  if (source.sides != null) {
    entry.sides = source.sides;
  }
  meta.sources.push(entry);

  const changed: string[] = [];
  for (const captured of values) {
    const learned = resolveLearnedDocumentLabel(captured.key);
    const effectiveKey = learned?.attribute ?? captured.key;
    const { attribute, script, tag } = splitKey(effectiveKey);
    const value = captured.value.trim();
    if (value === "") {
      continue;
    }
    let detail = findDetail(meta, attribute);
    detail ??= (() => {
      const created = newDetail(
        attribute,
        learned?.label ?? options?.labelOf?.(attribute) ?? attribute,
        options,
      );
      meta.details.push(created);
      return created;
    })();

    const same = slot(detail, script, tag);
    const alreadyKnown = same.some((variant) => sameValue(variant.value, value));

    const variant = newVariant(
      value,
      {
        script,
        tag,
        sourceId,
        locator: captured.locator ?? null,
        verified: captured.verified,
        origin: captured.origin,
      },
      options,
    );
    let addAsHistory = false;
    for (const old of same) {
      const newer = newerByDates(entry, sourceOf(meta, old.sourceId));
      if (newer === "a") {
        retire(detail, old, "superseded", options);
      } else if (newer === "b") {
        addAsHistory = true;
      }
    }
    if (addAsHistory) {
      detail.history.push({
        variant: { ...variant, current: false },
        retiredAt: clock(options)().toISOString(),
        reason: "superseded",
      });
    } else {
      detail.variants.push(variant);
    }
    if (!alreadyKnown) {
      changed.push(captured.key);
    }
  }
  settleSources(meta);
  return { sourceId, changed };
}

/**
 * The person types a new value for a variant. The old value goes to history with the document it
 * came from, the new one is chosen, and nothing about the document changes.
 */
export function correctVariant(
  meta: VkMetaV1,
  detailId: string,
  variantId: string,
  value: string,
  options?: BuildOptions,
): DetailVariant {
  const detail = meta.details.find((d) => d.id === detailId);
  const old = detail?.variants.find((v) => v.id === variantId);
  if (detail == null || old == null) {
    throw new Error("That detail is not in this profile.");
  }
  const corrected = newVariant(
    value.trim(),
    { script: old.script, tag: old.tag, origin: "correction", sourceId: null, verified: false },
    options,
  );
  retire(detail, old, "correction", options);
  detail.variants.push(corrected);
  detail.chosenVariantId = corrected.id;
  settleSources(meta);
  return corrected;
}

/** Sets the person's choice among a detail's current values. */
export function chooseVariant(meta: VkMetaV1, detailId: string, variantId: string): void {
  const detail = meta.details.find((d) => d.id === detailId);
  if (detail == null || !detail.variants.some((v) => v.id === variantId && v.current)) {
    throw new Error("That value is not a current one of this detail.");
  }
  detail.chosenVariantId = variantId;
}

/** Dismissing an alternative moves it to history. */
export function dismissVariant(
  meta: VkMetaV1,
  detailId: string,
  variantId: string,
  options?: BuildOptions,
): void {
  const detail = meta.details.find((d) => d.id === detailId);
  const variant = detail?.variants.find((v) => v.id === variantId);
  if (detail == null || variant == null) {
    throw new Error("That detail is not in this profile.");
  }
  retire(detail, variant, "dismissed", options);
  settleSources(meta);
}

/** Removes a detail altogether. Its projected field goes with it when the profile is saved. */
export function deleteDetail(meta: VkMetaV1, detailId: string): void {
  meta.details = meta.details.filter((d) => d.id !== detailId);
  settleSources(meta);
}

/** Adds a detail the person typed, with a label of their own and no vocabulary key. */
export function addTypedDetail(
  meta: VkMetaV1,
  input: { attribute?: string | null; label: string; value: string; valueType?: ValueType },
  options?: BuildOptions,
): ProfileDetail {
  const detail = newDetail(input.attribute ?? null, input.label, options);
  if (input.valueType != null) {
    detail.valueType = input.valueType;
  }
  const variant = newVariant(input.value.trim(), { origin: "typed" }, options);
  detail.variants.push(variant);
  detail.chosenVariantId = variant.id;
  meta.details.push(detail);
  return detail;
}

export function setAgentRule(meta: VkMetaV1, detailId: string, rule: AgentRule): void {
  const detail = meta.details.find((d) => d.id === detailId);
  if (detail == null) {
    throw new Error("That detail is not in this profile.");
  }
  detail.agentRule = rule;
}

/** A detail with no rule reads as Ask first. */
export function agentRuleOf(detail: ProfileDetail): AgentRule {
  return detail.agentRule === "fill" || detail.agentRule === "never" ? detail.agentRule : "ask";
}

export interface LearnedDocumentLabel {
  attribute: string | null;
  label: string;
}

const LEARNED_DOC_LABELS_KEY = "vowkey_learned_doc_labels_v1";

function normalizeLearnedKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Remembers how a person classified a captured document label so future captures reuse it. */
export function rememberDocumentLabel(
  fromKeyOrLabel: string,
  target: LearnedDocumentLabel,
): void {
  const key = normalizeLearnedKey(fromKeyOrLabel);
  if (!key || !target.label.trim()) {
    return;
  }
  try {
    const raw = globalThis.localStorage?.getItem(LEARNED_DOC_LABELS_KEY);
    const map: Record<string, LearnedDocumentLabel> = raw ? JSON.parse(raw) : {};
    map[key] = { attribute: target.attribute, label: target.label.trim() };
    globalThis.localStorage?.setItem(LEARNED_DOC_LABELS_KEY, JSON.stringify(map));
  } catch {
    // Storage may be unavailable in headless unit tests.
  }
}

export function resolveLearnedDocumentLabel(keyOrLabel: string): LearnedDocumentLabel | null {
  const key = normalizeLearnedKey(keyOrLabel);
  if (!key) {
    return null;
  }
  try {
    const raw = globalThis.localStorage?.getItem(LEARNED_DOC_LABELS_KEY);
    if (!raw) {
      return null;
    }
    const map = JSON.parse(raw) as Record<string, LearnedDocumentLabel>;
    return map[key] ?? null;
  } catch {
    return null;
  }
}

/**
 * Re-labels a detail (teaching Vowkey which canonical attribute it belongs to) and remembers
 * the mapping for future document captures.
 */
export function relabelDetail(
  meta: VkMetaV1,
  detailId: string,
  attribute: string | null,
  label: string,
): void {
  const detail = meta.details.find((d) => d.id === detailId);
  if (detail == null) {
    throw new Error("That detail is not in this profile.");
  }
  const nextAttr = attribute?.trim() ? canonicalAttribute(attribute.trim()) : null;
  const nextLabel = label.trim() || nextAttr || detail.label;
  if (detail.attribute) {
    rememberDocumentLabel(detail.attribute, { attribute: nextAttr, label: nextLabel });
  }
  if (detail.label) {
    rememberDocumentLabel(detail.label, { attribute: nextAttr, label: nextLabel });
  }
  const existing =
    nextAttr != null
      ? meta.details.find((d) => d.id !== detailId && d.attribute === nextAttr)
      : undefined;
  if (existing != null) {
    for (const variant of detail.variants) {
      if (!existing.variants.some((v) => v.current && sameValue(v.value, variant.value))) {
        existing.variants.push(variant);
      }
    }
    existing.history.push(...detail.history);
    existing.chosenVariantId =
      detail.chosenVariantId ?? detail.variants.find((v) => v.current)?.id ?? existing.chosenVariantId;
    meta.details = meta.details.filter((d) => d.id !== detailId);
  } else {
    detail.attribute = nextAttr;
    detail.label = nextLabel;
    detail.valueType = valueTypeOf(nextAttr);
  }
  settleSources(meta);
}

// ---- sources ----------------------------------------------------------------------------------

export function attachSourceBytes(meta: VkMetaV1, sourceId: string, attachmentId: string): void {
  const source = sourceOf(meta, sourceId);
  if (source == null) {
    throw new Error("That document is not in this profile.");
  }
  source.attachmentId = attachmentId;
}

/**
 * Deleting a document removes its bytes. The source id stays, its details and their history stay
 * usable, and they show that the document is gone.
 */
export function markSourceDeleted(meta: VkMetaV1, sourceId: string): void {
  const source = sourceOf(meta, sourceId);
  if (source == null) {
    return;
  }
  source.status = "deleted";
  source.attachmentId = null;
}

// ---- legacy profiles and the fields fillers read ---------------------------------------------------

function identityValue(cipher: CipherView, wire: IdentityWireKey): string {
  const value = (cipher.identity as unknown as Record<string, string | undefined> | undefined)?.[
    wire
  ];
  return typeof value === "string" ? value : "";
}

/**
 * Builds the envelope of a profile that has none, from its Identity fields and its Text custom
 * fields. Each distinct detail becomes one detail id; a script suffix becomes a variant of the
 * unsuffixed detail; two fields that collapse to one detail with different values become two
 * current variants.
 */
export function buildEnvelopeFromLegacy(cipher: CipherView, options?: BuildOptions): VkMetaV1 {
  const meta = newEnvelope(cipher.id ?? "");
  const add = (key: string, value: string) => {
    const { attribute, script, tag } = splitKey(key);
    let detail = findDetail(meta, attribute);
    if (detail == null) {
      detail = newDetail(attribute, options?.labelOf?.(attribute) ?? attribute, options);
      meta.details.push(detail);
    }
    if (
      detail.variants.some((v) => v.script === script && v.tag === tag && sameValue(v.value, value))
    ) {
      return;
    }
    detail.variants.push(
      newVariant(value.trim(), { script, tag, origin: tag != null ? "derived" : "typed" }, options),
    );
  };

  for (const [wire, attribute] of IDENTITY_ATTRIBUTES) {
    const value = identityValue(cipher, wire).trim();
    if (value !== "") {
      add(attribute, value);
    }
  }
  for (const field of cipher.fields ?? []) {
    if (
      field.type === FieldType.Text &&
      field.name &&
      field.name !== VK_META_FIELD &&
      field.value
    ) {
      add(field.name, field.value);
    }
  }
  for (const detail of meta.details) {
    detail.chosenVariantId = resolveDetailVariant(meta, detail)?.id ?? null;
  }
  return meta;
}

export interface Projection {
  /** The Identity item's own fields, by wire key. */
  identity: Partial<Record<IdentityWireKey, string>>;
  /** Text custom fields by stored name, so a filler that reads them by name still finds them. */
  text: Map<string, string>;
}

/**
 * The fields current fillers read, taken from the envelope. A secret value is not copied into a
 * visible field. A companion format that is recomputed from its primary value is not stored.
 */
export function projectEnvelope(meta: VkMetaV1): Projection {
  const identity: Projection["identity"] = {};
  const text = new Map<string, string>();
  for (const detail of meta.details) {
    if (detail.agentRule == null) {
      detail.agentRule = agentRuleOf(detail);
    }
    if (detail.valueType === "secret") {
      continue;
    }
    const native = IDENTITY_ATTRIBUTES.find(([, attribute]) => attribute === detail.attribute);
    const winner =
      native != null
        ? projectedIdentityVariant(meta, detail, native[0])
        : resolveDetailVariant(meta, detail);
    if (native != null && winner != null) {
      identity[native[0]] = winner.value;
    }
    for (const variant of detail.variants) {
      if (!variant.current || variant.origin === "derived") {
        continue;
      }
      const name =
        detail.attribute != null
          ? joinKey(detail.attribute, variant.script, variant.tag)
          : detail.label;
      // Where two current values of one slot compete, the stored name holds the one fill writes.
      const rival = slot(detail, variant.script, variant.tag);
      const holder = winnerAmong(meta, detail, rival);
      if (holder?.id === variant.id) {
        text.set(name, variant.value);
      }
    }
  }
  return { identity, text };
}

/** Writes the projection into the Identity item and its Text custom fields. */
export function applyProjection(
  cipher: CipherView,
  projection: Projection,
  previousNames: Iterable<string> = [],
): void {
  const identity = cipher.identity as unknown as Record<string, string | undefined>;
  if (identity != null) {
    for (const [wire] of IDENTITY_ATTRIBUTES) {
      identity[wire] = projection.identity[wire] || undefined;
    }
  }
  cipher.fields ??= [];
  const stale = new Set(previousNames);
  cipher.fields = cipher.fields.filter(
    (f) =>
      f.name === VK_META_FIELD ||
      f.type !== FieldType.Text ||
      !(stale.has(f.name ?? "") && !projection.text.has(f.name ?? "")),
  );
  for (const [name, value] of projection.text) {
    const existing = cipher.fields.find((f) => f.type === FieldType.Text && f.name === name);
    if (existing != null) {
      existing.value = value;
    } else {
      const field = new FieldView();
      field.name = name;
      field.value = value;
      field.type = FieldType.Text;
      cipher.fields.push(field);
    }
  }
}

/**
 * The first envelope-aware save of a profile that has none. The named fields become details and
 * go away as named fields; the projection of the new envelope takes their place.
 */
export function migrateLegacyProfile(cipher: CipherView, options?: BuildOptions): VkMetaV1 {
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    throw new Error(
      "This profile's details were written by a newer version and are left as they are.",
    );
  }
  const existing = readEnvelope(cipher);
  if (existing != null) {
    stampAgentRules(existing);
    if (cipher.id) {
      existing.profileId = cipher.id;
    }
    return existing;
  }
  const meta = buildEnvelopeFromLegacy(cipher, options);
  const legacyNames = (cipher.fields ?? [])
    .filter((f) => f.type === FieldType.Text && f.name && f.name !== VK_META_FIELD)
    .map((f) => f.name!);
  writeEnvelope(cipher, meta);
  applyProjection(cipher, projectEnvelope(meta), legacyNames);
  return meta;
}

function stampAgentRules(meta: VkMetaV1): void {
  for (const detail of meta.details) {
    if (detail.agentRule == null) {
      detail.agentRule = "ask";
    }
  }
}

/**
 * Takes in edits made to the projected fields by a screen that does not know the envelope. A
 * changed value is a correction: the old value stays in history. A field the envelope does not have
 * is a typed detail. Carrying the envelope in a Hidden field is never itself a change.
 */
export function reconcileProjection(
  cipher: CipherView,
  meta: VkMetaV1,
  options?: BuildOptions,
): number {
  const expected = projectEnvelope(meta);
  const seen = new Set<string>();
  let changes = 0;
  for (const field of cipher.fields ?? []) {
    if (
      field.type !== FieldType.Text ||
      !field.name ||
      field.name === VK_META_FIELD ||
      !field.value
    ) {
      continue;
    }
    const known = expected.text.get(field.name);
    if (known === field.value) {
      continue;
    }
    seen.add(splitKey(field.name).attribute);
    const { attribute, script, tag } = splitKey(field.name);
    const detail = findDetail(meta, attribute);
    if (detail == null) {
      const created = newDetail(attribute, options?.labelOf?.(attribute) ?? attribute, options);
      created.variants.push(
        newVariant(field.value.trim(), { script, tag, origin: "typed" }, options),
      );
      created.chosenVariantId = created.variants[0].id;
      meta.details.push(created);
      changes++;
      continue;
    }
    const target = winnerAmong(meta, detail, slot(detail, script, tag));
    if (target == null) {
      detail.variants.push(
        newVariant(field.value.trim(), { script, tag, origin: "typed" }, options),
      );
    } else {
      correctVariant(meta, detail.id, target.id, field.value, options);
    }
    changes++;
  }
  // An Identity field edited directly is a correction of the variant that field projects.
  for (const [wire, attribute] of IDENTITY_ATTRIBUTES) {
    const detail = findDetail(meta, attribute);
    const winner = detail != null ? projectedIdentityVariant(meta, detail, wire) : null;
    const value = identityValue(cipher, wire).trim();
    const projected = expected.identity[wire] ?? "";
    if (
      detail != null &&
      winner != null &&
      value !== "" &&
      value !== projected &&
      !seen.has(attribute)
    ) {
      correctVariant(meta, detail.id, winner.id, value, options);
      changes++;
    }
  }
  return changes;
}

// ---- references ---------------------------------------------------------------------------------------

export interface ResolvedProfileReference {
  fieldPath: string;
  value: string;
  agentRule: AgentRule;
  profileId: string;
}

export class ProfileMigrationRequiredError extends Error {
  constructor() {
    super("migration-required");
    this.name = "ProfileMigrationRequiredError";
  }
}

/**
 * Reads only persisted stable ids. A legacy identity must first be saved through its authorized
 * writer; this resolver never migrates a read-only item or mints ephemeral grant ids.
 */
export function resolveProfileReference(
  cipher: CipherView,
  fieldPath: string,
  options: { forDisplay?: boolean } = {},
): ResolvedProfileReference | null {
  if (cipher.type !== CipherType.Identity || cipher.isDeleted) {
    return null;
  }
  const meta = readEnvelope(cipher);
  if (meta == null) {
    if (envelopeState(cipher) === "none" && /^(identity|field)\./.test(fieldPath)) {
      throw new ProfileMigrationRequiredError();
    }
    return null;
  }
  if (meta.status !== "confirmed") {
    return null;
  }
  let detail: ProfileDetail | undefined;
  let variant: DetailVariant | null | undefined;
  const detailPath = /^detail\.([^.]+)(?:\.([^.]+))?$/.exec(fieldPath);
  const identityPath = /^identity\.(.+)$/.exec(fieldPath);
  if (detailPath != null) {
    detail = meta.details.find((candidate) => candidate.id === detailPath[1]);
    if (detail != null) {
      variant = detailPath[2] != null
        ? detail.variants.find((candidate) => candidate.id === detailPath[2] && candidate.current)
        : resolveDetailVariant(meta, detail);
    }
  } else if (identityPath != null) {
    const native = IDENTITY_ATTRIBUTES.find(([wire]) => wire === identityPath[1]);
    if (native != null) {
      detail = meta.details.find((candidate) => candidate.attribute === native[1]);
      variant = detail != null ? projectedIdentityVariant(meta, detail, native[0]) : null;
    }
  }
  if (detail == null || variant == null ||
    (options.forDisplay && detail.valueType === "secret" && cipher.viewPassword === false)) {
    return null;
  }
  return {
    fieldPath: `detail.${detail.id}.${variant.id}`,
    value: variant.value,
    agentRule: agentRuleOf(detail),
    profileId: cipher.id || meta.profileId,
  };
}

/** The authorized writer persists this migration before using the returned stable path. */
export function migrateLegacyProfileReference(cipher: CipherView, fieldPath: string): string | null {
  if (envelopeState(cipher) !== "none") {
    return resolveProfileReference(cipher, fieldPath)?.fieldPath ?? null;
  }
  const legacyName = /^field\.(.+)$/.exec(fieldPath)?.[1];
  const original = legacyName == null ? [] :
    (cipher.fields ?? []).filter((field) => field.name === legacyName && field.type === FieldType.Text);
  if (legacyName != null && (legacyName === VK_META_FIELD || original.length !== 1)) {
    return null;
  }
  const meta = migrateLegacyProfile(cipher);
  if (legacyName == null) {
    return resolveProfileReference(cipher, fieldPath)?.fieldPath ?? null;
  }
  const { attribute, script, tag } = splitKey(legacyName);
  const details = meta.details.filter((detail) => detail.attribute === attribute ||
    (detail.attribute == null && detail.label === legacyName));
  if (details.length !== 1) {
    return null;
  }
  const detail = details[0];
  const variant = winnerAmong(meta, detail, slot(detail, script, tag)
    .filter((candidate) => candidate.value === original[0].value?.trim()));
  return variant == null ? null : `detail.${detail.id}.${variant.id}`;
}

/** Resolves saved values for fill. Display/copy callers opt into password visibility policy. */
export function resolveEnvelopePath(
  cipher: CipherView,
  fieldPath: string,
  forDisplay = false,
): string | null {
  return resolveProfileReference(cipher, fieldPath, { forDisplay })?.value ?? null;
}


/** The detail references a profile offers, by id: what a tool lists instead of `field.<name>`. */
export function detailDescriptors(
  meta: VkMetaV1,
): { detailId: string; label: string; attribute: string | null }[] {
  if (meta.status !== "confirmed") {
    return [];
  }
  return meta.details.map((d) => ({ detailId: d.id, label: d.label, attribute: d.attribute }));
}

/**
 * An authorized save of a type 4 profile. A malformed or newer envelope is left untouched. A
 * profile with none is migrated. Edits a screen made to the projected fields become corrections,
 * a missing agent rule is written as Ask first, and `profileId` becomes the cipher id without
 * minting new detail ids. Returns the envelope that was written, or null when nothing was written.
 */
export function prepareProfileSave(cipher: CipherView, options?: BuildOptions): VkMetaV1 | null {
  if (cipher.type !== CipherType.Identity) {
    return null;
  }
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    return null;
  }
  const meta = migrateLegacyProfile(cipher, options);
  reconcileProjection(cipher, meta, options);
  stampAgentRules(meta);
  if (cipher.id) {
    meta.profileId = cipher.id;
  }
  const previous = (cipher.fields ?? [])
    .filter((f) => f.type === FieldType.Text && f.name)
    .map((f) => f.name!);
  writeEnvelope(cipher, meta);
  applyProjection(cipher, projectEnvelope(meta), previous);
  return meta;
}

/**
 * A clone of a profile. The copy gets new profile, detail, variant, source and history ids so it
 * does not follow the original's references. Share and a collection move do not call this: they
 * keep the cipher id and the inner ids. Returns null when the envelope cannot be rewritten.
 */
export function cloneProfileEnvelope(cipher: CipherView, options?: BuildOptions): VkMetaV1 | null {
  const meta = readEnvelope(cipher);
  if (meta == null) {
    return null;
  }
  const next = ids(options);
  const detailIds = new Map(meta.details.map((d) => [d.id, next()]));
  const variantIds = new Map<string, string>();
  const sourceIds = new Map(meta.sources.map((s) => [s.id, next()]));
  const remapVariant = (variant: DetailVariant): DetailVariant => {
    let id = variantIds.get(variant.id);
    if (id == null) {
      id = next();
      variantIds.set(variant.id, id);
    }
    return {
      ...variant,
      id,
      sourceId: variant.sourceId != null ? (sourceIds.get(variant.sourceId) ?? null) : null,
    };
  };
  const cloned: VkMetaV1 = {
    ...meta,
    profileId: "",
    details: meta.details.map<ProfileDetail>((detail) => ({
      ...detail,
      id: detailIds.get(detail.id)!,
      variants: detail.variants.map(remapVariant),
      history: detail.history.map((entry) => ({ ...entry, variant: remapVariant(entry.variant) })),
      chosenVariantId: null,
    })),
    sources: meta.sources.map<ProfileSource>((source) => ({
      ...source,
      id: sourceIds.get(source.id)!,
      // The clone does not copy attachment bytes, so it does not claim the original's.
      attachmentId: null,
    })),
  };
  cloned.details.forEach((detail, index) => {
    const original = meta.details[index].chosenVariantId;
    detail.chosenVariantId = original != null ? (variantIds.get(original) ?? null) : null;
  });
  cipher.id = undefined;
  writeEnvelope(cipher, cloned);
  return cloned;
}


/**
 * Copies one document onto the destination profile under a new source id. Locators that named the
 * origin source now name the new one. The origin envelope is not changed here.
 */
export function copySourceToProfile(
  destination: VkMetaV1,
  origin: VkMetaV1,
  originSourceId: string,
  destinationSourceId: string,
  attachmentId: string | null,
): void {
  const originSource = sourceOf(origin, originSourceId);
  if (originSource == null) {
    throw new Error("That document is not in this profile.");
  }
  if (destination.sources.some((source) => source.id === destinationSourceId)) {
    return;
  }
  destination.sources.push({ ...originSource, id: destinationSourceId, attachmentId });
  for (const detail of origin.details) {
    const moving = detail.variants.filter((variant) => variant.sourceId === originSourceId);
    const history = detail.history.filter((entry) => entry.variant.sourceId === originSourceId);
    if (moving.length === 0 && history.length === 0) {
      continue;
    }
    let target = detail.attribute != null ? findDetail(destination, detail.attribute) : undefined;
    if (target == null) {
      target = { ...detail, id: ids()(), variants: [], history: [], chosenVariantId: null };
      destination.details.push(target);
    }
    for (const variant of moving) {
      const copied = { ...variant, id: ids()(), sourceId: destinationSourceId };
      target.variants.push(copied);
      if (variant.id === detail.chosenVariantId && target.chosenVariantId == null) {
        target.chosenVariantId = copied.id;
      }
    }
    target.history.push(...history.map((entry) => ({
      ...entry,
      variant: { ...entry.variant, id: ids()(), sourceId: destinationSourceId },
    })));
  }
}
