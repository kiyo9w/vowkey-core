import { SdkLoadService } from "@vowkey/common/platform/abstractions/sdk/sdk-load.service";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { chooseDetails } from "@vowkey/common/vault/profile/decision-choices";
import { profileFieldsOf } from "@vowkey/common/vault/profile/profile-fields";
import {
  ChosenField, FieldMatch, FormFieldInput, fill_fields_from_profile, fill_form_with_profile, profile_details,
} from "@vowkey/sdk-internal";

import AutofillField from "../models/autofill-field";

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

/** Classifies the full page and resolves each field against the selected vault profile. */
export async function detailsForFields(
  fields: AutofillField[],
  cipher: CipherView,
): Promise<FieldMatch[]> {
  await SdkLoadService.Ready;
  const inputs = fields.map(formFieldOf);
  const profile = profileFieldsOf(cipher);
  const { matches } = fill_fields_from_profile({
    fields: inputs,
    profile,
    explicit_fill: true,
    choices: await choicesFor(inputs, [...profile_details(profile).details.keys()]),
  });
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
