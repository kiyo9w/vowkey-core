import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { FormBindingV1 } from "@vowkey/common/vault/agent/account-records";
import { AgentField, AgentTarget } from "@vowkey/common/vault/agent/targets";
import { requestHash } from "@vowkey/common/vault/local/canonical-json";
import { LocalVaultService } from "@vowkey/common/vault/local/local-vault.service";
import {
  DecisionRequest,
  ProductInference,
} from "@vowkey/common/vault/local/product-inference";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { chooseDetails, chooseHeldAttributes } from "@vowkey/common/vault/profile/decision-choices";
import { fillableProfileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import { agentRuleOf, readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
import * as sdkInternal from "@vowkey/sdk-internal";
import {
  ChosenField,
  FieldMatch,
  FormFieldInput,
  ProfileFields,
  detail_label,
  fill_fields_from_profile,
  fill_form_with_profile,
  profile_details,
} from "@vowkey/sdk-internal";

import AutofillField from "../models/autofill-field";

export type ProfileDetailOption = {
  key: string;
  label: string;
  value: string;
};

const FORM_BINDINGS_STORAGE_KEY = "vowkeyFormBindings";
const SEALED_BINDINGS_PURPOSE = "form-bindings-v1";
const INFERENCE_TIMEOUT_MS = 2500;

const memoryFormBindings = new Map<string, FormBindingV1>();
const inferenceChoiceCache = new Map<string, ChosenField[]>();
const describeFormCache = new Map<
  string,
  Promise<Awaited<ReturnType<ProductInference["describe"]>>>
>();

let configuredLocalVault: LocalVaultService | null = null;
let configuredProductInference: ProductInference | null = null;

export function configureAutofillDetailEngine(deps: {
  localVaultService?: LocalVaultService | null;
  productInference?: ProductInference | null;
}): void {
  if (deps.localVaultService !== undefined) {
    configuredLocalVault = deps.localVaultService;
  }
  if (deps.productInference !== undefined) {
    configuredProductInference = deps.productInference;
  }
}

const EPHEMERAL_ID_PATTERNS: readonly RegExp[] = [
  /^:[a-z0-9_-]+:$/i,
  /:r[a-z0-9_-]+:/i,
  /^_r_[a-z0-9_]*$/i,
  /(?:^|[-_:])_r_[a-z0-9_]+/i,
  /^«r[a-z0-9_-]+»$/i,
  /^radix-/i,
  /^headlessui-/i,
  /^mui-[0-9]+/i,
  /^react-select-/i,
  /^rc_select_/i,
  /^downshift-/i,
  /^mat-(?:input|select|form-field-label)-[0-9]+/i,
  /^cdk-/i,
  /^ember[0-9]+$/i,
  /^el-id-[0-9-]+$/i,
  /^v-[0-9a-f-]+$/i,
  /^[0-9]+$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{10,}$/i,
  /(?:^|[-_])[0-9a-f]{10,}$/i,
];

/** Strips ephemeral framework-generated IDs (`_r_...`, `:r0:`, `radix-...`, UUIDs, random hashes). */
export function stabilizeFieldIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  for (const pattern of EPHEMERAL_ID_PATTERNS) {
    if (pattern.test(trimmed)) {
      return "";
    }
  }
  return trimmed.normalize("NFKC").replace(/\s+/g, " ");
}

function normalizeLabelText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** The printed words that name a field: its label, however the page attaches it, and its title. */
function labelOf(field: Record<string, unknown>): string {
  const isRadio = typeof field.type === "string" && field.type.toLowerCase() === "radio";
  if (isRadio) {
    const groupLabel =
      typeof field.radioGroupLabel === "string" ? normalizeLabelText(field.radioGroupLabel) : "";
    const optionLabel =
      typeof field.radioOptionLabel === "string" ? normalizeLabelText(field.radioOptionLabel) : "";
    if (groupLabel) {
      const contextual = [
        groupLabel,
        field["label-row"],
        field["label-left"],
        field["label-top"],
        field.title,
      ]
        .filter((word): word is string => typeof word === "string" && word.trim() !== "")
        .map((word) => normalizeLabelText(word))
        .filter((word) => word !== "" && word !== optionLabel);
      return [...new Set(contextual)].join(" ");
    }
  }
  const words = [field["label-tag"], field["label-aria"]].filter(
    (word): word is string => typeof word === "string" && word.trim() !== "",
  );
  if (words.length > 0) {
    return [...new Set(words.map((word) => normalizeLabelText(word)))].join(" ");
  }
  for (const key of ["label-row", "label-left", "label-top", "title"]) {
    const value = field[key];
    if (typeof value === "string" && value.trim() !== "") {
      return normalizeLabelText(value);
    }
  }
  return "";
}

const SEARCH_EXACT_TOKENS = new Set([
  "q",
  "s",
  "search",
  "searchbox",
  "searchinput",
  "searchquery",
  "site-search",
  "sitesearch",
  "global-search",
  "globalsearch",
]);

const SEARCH_OR_CHAT_SUBSTRINGS = [
  "site search",
  "search site",
  "search the web",
  "search products",
  "search articles",
  "search docs",
  "search documentation",
  "type a message",
  "write a message",
  "send a message",
  "ask anything",
  "chat input",
  "キーワード検索",
  "サイト内検索",
  "tìm kiếm",
];

function isSearchOrChatField(rawField: unknown, input: FormFieldInput): boolean {
  const type = input.input_type.toLowerCase();
  if (type === "search") {
    return true;
  }
  const record =
    rawField != null && typeof rawField === "object"
      ? (rawField as Record<string, unknown>)
      : {};
  const role = typeof record.role === "string" ? record.role.trim().toLowerCase() : "";
  if (role === "search" || role === "searchbox") {
    return true;
  }
  const stableId = stabilizeFieldIdentifier(input.id).toLowerCase();
  const stableName = stabilizeFieldIdentifier(input.name).toLowerCase();
  if (SEARCH_EXACT_TOKENS.has(stableId) || SEARCH_EXACT_TOKENS.has(stableName)) {
    return true;
  }
  const combined = `${stableId} ${stableName} ${input.label} ${input.placeholder}`.toLowerCase();
  if (/\b(?:site[-_ ]?search|search[-_ ]?(?:box|bar|query|input|term)|chat[-_ ]?(?:box|input|message))\b/.test(combined)) {
    return true;
  }
  if (/^\s*(?:search|検索|tìm kiếm|검색|搜索)(?:\s*\.\.\.|…)?\s*$/i.test(input.label || input.placeholder)) {
    return true;
  }
  return SEARCH_OR_CHAT_SUBSTRINGS.some((phrase) => combined.includes(phrase));
}

function formFieldOf(input: unknown): FormFieldInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid form field metadata");
  }
  const field = input as Record<string, unknown>;
  const text = (key: string): string => (typeof field[key] === "string" ? field[key] : "");
  const dataset = text("dataSetValues").toLowerCase();
  const tag = text("tagName").toLowerCase();
  const result: FormFieldInput = {
    id: stabilizeFieldIdentifier(text("htmlID")),
    name: stabilizeFieldIdentifier(text("htmlName")),
    label: labelOf(field),
    placeholder: normalizeLabelText(text("placeholder")),
    autocomplete: text("autoCompleteType").trim(),
    input_type:
      text("type") || (tag === "select" ? "select-one" : tag === "textarea" ? "textarea" : "text"),
    section: stabilizeFieldIdentifier(text("section")),
    form: stabilizeFieldIdentifier(text("form")),
    pattern: text("pattern"),
    max_length:
      typeof field.maxLength === "number" &&
      Number.isInteger(field.maxLength) &&
      field.maxLength > 0 &&
      field.maxLength < 999
        ? field.maxLength
        : 0,
    format: "",
    op_ignore: dataset.includes("opignore: true") || dataset.includes("op-ignore: true"),
  };
  return result;
}

