import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { FormBindingV1 } from "@vowkey/common/vault/agent/account-records";
import { requestHash } from "@vowkey/common/vault/local/canonical-json";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { chooseDetails } from "@vowkey/common/vault/profile/decision-choices";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import {
  ChosenField,
  FieldMatch,
  FormFieldInput,
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
const memoryFormBindings = new Map<string, FormBindingV1>();

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
  return [...new Set(words.map((word) => word.trim()))].join(" ");
}

function formFieldOf(input: unknown): FormFieldInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Invalid form field metadata");
  }
  const field = input as Record<string, unknown>;
  const text = (key: string): string => typeof field[key] === "string" ? field[key] : "";
  const dataset = text("dataSetValues").toLowerCase();
  return {
    id: text("htmlID"),
    name: text("htmlName"),
    label: labelOf(field),
    placeholder: text("placeholder"),
    autocomplete: text("autoCompleteType"),
    input_type: text("type") || "text",
    section: text("section"),
    form: text("form"),
    pattern: text("pattern"),
    max_length: typeof field.maxLength === "number" && Number.isInteger(field.maxLength)
      && field.maxLength > 0 && field.maxLength <= 2147483647 ? field.maxLength : 0,
    format: "",
    op_ignore: dataset.includes("opignore: true") || dataset.includes("op-ignore: true"),
  };
}

/** Computes the stable form signature for a field on a page. */
export async function webFormSignature(pageUrl: string, field: AutofillField): Promise<string> {
  let origin = "";
  let pathname = pageUrl;
  try {
    const parsed = new URL(pageUrl);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } catch {
    // Use raw pageUrl when it is not a full URL.
  }
  return requestHash({
    origin,
    pathname,
    form: typeof field.form === "string" ? field.form : "",
  });
}

/** Computes the stable field signature for a form field. */
export async function webFieldSignature(field: AutofillField): Promise<string> {
  const input = formFieldOf(field);
  return requestHash({
    tagName: typeof field.tagName === "string" ? field.tagName.toLowerCase() : "",
    inputType: input.input_type,
    name: input.name,
    id: input.id,
    autocomplete: input.autocomplete,
    section: input.section,
    label: input.label,
    placeholder: input.placeholder,
  });
}

async function readStoredFormBindings(): Promise<Record<string, FormBindingV1>> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = (await chrome.storage.local.get(FORM_BINDINGS_STORAGE_KEY))[
        FORM_BINDINGS_STORAGE_KEY
      ] as Record<string, FormBindingV1> | undefined;
      if (stored && typeof stored === "object") {
        return stored;
      }
    }
  } catch {
    // Fall back to in-memory map when chrome.storage.local is unavailable.
  }
  return Object.fromEntries(memoryFormBindings.entries());
}

/** Persists a user-selected detail mapping (`FormBindingV1`) for a form field. */
export async function rememberFieldDetailBinding(
  pageUrl: string,
  field: AutofillField,
  cipher: CipherView,
  detailKey: string,
): Promise<FormBindingV1> {
  const [formSignature, fieldSignature] = await Promise.all([
    webFormSignature(pageUrl, field),
    webFieldSignature(field),
  ]);
  const binding: FormBindingV1 = {
    v: 1,
    formSignature,
    sectionId: typeof field.section === "string" ? field.section : "",
    profileCipherId: cipher.id ?? "",
    fields: [
      {
        fieldSignature,
        detailId: detailKey,
        variantId: null,
        format: { label: detail_label(detailKey) || detailKey },
        correctedByPerson: true,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  const key = `${formSignature}:${fieldSignature}`;
  memoryFormBindings.set(key, binding);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const current = await readStoredFormBindings();
      await chrome.storage.local.set({
        [FORM_BINDINGS_STORAGE_KEY]: {
          ...current,
          [key]: binding,
        },
      });
    }
  } catch {
    // In-memory map already holds the binding for the current session.
  }
  return binding;
}

/** Returns the remembered detail key for a form field, or null when none is saved. */
export async function rememberedFieldDetailKey(
  pageUrl: string,
  field: AutofillField,
): Promise<string | null> {
  const [formSignature, fieldSignature] = await Promise.all([
    webFormSignature(pageUrl, field),
    webFieldSignature(field),
  ]);
  const key = `${formSignature}:${fieldSignature}`;
  const stored = await readStoredFormBindings();
  const binding = stored[key] ?? memoryFormBindings.get(key);
  const entry = binding?.fields.find((f) => f.fieldSignature === fieldSignature);
  return entry?.detailId ?? null;
}

/** Clears remembered form bindings in memory and storage. */
export async function clearRememberedFormBindings(): Promise<void> {
  memoryFormBindings.clear();
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(FORM_BINDINGS_STORAGE_KEY);
    }
  } catch {
    // Ignore storage cleanup errors in test environments.
  }
}

