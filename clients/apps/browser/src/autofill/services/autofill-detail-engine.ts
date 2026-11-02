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
import { chooseDetails } from "@vowkey/common/vault/profile/decision-choices";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import { readEnvelope } from "@vowkey/common/vault/profile/vk-meta";
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
  const words = [
    field["label-tag"],
    field["label-aria"],
    field["label-row"],
    field["label-left"],
    field["label-top"],
    field.title,
  ].filter((word): word is string => typeof word === "string" && word.trim() !== "");
  return [...new Set(words.map((word) => normalizeLabelText(word)))].join(" ");
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
  return {
    id: stabilizeFieldIdentifier(text("htmlID")),
    name: stabilizeFieldIdentifier(text("htmlName")),
    label: labelOf(field),
    placeholder: normalizeLabelText(text("placeholder")),
    autocomplete: text("autoCompleteType").trim(),
    input_type: text("type") || (text("tagName").toLowerCase() === "select" ? "select-one" : "text"),
    section: stabilizeFieldIdentifier(text("section")),
    form: stabilizeFieldIdentifier(text("form")),
    pattern: text("pattern"),
    max_length:
      typeof field.maxLength === "number" &&
      Number.isInteger(field.maxLength) &&
      field.maxLength > 0 &&
      field.maxLength <= 2147483647
        ? field.maxLength
        : 0,
    format: "",
    op_ignore: dataset.includes("opignore: true") || dataset.includes("op-ignore: true"),
  };
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
  const profile = profileFieldsOf(cipher);
  const openLabels = new Map<string, string>();
  const envelope = Array.isArray(cipher.fields) ? readEnvelope(cipher) : null;
  for (const detail of envelope?.details ?? []) {
    const chosen =
      (detail.chosenVariantId
        ? detail.variants.find((v) => v.id === detail.chosenVariantId && v.current)
        : undefined) ?? detail.variants.find((v) => v.current && v.value.trim() !== "");
    if (!chosen?.value) {
      continue;
    }
    const detailKey = detail.attribute || `custom.${detail.id}`;
    const customName = detailKey.startsWith("vk.") ? detailKey : `vk.${detailKey}`;
    if (!profile.custom.has(customName)) {
      profile.custom.set(customName, chosen.value);
    }
    if (detail.label) {
      openLabels.set(detailKey.replace(/^vk\./, ""), detail.label);
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
      options: [] as string[],
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

    let enrichedFields = fields;
    try {
      const target = await buildZeroPiiTarget(pageUrl, rawFields, fields);
      const asks = await withTimeout(inference.describe(target), INFERENCE_TIMEOUT_MS);
      enrichedFields = fields.map((field, index) => {
        const described = asks.fields.find((entry) => entry.id === `f_${index}`);
        if (!described?.what) {
          return field;
        }
        return {
          ...field,
          label: field.label ? `${field.label} ${described.what}` : described.what,
          section: field.section || (described.whose !== "applicant" ? described.whose : ""),
        };
      });
    } catch {
      // Proceed directly to Decision choice query or local WASM heuristics when describe is unavailable.
    }

    const choices = await chooseDetails(enrichedFields, held, ask);
    inferenceChoiceCache.set(cacheKey, choices);
    return choices;
  } catch {
    return [];
  }
}

/** Classifies the full page and resolves each field against the selected vault profile. */
export async function detailsForFields(
  fields: AutofillField[],
  cipher: CipherView,
  pageUrl = "",
  detailOverride?: { opid: string; key: string },
  pageFields?: AutofillField[],
): Promise<FieldMatch[]> {
  await SdkLoadService.Ready;
  const contextFields = pageFields && pageFields.length >= fields.length ? pageFields : fields;
  const contextInputs = contextFields.map(formFieldOf);
  const { profile } = profileFieldsWithEnvelope(cipher);
  const heldDetails = profile_details(profile).details;
  const { matches: contextMatches } = fill_fields_from_profile({
    fields: contextInputs,
    profile,
    explicit_fill: true,
    choices: await choicesFor(contextInputs, [...heldDetails.keys()], pageUrl, contextFields),
  });

  const results: FieldMatch[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
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

    if (isSearchOrChatField(field, formFieldOf(field))) {
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
      const resolvedValue = heldDetails.get(chosenKey) ?? "";
      if (resolvedValue !== "") {
        match = {
          ...match,
          attribute: chosenKey,
          owner: "applicant",
          score: 10,
          value: resolvedValue,
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