/** Computes a non-empty stable section identifier consistent across single-field and whole-form fills. */
export function webSectionId(field: AutofillField, _pageFields?: AutofillField[]): string {
  const section =
    typeof field.section === "string" ? stabilizeFieldIdentifier(field.section) : "";
  if (section) {
    return section.slice(0, 512);
  }
  const form = typeof field.form === "string" ? stabilizeFieldIdentifier(field.form) : "";
  if (form) {
    return `form:${form.slice(0, 500)}`;
  }
  return "default";
}

function fieldDescriptorTuple(field: AutofillField, pageFields?: AutofillField[]) {
  const input = formFieldOf(field);
  const tagName = typeof field.tagName === "string" ? field.tagName.toLowerCase() : "";
  const sectionId = webSectionId(field, pageFields);
  return {
    tagName,
    inputType: input.input_type.toLowerCase(),
    name: input.name,
    id: input.name || input.label ? "" : input.id,
    autocomplete: input.autocomplete.toLowerCase(),
    sectionId,
    label: input.label,
    placeholder: input.label ? "" : input.placeholder,
  };
}

function computeFieldOrdinal(field: AutofillField, pageFields?: AutofillField[]): number {
  if (!pageFields || pageFields.length <= 1) {
    return 0;
  }
  const target = fieldDescriptorTuple(field, pageFields);
  let ordinal = 0;
  for (const candidate of pageFields) {
    if (
      candidate === field ||
      (field.opid && candidate.opid === field.opid)
    ) {
      break;
    }
    const desc = fieldDescriptorTuple(candidate, pageFields);
    if (
      desc.sectionId === target.sectionId &&
      desc.tagName === target.tagName &&
      desc.inputType === target.inputType &&
      desc.name === target.name &&
      desc.id === target.id &&
      desc.autocomplete === target.autocomplete &&
      desc.label === target.label &&
      desc.placeholder === target.placeholder
    ) {
      ordinal += 1;
    }
  }
  return ordinal;
}

/** Computes the stable form signature for a field on a page. */
export async function webFormSignature(
  pageUrl: string,
  field: AutofillField,
  _pageFields?: AutofillField[],
): Promise<string> {
  let origin = "";
  let pathname = pageUrl;
  try {
    const parsed = new URL(pageUrl);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } catch {
    // Use raw pageUrl when it is not a full URL.
  }
  const stableForm = typeof field.form === "string" ? stabilizeFieldIdentifier(field.form) : "";
  return requestHash({
    origin,
    pathname,
    form: stableForm,
  });
}

/** Computes the stable field signature for a form field, stripping ephemeral framework IDs. */
export async function webFieldSignature(
  field: AutofillField,
  pageFields?: AutofillField[],
): Promise<string> {
  const descriptor = fieldDescriptorTuple(field, pageFields);
  const ordinal = computeFieldOrdinal(field, pageFields);
  return requestHash({
    ...descriptor,
    ordinal,
  });
}

type StoredSealedEnvelope = {
  v: 1;
  sealed: string;
};

function isSealedEnvelope(value: unknown): value is StoredSealedEnvelope {
  return (
    value != null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).v === 1 &&
    typeof (value as Record<string, unknown>).sealed === "string"
  );
}

async function writeStoredFormBindings(bindings: Record<string, FormBindingV1>): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return;
  }
  if (configuredLocalVault != null) {
    try {
      const sealed = await configuredLocalVault.seal(
        JSON.stringify({ purpose: SEALED_BINDINGS_PURPOSE, bindings }),
      );
      await chrome.storage.local.set({
        [FORM_BINDINGS_STORAGE_KEY]: { v: 1, sealed } satisfies StoredSealedEnvelope,
      });
      return;
    } catch {
      // If local vault is locked, keep bindings in session memory without writing plaintext to disk.
      return;
    }
  }
  await chrome.storage.local.set({
    [FORM_BINDINGS_STORAGE_KEY]: bindings,
  });
}