/** Lists all non-empty profile details (stored and derived) with human labels for the inline picker. */
export async function profileDetailsForCipher(cipher: CipherView): Promise<ProfileDetailOption[]> {
  await SdkLoadService.Ready;
  const profile = profileFieldsOf(cipher);
  const { details } = profile_details(profile);
  const options: ProfileDetailOption[] = [];
  for (const [key, value] of details.entries()) {
    if (!key || typeof value !== "string" || value.trim() === "") {
      continue;
    }
    options.push({
      key,
      label: detail_label(key) || key,
      value,
    });
  }
  return options;
}

/** Classifies the full page and resolves each field against the selected vault profile. */
export async function detailsForFields(
  fields: AutofillField[],
  cipher: CipherView,
  pageUrl = "",
  detailOverride?: { opid: string; key: string },
): Promise<FieldMatch[]> {
  await SdkLoadService.Ready;
  const inputs = fields.map(formFieldOf);
  const profile = profileFieldsOf(cipher);
  const heldDetails = profile_details(profile).details;
  const { matches } = fill_fields_from_profile({
    fields: inputs,
    profile,
    explicit_fill: true,
    choices: await choicesFor(inputs, [...heldDetails.keys()]),
  });
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    const chosenKey =
      detailOverride && field.opid === detailOverride.opid
        ? detailOverride.key
        : await rememberedFieldDetailKey(pageUrl, field);
    if (!chosenKey) {
      continue;
    }
    const resolvedValue = heldDetails.get(chosenKey) ?? "";
    if (resolvedValue === "") {
      continue;
    }
    matches[i] = {
      ...matches[i],
      attribute: chosenKey,
      owner: "applicant",
      score: 10,
      value: resolvedValue,
    };
  }
  return matches;
}

/** How Decision is asked, kept by the extension under `vowkeyDecision`: `url`, `key`, `model`. */
type DecisionSettings = { url: string; key?: string; model?: string; perRequest?: number };

/** What Decision chooses for each field; nothing when it is not set up or cannot be asked. */
async function choicesFor(fields: FormFieldInput[], held: string[]): Promise<ChosenField[]> {
  try {
    const stored = (await chrome.storage.local.get("vowkeyDecision")).vowkeyDecision as
      | DecisionSettings
      | undefined;
    if (!stored?.url) {
      return [];
    }
    const ask = async (request: object): Promise<unknown> => {
      const response = await fetch(stored.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(stored.key ? { Authorization: `Bearer ${stored.key}` } : {}),
        },
        body: JSON.stringify({ model: stored.model ?? "jev-1.14.0", ...request }),
      });
      if (!response.ok) {
        throw new Error(`Decision answered ${response.status}.`);
      }
      return response.json();
    };
    return await chooseDetails(fields, held, ask, stored.perRequest ?? 0);
  } catch {
    return [];
  }
}

/** Passive classification never reads a vault profile or returns stored values. */
export async function suggestedDetailTypes(fields: unknown[]): Promise<string[]> {
  await SdkLoadService.Ready;
  const { matches } = fill_form_with_profile({
    fields: fields.map(formFieldOf),
    applicant_details: new Map(),
    explicit_fill: false,
  });
  return matches.map((match) => match.attribute);
}
