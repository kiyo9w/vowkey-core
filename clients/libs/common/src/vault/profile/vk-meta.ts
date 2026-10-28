import { Utils } from "../../platform/misc/utils";
import { FieldType } from "../enums";
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
  const field = metaField(cipher);
  if (field?.value == null || field.value === "") {
    return "none";
  }
  try {
    const parsed = JSON.parse(field.value) as { v?: unknown };
    if (parsed == null || typeof parsed !== "object") {
      return "unreadable";
    }
    return parsed.v === 1 ? "v1" : "unsupported";
  } catch {
    return "unreadable";
  }
}

/** The profile envelope of an Identity item, or null when it has none this version can write. */
export function readEnvelope(cipher: CipherView): VkMetaV1 | null {
  if (envelopeState(cipher) !== "v1") {
    return null;
  }
  const parsed = JSON.parse(metaField(cipher)!.value!) as Partial<VkMetaV1>;
  if (!Array.isArray(parsed.details) || !Array.isArray(parsed.sources)) {
    return null;
  }
  return parsed as VkMetaV1;
}

/** Stores the envelope. Refuses to overwrite one it does not understand. */
export function writeEnvelope(cipher: CipherView, meta: VkMetaV1): void {
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    throw new Error(
      "This profile's details were written by a newer version and are left as they are.",
    );
  }
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
  if (envelopeState(cipher) !== "v1") {
    return null;
  }
  const parsed = JSON.parse(metaField(cipher)!.value!) as ProfileRefMeta;
  return parsed.profileRef?.cipherId ?? null;
}

/** Links an item to a profile, or clears the link. Nothing but the id is stored. */
export function setProfileRef(cipher: CipherView, cipherId: string | null): void {
  const state = envelopeState(cipher);
  if (state === "unsupported" || state === "unreadable") {
    throw new Error("This item's link was written by a newer version and is left as it is.");
  }
  const meta: ProfileRefMeta =
    state === "v1" ? (JSON.parse(metaField(cipher)!.value!) as ProfileRefMeta) : { v: 1 };
  meta.profileRef = cipherId == null ? null : { cipherId };
  setMetaValue(cipher, JSON.stringify(meta));
}

/**
 * Whether fill may use a linked profile: the profile exists, is not in the trash and is
 * confirmed. A draft, a missing or an unreadable profile leaves the link unavailable and never
 * falls back to the account owner's details.
 */
export function profileUsableForFill(profile: CipherView | null | undefined): boolean {
  if (profile == null || profile.isDeleted) {
    return false;
  }
  const envelope = readEnvelope(profile);
  return envelope == null || envelope.status === "confirmed";
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

/** The value a detail stands for with no variant named: Latin when there is one, else the plain one. */
export function resolveDetailVariant(meta: VkMetaV1, detail: ProfileDetail): DetailVariant | null {
  const current = detail.variants.filter((v) => v.current && v.tag == null);
  const chosen = current.find((v) => v.id === detail.chosenVariantId);
  if (chosen != null) {
    return chosen;
  }
  for (const script of ["Latn", null] as const) {
    const found = winnerAmong(
      meta,
      detail,
      current.filter((v) => v.script === script),
    );
    if (found != null) {
      return found;
    }
  }
  return winnerAmong(meta, detail, current);
}

/** The other current values of the winner's slot, for the marker beside a filled field. */
export function alternativesOf(meta: VkMetaV1, detail: ProfileDetail): DetailVariant[] {
  const winner = resolveDetailVariant(meta, detail);
  if (winner == null) {
    return [];
  }
  return slot(detail, winner.script, winner.tag).filter((v) => v.id !== winner.id);
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
    const { attribute, script, tag } = splitKey(captured.key);
    const value = captured.value.trim();
    if (value === "") {
      continue;
    }
    let detail = findDetail(meta, attribute);
    detail ??= (() => {
      const created = newDetail(attribute, options?.labelOf?.(attribute) ?? attribute, options);
      meta.details.push(created);
      return created;
    })();

    const same = slot(detail, script, tag);
    if (same.some((v) => sameValue(v.value, value))) {
      // Already known. A value without a place on any document takes this one's.
      const known = same.find((v) => sameValue(v.value, value))!;
      if (known.sourceId == null) {
        known.sourceId = sourceId;
        known.locator = captured.locator ?? null;
        known.verified = captured.verified;
        known.origin = captured.origin;
      }
      continue;
    }

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
    changed.push(captured.key);
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
    if (detail.valueType === "secret") {
      continue;
    }
    const winner = resolveDetailVariant(meta, detail);
    const native = IDENTITY_ATTRIBUTES.find(([, attribute]) => attribute === detail.attribute);
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
    seen.add(field.name);
    const known = expected.text.get(field.name);
    if (known === field.value) {
      continue;
    }
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
  // A Latin-preferred Identity field edited directly is a correction of the detail it holds.
  for (const [wire, attribute] of IDENTITY_ATTRIBUTES) {
    const detail = findDetail(meta, attribute);
    const winner = detail != null ? resolveDetailVariant(meta, detail) : null;
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

/**
 * Resolves `detail.<detailId>`, `detail.<detailId>.<variantId>` and, for a profile with an
 * envelope, `identity.<wireKey>` to the exact value fill writes. Returns null when it does not
 * resolve; a deleted detail resolves to nothing.
 */
export function resolveEnvelopePath(cipher: CipherView, fieldPath: string): string | null {
  const meta = readEnvelope(cipher);
  if (meta == null) {
    return null;
  }
  const detailPath = /^detail\.([^.]+)(?:\.([^.]+))?$/.exec(fieldPath);
  if (detailPath != null) {
    const detail = meta.details.find((d) => d.id === detailPath[1]);
    if (detail == null) {
      return null;
    }
    const variant =
      detailPath[2] != null
        ? detail.variants.find((v) => v.id === detailPath[2])
        : resolveDetailVariant(meta, detail);
    return variant?.value ?? null;
  }
  const identityPath = /^identity\.(.+)$/.exec(fieldPath);
  if (identityPath != null) {
    const native = IDENTITY_ATTRIBUTES.find(([wire]) => wire === identityPath[1]);
    const detail = native != null ? findDetail(meta, native[1]) : undefined;
    return detail != null ? (resolveDetailVariant(meta, detail)?.value ?? null) : null;
  }
  return null;
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