async function readStoredFormBindings(): Promise<Record<string, FormBindingV1>> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const raw = (await chrome.storage.local.get(FORM_BINDINGS_STORAGE_KEY))[
        FORM_BINDINGS_STORAGE_KEY
      ] as unknown;
      if (isSealedEnvelope(raw)) {
        if (configuredLocalVault != null) {
          const opened = JSON.parse(await configuredLocalVault.open(raw.sealed)) as {
            purpose?: string;
            bindings?: Record<string, FormBindingV1>;
          };
          if (
            opened?.purpose === SEALED_BINDINGS_PURPOSE &&
            opened.bindings &&
            typeof opened.bindings === "object"
          ) {
            return { ...opened.bindings, ...Object.fromEntries(memoryFormBindings.entries()) };
          }
        }
        return Object.fromEntries(memoryFormBindings.entries());
      }
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const legacyBindings = raw as Record<string, FormBindingV1>;
        if (configuredLocalVault != null && Object.keys(legacyBindings).length > 0) {
          void writeStoredFormBindings(legacyBindings);
        }
        return { ...legacyBindings, ...Object.fromEntries(memoryFormBindings.entries()) };
      }
    }
  } catch {
    // Fall back to in-memory map when chrome.storage.local or decryption is unavailable.
  }
  return Object.fromEntries(memoryFormBindings.entries());
}

/** Persists a user-selected detail mapping (`FormBindingV1`) for a form field. */
export async function rememberFieldDetailBinding(
  pageUrl: string,
  field: AutofillField,
  cipher: CipherView,
  detailKey: string,
  pageFields?: AutofillField[],
): Promise<FormBindingV1> {
  await SdkLoadService.Ready;
  const sectionId = webSectionId(field, pageFields);
  const [formSignature, fieldSignature] = await Promise.all([
    webFormSignature(pageUrl, field, pageFields),
    webFieldSignature(field, pageFields),
  ]);
  const sectionKey = `${formSignature}:${sectionId}`;
  const current = await readStoredFormBindings();
  const existing = current[sectionKey] ?? memoryFormBindings.get(sectionKey);
  const nextEntry: FormBindingV1["fields"][number] = {
    fieldSignature,
    detailId: detailKey,
    variantId: null,
    format: { label: detail_label(detailKey) || detailKey },
    correctedByPerson: true,
  };
  const mergedFields = [
    ...(existing?.fields ?? []).filter((entry) => entry.fieldSignature !== fieldSignature),
    nextEntry,
  ];
  const binding: FormBindingV1 = {
    v: 1,
    formSignature,
    sectionId,
    profileCipherId: cipher.id || "local-profile",
    fields: mergedFields,
    updatedAt: new Date().toISOString(),
  };
  memoryFormBindings.set(sectionKey, binding);
  try {
    await writeStoredFormBindings({
      ...current,
      [sectionKey]: binding,
    });
  } catch {
    // In-memory map already holds the binding for the current session.
  }
  return binding;
}

/** Returns the remembered detail key for a form field, or null when none is saved. */
export async function rememberedFieldDetailKey(
  pageUrl: string,
  field: AutofillField,
  pageFields?: AutofillField[],
): Promise<string | null> {
  const sectionId = webSectionId(field, pageFields);
  const [formSignature, fieldSignature] = await Promise.all([
    webFormSignature(pageUrl, field, pageFields),
    webFieldSignature(field, pageFields),
  ]);
  const sectionKey = `${formSignature}:${sectionId}`;
  const legacyKey = `${formSignature}:${fieldSignature}`;
  const stored = await readStoredFormBindings();
  const binding =
    stored[sectionKey] ??
    memoryFormBindings.get(sectionKey) ??
    stored[legacyKey] ??
    memoryFormBindings.get(legacyKey);
  const entry = binding?.fields.find((f) => f.fieldSignature === fieldSignature);
  return entry?.detailId ?? null;
}

/** Clears remembered form bindings in memory and storage. */
export async function clearRememberedFormBindings(): Promise<void> {
  memoryFormBindings.clear();
  inferenceChoiceCache.clear();
  describeFormCache.clear();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(FORM_BINDINGS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage cleanup errors in test environments.
  }
}

function profileFieldsWithEnvelope(cipher: CipherView): {
  profile: ProfileFields;
  openLabels: Map<string, string>;
} {
  const rawProfile = fillableProfileFieldsOf(cipher);
  const custom = new Map<string, string>();
  for (const [rawKey, value] of rawProfile.custom.entries()) {
    const key =
      rawKey !== "vk.role" && rawKey !== "vk.relationship" && rawKey !== "vk.sample"
        ? rawKey.replace(/^vk\./, "")
        : rawKey;
    if (!custom.has(key)) {
      custom.set(key, value);
    }
  }
  const profile: ProfileFields = { identity: rawProfile.identity, custom };
  const openLabels = new Map<string, string>();
  const envelope = Array.isArray(cipher.fields) ? readEnvelope(cipher) : null;
  for (const detail of envelope?.details ?? []) {
    if (agentRuleOf(detail) === "never") {
      continue;
    }
    const chosen =
      (detail.chosenVariantId
        ? detail.variants.find((v) => v.id === detail.chosenVariantId && v.current)
        : undefined) ?? detail.variants.find((v) => v.current && v.value.trim() !== "");
    if (!chosen?.value) {
      continue;
    }
    const detailKey = (detail.attribute || `custom.${detail.id}`).replace(/^vk\./, "");
    if (!profile.custom.has(detailKey)) {
      profile.custom.set(detailKey, chosen.value);
    }
    if (detail.label) {
      openLabels.set(detailKey, detail.label);
    }
  }
  return { profile, openLabels };
}

/** Lists all non-empty profile details (stored and derived) with human labels for the inline picker. */
export async function profileDetailsForCipher(cipher: CipherView): Promise<ProfileDetailOption[]> {
  await SdkLoadService.Ready;
  const { profile, openLabels } = profileFieldsWithEnvelope(cipher);
  const { details } = profile_details(profile);
  const options: ProfileDetailOption[] = [];
  for (const [key, value] of details.entries()) {
    if (!key || typeof value !== "string" || value.trim() === "") {
      continue;
    }
    options.push({
      key,
      label: openLabels.get(key) || detail_label(key) || key,
      value,
    });
  }
  return options;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("inference_timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function extractFieldOptions(raw: AutofillField | undefined, allFields: AutofillField[]): string[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw.selectInfo?.options)) {
    const out: string[] = [];
    for (const pair of raw.selectInfo.options as Array<Array<string | null | undefined>>) {
      if (!Array.isArray(pair)) {
        continue;
      }
      const text = typeof pair[0] === "string" ? pair[0].trim() : "";
      const val = typeof pair[1] === "string" ? pair[1].trim() : "";
      const label = text && val && text !== val.toLowerCase() ? `${val}: ${text}` : text || val;
      if (label && !out.includes(label)) {
        out.push(label);
        if (out.length >= 60) {
          break;
        }
      }
    }
    return out;
  }
  if (raw.type === "radio") {
    const groupKey = raw.htmlName || raw.radioGroupLabel || raw.section || "";
    const siblings = groupKey
      ? allFields.filter(
          (f) =>
            f.type === "radio" &&
            f.form === raw.form &&
            (f.htmlName || f.radioGroupLabel || f.section || "") === groupKey,
        )
      : [raw];
    const out: string[] = [];
    for (const r of siblings) {
      const lbl = (r.radioOptionLabel || r["label-tag"] || r.value || "").trim();
      if (lbl && !out.includes(lbl)) {
        out.push(lbl);
      }
    }
    return out;
  }
  return [];
}

async function buildZeroPiiTarget(
  pageUrl: string,
  rawFields: AutofillField[],
  inputs: FormFieldInput[],
): Promise<AgentTarget> {
  const firstField = rawFields[0] ?? new AutofillField();
  const formSignature = await webFormSignature(pageUrl, firstField, rawFields);
  const sectionsMap = new Map<string, string>();
  const agentFields: AgentField[] = inputs.map((input, idx) => {
    const raw = rawFields[idx];
    const sectionId = raw ? webSectionId(raw, rawFields) : "default";
    if (!sectionsMap.has(sectionId)) {
      sectionsMap.set(sectionId, input.section || "");
    }
    return {
      id: `f_${idx}`,
      sectionId,
      label: input.label || input.placeholder || input.name,
      type: input.input_type,
      options: extractFieldOptions(raw, rawFields),
      ...(input.pattern ? { format: input.pattern } : {}),
    };
  });
  if (sectionsMap.size === 0) {
    sectionsMap.set("default", "");
  }
  let destination = "web:page";
  try {
    destination = `web:${new URL(pageUrl).origin}`;
  } catch {
    // Keep neutral destination marker when URL is unavailable.
  }
  return {
    targetId: formSignature,
    kind: "web",
    destinationKey: destination,
    generation: formSignature,
    display: destination,
    formSignature,
    sections: [...sectionsMap.entries()].map(([id, label]) => ({ id, label })),
    fields: agentFields,
  };
}

const OPAQUE_FIELD_LABEL =
  /^(?:f|c|text|textfield|check ?box|checkbox|button|field)[ _-]?\d+(?:_\d+)?(?:\[\d+\])?$/i;

const CANONICAL_OWNERS = new Set([
  "applicant",
  "self",
  "spouse",
  "dependent",
  "employer",
  "preparer",
  "landlord",
  "household_head",
  "guarantor",
  "official_only",
  "other",
]);

const NON_APPLICANT_PROTECTED_OWNERS = new Set([
  "spouse",
  "dependent",
  "preparer",
  "landlord",
  "household_head",
  "guarantor",
  "official_only",
  "other",
]);

const OF_A_PERSON_PREFIXES = [
  "name.",
  "birth.",
  "person.",
  "id.",
  "visa.",
  "address.",
  "contact.",
];

function isOpaqueFieldLabel(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === "" || OPAQUE_FIELD_LABEL.test(trimmed);
}

function choiceIdsFor(fields: FormFieldInput[]): string[] {
  const counts = new Map<string, number>();
  for (const field of fields) {
    const trimmed = field.id.trim();
    if (trimmed) {
      counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
  }
  return fields.map((field, index) => {
    const trimmed = field.id.trim();
    return trimmed && counts.get(trimmed) === 1 ? trimmed : `__vk_f_${index}`;
  });
}

function normalizeDescribedOwner(described?: { owner?: string; whose?: string }): string {
  if (described == null) {
    return "applicant";
  }
  if (described.owner !== undefined) {
    const raw = described.owner.trim().toLowerCase();
    return !raw || raw === "self" ? "applicant" : raw;
  }
  const rawWhose = (described.whose ?? "").trim().toLowerCase();
  if (CANONICAL_OWNERS.has(rawWhose)) {
    return rawWhose === "self" ? "applicant" : rawWhose;
  }
  return "applicant";
}

async function choicesFor(
  fields: FormFieldInput[],
  held: string[],
  pageUrl: string,
  rawFields: AutofillField[],
): Promise<ChosenField[]> {
  if (fields.length === 0 || held.length === 0 || configuredProductInference == null) {
    return [];
  }
  if (configuredProductInference.getPrivacyMode() === "local") {
    return [];
  }
  try {
    const cacheKey = await requestHash({
      fields: fields.map((f) => ({
        name: f.name,
        label: f.label,
        placeholder: f.placeholder,
        autocomplete: f.autocomplete,
        type: f.input_type,
        section: f.section,
      })),
      held: [...held].sort(),
    });
    const cached = inferenceChoiceCache.get(cacheKey);
    if (cached != null) {
      return cached;
    }

    const inference = configuredProductInference;
    const ask = (request: object): Promise<unknown> =>
      withTimeout(inference.decide(request as DecisionRequest), INFERENCE_TIMEOUT_MS);

    const choiceIds = choiceIdsFor(fields);
    const heldSet = new Set(held);
    let enrichedFields = fields;
    let asksFields:
      | Array<{
          id: string;
          what: string;
          whose: string;
          attribute?: string;
          owner?: string;
          format?: { label: string; options: string[] };
        }>
      | null = null;

    try {
      const target = await buildZeroPiiTarget(pageUrl, rawFields, fields);
      let describePromise = describeFormCache.get(target.formSignature);
      if (!describePromise) {
        describePromise = withTimeout(inference.describe(target), INFERENCE_TIMEOUT_MS).catch(
          (err) => {
            describeFormCache.delete(target.formSignature);
            throw err;
          },
        );
        describeFormCache.set(target.formSignature, describePromise);
      }
      const asks = await describePromise;
      asksFields = asks.fields;
      enrichedFields = fields.map((field, index) => {
        const described = asks.fields.find((entry) => entry.id === `f_${index}`);
        if (!described) {
          return field;
        }
        const owner = normalizeDescribedOwner(described);
        const what = (described.what ?? "").trim();
        const nextLabel = !field.label.trim()
          ? what || field.label
          : isOpaqueFieldLabel(field.label) && what
            ? `${field.label} ${what}`
            : field.label;
        return {
          ...field,
          label: nextLabel,
          format: field.format || described.format?.label?.trim() || "",
          section: field.section || (owner !== "applicant" ? owner : ""),
        };
      });
    } catch {
      // Proceed directly to Decision choice query or local WASM heuristics when describe is unavailable.
    }

    let decidedChoices: ChosenField[] = [];
    let decideSucceeded = false;
    try {
      const askableFields = enrichedFields.map((f) =>
        f.input_type === "radio" && f.label.trim() !== "" ? { ...f, input_type: "select-one" } : f,
      );
      decidedChoices = await chooseDetails(askableFields, held, ask);
      decideSucceeded = true;
    } catch {
      decidedChoices = [];
    }

    if (asksFields == null) {
      if (decideSucceeded) {
        inferenceChoiceCache.set(cacheKey, decidedChoices);
      }
      return decidedChoices;
    }

    const decidedById = new Map<string, ChosenField>();
    for (const choice of decidedChoices) {
      decidedById.set(choice.id, choice);
    }

    const merged: ChosenField[] = [];
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      const choiceId = choiceIds[index];
      const described = asksFields.find((entry) => entry.id === `f_${index}`);
      const owner = normalizeDescribedOwner(described);
      const asksAttr = (described?.attribute ?? "").trim();
      const decided =
        decidedById.get(choiceId) ??
        (field.id.trim() ? decidedById.get(field.id.trim()) : undefined);

      if (owner === "official_only" || decided?.owner === "official_only") {
        merged.push({ id: choiceId, attribute: "", owner: "official_only" });
        continue;
      }

      if (NON_APPLICANT_PROTECTED_OWNERS.has(owner)) {
        const candidateAttr =
          asksAttr === "none"
            ? ""
            : decided?.attribute && heldSet.has(decided.attribute)
              ? decided.attribute
              : asksAttr && heldSet.has(asksAttr)
                ? asksAttr
                : "";
        const personScopedAttr =
          candidateAttr && OF_A_PERSON_PREFIXES.some((prefix) => candidateAttr.startsWith(prefix))
            ? candidateAttr
            : "";
        merged.push({ id: choiceId, attribute: personScopedAttr, owner });
        continue;
      }

      if (decided?.attribute && heldSet.has(decided.attribute)) {
        const resolvedOwner =
          owner !== "applicant" && (!decided.owner || decided.owner === "applicant")
            ? owner
            : decided.owner || owner;
        merged.push({ id: choiceId, attribute: decided.attribute, owner: resolvedOwner });
      } else if (asksAttr === "none") {
        merged.push({
          id: choiceId,
          attribute: "",
          owner,
        });
      } else if (asksAttr && heldSet.has(asksAttr)) {
        merged.push({ id: choiceId, attribute: asksAttr, owner });
      } else if (decided) {
        merged.push({
          id: choiceId,
          attribute: decided.attribute,
          owner: decided.owner || owner,
        });
      } else if (owner !== "applicant") {
        merged.push({ id: choiceId, attribute: "", owner });
      }
    }
    const unresolved = merged.filter((choice) =>
      choice.owner === "applicant" && (!choice.attribute || !heldSet.has(choice.attribute)),
    );
    if (unresolved.length > 0) {
      try {
        const chosen = await chooseHeldAttributes(
          unresolved.map((choice) => {
            const index = choiceIds.indexOf(choice.id);
            return { ...enrichedFields[index], id: choice.id };
          }),
          held,
          ask,
        );
        for (const choice of unresolved) {
          choice.attribute = chosen.get(choice.id) ?? choice.attribute;
        }
      } catch {
        // Unresolved fields remain empty; resolved fields still fill.
      }
    }

    if (decideSucceeded) {
      inferenceChoiceCache.set(cacheKey, merged);
    }
    return merged;
  } catch {
    return [];
  }
}

const SECTION_OWNER_PATTERNS: ReadonlyArray<{ owner: string; pattern: RegExp }> = [
  {
    owner: "spouse",
    pattern:
      /(?:\bspouse\b|\bhusband\b|\bwife\b|配偶者|\bpartner\b|vợ|chồng|배우자|配偶|conjoint|cónyuge|conyuge|ehepartner|cônjuge)/i,
  },
  {
    owner: "dependent",
    pattern:
      /(?:\bdependent|\bchild\b|\bchildren\b|扶養|お子様|子ども|người phụ thuộc|con cái|부양가족|자녀|抚养|撫養|enfant|hijo|dependente)/i,
  },
  {
    owner: "guarantor",
    pattern:
      /(?:emergency\s*contact|\bguarantor\b|緊急連絡先|連帯保証人|身元保証人|保証人|người liên hệ khẩn cấp|người bảo lãnh|비상연락처|보증인|紧急联系人|緊急聯絡人|contacto de emergencia|notfallkontakt)/i,
  },
  {
    owner: "employer",
    pattern:
      /(?:\bemployer\b|employment\s*(?:details|information|section)|company\s*(?:details|information)|勤務先|雇用主|就職先|nơi làm việc|cơ quan|직장|고용주|工作单位|工作單位|employeur|arbeitgeber|empleador|empregador)/i,
  },
  {
    owner: "household_head",
    pattern: /(?:head\s*of\s*household|世帯主|chủ hộ|세대주|户主|戶主)/i,
  },
  {
    owner: "preparer",
    pattern: /(?:tax\s*preparer|\bpreparer\b|\brepresentative\b|代理人|作成者|người khai thay|대리인)/i,
  },
  {
    owner: "landlord",
    pattern: /(?:landlord|\blessor\b|貸主|大家|家主|chủ nhà|임대인|房东|房東)/i,
  },
];

function inferExplicitSectionOwner(section: string): string {
  const trimmed = section.trim();
  if (!trimmed) {
    return "applicant";
  }
  // Ignore sections that explicitly name the primary applicant (unless a sub-section after "—" names another person)
  const segments = trimmed.split(/\s*[—–|>/]\s*/);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    for (const { owner, pattern } of SECTION_OWNER_PATTERNS) {
      if (pattern.test(seg)) {
        return owner;
      }
    }
    if (/(?:\bapplicant\b|本人|申請人|người nộp đơn|신청인|申请人|申請人)/i.test(seg)) {
      return "applicant";
    }
  }
  return "applicant";
}

function inferCipherProfileRole(cipher: CipherView): string | null {
  for (const f of cipher.fields ?? []) {
    const name = (f.name ?? "").trim().toLowerCase();
    if (
      (name === "role" ||
        name === "vk.role" ||
        name === "relationship" ||
        name === "vk.relationship") &&
      typeof f.value === "string" &&
      f.value.trim() !== ""
    ) {
      const normalized = f.value.trim().toLowerCase();
      if (CANONICAL_OWNERS.has(normalized) && normalized !== "applicant" && normalized !== "self") {
        return normalized;
      }
      const byPattern = inferExplicitSectionOwner(f.value);
      if (byPattern !== "applicant") {
        return byPattern;
      }
    }
  }
  const byName = inferExplicitSectionOwner(cipher.name ?? "");
  return byName !== "applicant" ? byName : null;
}

function formatDetailForField(
  field: AutofillField,
  attribute: string,
  rawValue: string,
): string {
  const singleInput = formFieldOf(field);
  const wasmFormatFn = (sdkInternal as Record<string, unknown>).format_detail_for_field;
  if (typeof wasmFormatFn === "function") {
    try {
      const out = (wasmFormatFn as (req: unknown) => unknown)({
        field: singleInput,
        attribute,
        value: rawValue,
      });
      if (typeof out === "string" && out !== "") {
        return out;
      }
      if (out && typeof out === "object" && typeof (out as { value?: unknown }).value === "string") {
        const formatted = (out as { value: string }).value;
        if (formatted !== "") {
          return formatted;
        }
      }
    } catch {
      // Fall back to single-field fill_form_with_profile formatting below.
    }
  }

  try {
    const choiceId = singleInput.id.trim() || "__vk_f_0";
    const { matches } = fill_form_with_profile({
      fields: [singleInput],
      applicant_details: new Map([[attribute, rawValue]]),
      explicit_fill: true,
      choices: [{ id: choiceId, attribute, owner: "applicant" }],
    });
    const formatted = matches[0]?.value;
    if (typeof formatted === "string" && formatted !== "") {
      return formatted;
    }
  } catch {
    // Keep rawValue if WASM formatting throws.
  }

  return rawValue;
}

function resolveSyntheticAlternateKey(
  cipher: CipherView,
  chosenKey: string,
): { attribute: string; value: string } | null {
  if (!Array.isArray(cipher.fields)) {
    return null;
  }
  if (chosenKey.startsWith("variant:")) {
    const rest = chosenKey.slice("variant:".length);
    const sep = rest.indexOf(":");
    if (sep <= 0) {
      return null;
    }
    const attribute = rest.slice(0, sep);
    const variantId = rest.slice(sep + 1);
    const envelope = readEnvelope(cipher);
    for (const detail of envelope?.details ?? []) {
      if (agentRuleOf(detail) === "never") {
        continue;
      }
      const found = detail.variants.find((v) => v.id === variantId && v.value.trim() !== "");
      if (found) {
        return { attribute, value: found.value.trim() };
      }
    }
    return null;
  }
  if (chosenKey.startsWith("history:")) {
    const rest = chosenKey.slice("history:".length);
    const sep = rest.lastIndexOf(":");
    if (sep <= 0) {
      return null;
    }
    const attribute = rest.slice(0, sep);
    const idx = Number.parseInt(rest.slice(sep + 1), 10);
    if (!Number.isFinite(idx) || idx < 0) {
      return null;
    }
    const envelope = readEnvelope(cipher);
    for (const detail of envelope?.details ?? []) {
      if (agentRuleOf(detail) === "never") {
        continue;
      }
      const detailAttr = (detail.attribute || "").replace(/^vk\./, "");
      if (detailAttr === attribute && Array.isArray(detail.history) && detail.history[idx]) {
        const val = detail.history[idx].variant?.value?.trim() ?? "";
        if (val) {
          return { attribute, value: val };
        }
      }
    }
  }
  return null;
}

function shortSourceLabel(rawLabel?: string): string {
  if (!rawLabel) {
    return "Other source";
  }
  const trimmed = rawLabel.replace(/\s*\([^)]*\)\s*/g, " ").trim();
  if (/passport/i.test(rawLabel)) {
    return "Passport";
  }
  if (/residence card/i.test(rawLabel)) {
    return "Residence card";
  }
  if (/juminhyo|certificate of residence/i.test(rawLabel)) {
    return "Juminhyo";
  }
  if (/passbook/i.test(rawLabel)) {
    return "Bank book";
  }
  if (/cccd|citizen id/i.test(rawLabel)) {
    return "CCCD";
  }
  return trimmed || rawLabel;
}

/**
 * Returns up to 2 distinct alternate suggestions for the focused field on a single profile
 * (e.g., Passport vs Residence card spelling, Juminhyo vs Bank book kana, previous address,
 * or work vs personal phone), honoring `agentRule !== "never"`.
 */
export async function profileFieldAlternatesForCipher(
  cipher: CipherView,
  pageFields: AutofillField[],
  opid: string,
  matchedValue: string | null,
): Promise<ProfileDetailOption[]> {
  if (!opid || !matchedValue) {
    return [];
  }
  const field = pageFields.find((candidate) => candidate.opid === opid);
  if (!field) {
    return [];
  }
  await SdkLoadService.Ready;
  const matches = await detailsForFields(
    [field],
    cipher,
    "",
    undefined,
    pageFields,
    undefined,
    true,
  );
  const matchedAttr = (matches[0]?.attribute ?? "").replace(/^vk\./, "");
  if (!matchedAttr) {
    return [];
  }

  const alternates: ProfileDetailOption[] = [];
  const seenValues = new Set<string>([matchedValue.trim()]);
  const { profile, openLabels } = profileFieldsWithEnvelope(cipher);
  const heldDetails = profile_details(profile).details;
  const envelope = Array.isArray(cipher.fields) ? readEnvelope(cipher) : null;

  if (envelope) {
    const sourceById = new Map(envelope.sources.map((s) => [s.id, s]));
    const relatedAttrs = new Set<string>([matchedAttr]);
    if (matchedAttr === "name.full" || matchedAttr === "name.full.latin") {
      relatedAttrs.add("name.full");
      relatedAttrs.add("name.full.latin");
    }
    for (const detail of envelope.details) {
      if (agentRuleOf(detail) === "never") {
        continue;
      }
      const detailAttr = (detail.attribute || "").replace(/^vk\./, "");
      if (!relatedAttrs.has(detailAttr)) {
        continue;
      }
      for (const variant of detail.variants) {
        if (!variant.current || !variant.value.trim()) {
          continue;
        }
        const formatted = formatDetailForField(field, matchedAttr, variant.value.trim());
        if (!formatted.trim() || seenValues.has(formatted.trim())) {
          continue;
        }
        seenValues.add(formatted.trim());
        const src = variant.sourceId ? sourceById.get(variant.sourceId) : undefined;
        alternates.push({
          key: `variant:${matchedAttr}:${variant.id}`,
          label: shortSourceLabel(src?.kind || src?.fileName || detail.label),
          value: formatted,
        });
        if (alternates.length >= 2) {
          return alternates;
        }
      }
      if (Array.isArray(detail.history)) {
        for (let hIdx = 0; hIdx < detail.history.length; hIdx += 1) {
          const histVal = detail.history[hIdx]?.variant?.value?.trim() ?? "";
          if (!histVal) {
            continue;
          }
          const formatted = formatDetailForField(field, matchedAttr, histVal);
          if (!formatted.trim() || seenValues.has(formatted.trim())) {
            continue;
          }
          seenValues.add(formatted.trim());
          alternates.push({
            key: `history:${detailAttr}:${hIdx}`,
            label: "Previous",
            value: formatted,
          });
          if (alternates.length >= 2) {
            return alternates;
          }
        }
      }
    }
  }

  const pushSibling = (siblingKey: string, fallbackLabel: string) => {
    if (alternates.length >= 2) {
      return;
    }
    const raw = heldDetails.get(siblingKey)?.trim() ?? "";
    if (!raw) {
      return;
    }
    const formatted = formatDetailForField(field, matchedAttr, raw);
    if (!formatted.trim() || seenValues.has(formatted.trim())) {
      return;
    }
    seenValues.add(formatted.trim());
    alternates.push({
      key: siblingKey,
      label: openLabels.get(siblingKey) || detail_label(siblingKey) || fallbackLabel,
      value: formatted,
    });
  };

  if (matchedAttr === "contact.phone") {
    pushSibling("work.employer.phone", "Employer phone");
    pushSibling("emergency.phone", "Emergency phone");
  } else if (matchedAttr === "work.employer.phone") {
    pushSibling("contact.phone", "Mobile phone");
  } else if (matchedAttr === "address.full" || matchedAttr === "address.line1") {
    pushSibling("address.previous", "Previous address");
  }

  return alternates;
}

/** Classifies the full page and resolves each field against the selected vault profile. */
export async function detailsForFields(
  fields: AutofillField[],
  cipher: CipherView,
  pageUrl = "",
  detailOverride?: { opid: string; key: string },
  pageFields?: AutofillField[],
  additionalProfiles?: CipherView[],
  localOnly = false,
): Promise<FieldMatch[]> {
  await SdkLoadService.Ready;
  const contextFields = pageFields && pageFields.length >= fields.length ? pageFields : fields;
  const contextInputs = contextFields.map(formFieldOf);
  const { profile } = profileFieldsWithEnvelope(cipher);
  const heldDetails = profile_details(profile).details;
  const roleDetailsMap = new Map<string, Map<string, string>>();
  for (const extra of additionalProfiles ?? []) {
    if (!extra || extra.id === cipher.id) {
      continue;
    }
    const role = inferCipherProfileRole(extra);
    if (role && !roleDetailsMap.has(role)) {
      const { profile: extraProfile } = profileFieldsWithEnvelope(extra);
      const details = profile_details(extraProfile).details;
      if (details.size > 0) {
        roleDetailsMap.set(role, details);
      }
    }
  }

  const runProfileMatching = (choices: ChosenField[]): FieldMatch[] => {
    const multiProfileFn = (sdkInternal as Record<string, unknown>).fill_form_with_profiles;
    if (roleDetailsMap.size > 0 && typeof multiProfileFn === "function") {
      const profiles = new Map<string, Map<string, string>>([
        ["applicant", heldDetails],
        ...roleDetailsMap.entries(),
      ]);
      return (
        multiProfileFn as (req: {
          fields: FormFieldInput[];
          profiles: Map<string, Map<string, string>>;
          explicit_fill: boolean;
          choices: ChosenField[];
        }) => { matches: FieldMatch[] }
      )({
        fields: contextInputs,
        profiles,
        explicit_fill: true,
        choices,
      }).matches;
    }

    const matches = fill_fields_from_profile({
      fields: contextInputs,
      profile,
      explicit_fill: true,
      choices,
    }).matches;

    if (roleDetailsMap.size > 0) {
      for (const [role, roleDetails] of roleDetailsMap.entries()) {
        const roleIndices: number[] = [];
        const roleFields: FormFieldInput[] = [];
        const roleChoices: ChosenField[] = [];
        matches.forEach((m, idx) => {
          const sectionOwner = inferExplicitSectionOwner(contextInputs[idx].section);
          const effectiveOwner = m.owner !== "applicant" ? m.owner : sectionOwner;
          if (effectiveOwner === role) {
            roleIndices.push(idx);
            roleFields.push({ ...contextInputs[idx], section: "" });
            if (m.attribute) {
              const cid = contextInputs[idx].id.trim() || `__vk_f_${roleFields.length - 1}`;
              roleChoices.push({ id: cid, attribute: m.attribute, owner: "applicant" });
            }
          }
        });
        if (roleFields.length > 0) {
          const { matches: roleMatches } = fill_form_with_profile({
            fields: roleFields,
            applicant_details: roleDetails,
            explicit_fill: true,
            choices: roleChoices,
          });
          roleIndices.forEach((origIdx, rIdx) => {
            if (roleMatches[rIdx]) {
              matches[origIdx] = {
                ...roleMatches[rIdx],
                owner: role,
              };
            }
          });
        }
      }
    }
    return matches;
  };

  let contextMatches = runProfileMatching([]);
  let skipRemoteInference = localOnly;
  if (!skipRemoteInference && configuredProductInference != null) {
    if (configuredProductInference.getPrivacyMode() === "local") {
      skipRemoteInference = true;
    } else if (
      fields.length === 1 &&
      detailOverride &&
      fields[0]?.opid === detailOverride.opid
    ) {
      skipRemoteInference = true;
    } else if (contextInputs.length >= 3) {
      let fillableCount = 0;
      let classifiedCount = 0;
      let hasOpaque = false;
      for (let idx = 0; idx < contextInputs.length; idx += 1) {
        const inp = contextInputs[idx];
        if (inp.input_type === "textarea" || isSearchOrChatField(contextFields[idx], inp)) {
          continue;
        }
        fillableCount += 1;
        const attr = contextMatches[idx]?.attribute || "";
        if (attr !== "" && contextMatches[idx]?.value?.trim()) {
          classifiedCount += 1;
        } else if (!inp.label.trim() || isOpaqueFieldLabel(inp.label)) {
          hasOpaque = true;
        }
      }
      if (!hasOpaque && fillableCount >= 3 && classifiedCount === fillableCount) {
        skipRemoteInference = true;
      }
    }
  }

  if (!skipRemoteInference) {
    const allHeldKeys = new Set<string>(heldDetails.keys());
    for (const roleMap of roleDetailsMap.values()) {
      for (const k of roleMap.keys()) {
        allHeldKeys.add(k);
      }
    }
    const choices = await choicesFor(contextInputs, [...allHeldKeys], pageUrl, contextFields);
    if (choices.length > 0) {
      contextMatches = runProfileMatching(choices);
    }
  }

  const results: FieldMatch[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const input = formFieldOf(field);
    const contextIndex = contextFields.findIndex(
      (candidate) => candidate === field || (field.opid && candidate.opid === field.opid),
    );
    let match: FieldMatch =
      contextIndex >= 0 && contextMatches[contextIndex]
        ? contextMatches[contextIndex]
        : {
            attribute: "",
            chrome_type: "",
            owner: "applicant",
            score: 0,
            value: null,
          };

    const explicitSectionOwner = inferExplicitSectionOwner(input.section);
    if (explicitSectionOwner !== "applicant") {
      const isApplicantRelationalDetail =
        match.attribute.startsWith("emergency.") ||
        match.attribute.startsWith("family.") ||
        (explicitSectionOwner === "employer" &&
          (match.attribute.startsWith("work.") ||
            match.attribute.startsWith("income.") ||
            match.attribute === "id.employer.ein")) ||
        (explicitSectionOwner === "spouse" && match.attribute.startsWith("spouse."));
      if (!isApplicantRelationalDetail && !roleDetailsMap.has(explicitSectionOwner)) {
        match = {
          ...match,
          owner: explicitSectionOwner,
          value: null,
        };
      } else if (match.owner === "applicant" && !isApplicantRelationalDetail) {
        match = {
          ...match,
          owner: explicitSectionOwner,
        };
      }
    }

    if (isSearchOrChatField(field, input)) {
      match = {
        ...match,
        attribute: "",
        score: 0,
        value: null,
      };
    }

    const chosenKey =
      detailOverride && field.opid === detailOverride.opid
        ? detailOverride.key
        : await rememberedFieldDetailKey(pageUrl, field, contextFields);
    if (chosenKey) {
      const synthetic = resolveSyntheticAlternateKey(cipher, chosenKey);
      const resolvedValue = synthetic?.value ?? heldDetails.get(chosenKey) ?? "";
      const formatAttr = synthetic?.attribute ?? chosenKey;
      if (resolvedValue !== "") {
        match = {
          ...match,
          attribute: formatAttr,
          owner: "applicant",
          score: 10,
          value: formatDetailForField(field, formatAttr, resolvedValue),
        };
      }
    }
    results.push(match);
  }
  return results;
}

/**
 * Passive classification never reads a vault profile or returns stored values.
 * Uses `explicit_fill: true` so 1–2 field multi-step wizard steps classify cleanly,
 * while excluding site search bars and chat inputs.
 */
export async function suggestedDetailTypes(fields: unknown[]): Promise<string[]> {
  await SdkLoadService.Ready;
  const inputs = fields.map(formFieldOf);
  const { matches } = fill_form_with_profile({
    fields: inputs,
    applicant_details: new Map(),
    explicit_fill: true,
  });
  return matches.map((match, index) =>
    isSearchOrChatField(fields[index], inputs[index]) ? "" : match.attribute,
  );
}
