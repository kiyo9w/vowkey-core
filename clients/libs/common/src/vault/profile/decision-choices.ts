import {
  ChosenField,
  decision_form_begin,
  decision_form_choices,
  decision_form_requests,
  decision_form_take_first_answers,
  FormFieldInput,
  detail_label,
} from "@vowkey/sdk-internal";

/**
 * Asks a Decision model which saved detail each field of a form asks for, and whose it is. Only the
 * words that ask for each field and the names of the details the profile holds are sent; the
 * values never leave the vault. `ask` sends one request to the model and resolves to its answers.
 */
const MAX_FIELDS_PER_DECISION_PLAN = 100;

export async function chooseDetails(
  fields: FormFieldInput[],
  held: string[],
  ask: (request: object) => Promise<unknown>,
  perRequest = 0,
): Promise<ChosenField[]> {
  if (fields.length === 0 || held.length === 0) {
    return [];
  }
  const askAll = (requests: string) =>
    Promise.all((JSON.parse(requests) as object[]).map((request) => ask(request)));

  const needsGlobalIdRewrite = fields.length > MAX_FIELDS_PER_DECISION_PLAN;
  const idCounts = new Map<string, number>();
  for (const field of fields) {
    const trimmed = (field.id ?? "").trim();
    if (trimmed) {
      idCounts.set(trimmed, (idCounts.get(trimmed) ?? 0) + 1);
    }
  }
  const globalIds = fields.map((field, index) => {
    const trimmed = (field.id ?? "").trim();
    return trimmed && idCounts.get(trimmed) === 1 ? trimmed : `__vk_f_${index}`;
  });

  const out: ChosenField[] = [];
  for (let offset = 0; offset < fields.length; offset += MAX_FIELDS_PER_DECISION_PLAN) {
    const rawSlice = fields.slice(offset, offset + MAX_FIELDS_PER_DECISION_PLAN);
    const slice = needsGlobalIdRewrite
      ? rawSlice.map((field, idx) => ({
          ...field,
          id: globalIds[offset + idx],
        }))
      : rawSlice;
    const sliceIdSet = new Set(slice.map((field) => field.id));
    let plan = decision_form_begin(JSON.stringify({ fields: slice, held }), perRequest);
    plan = decision_form_take_first_answers(
      plan,
      JSON.stringify(await askAll(decision_form_requests(plan, false))),
    );
    const chosen = decision_form_choices(
      plan,
      JSON.stringify(await askAll(decision_form_requests(plan, true))),
    );
    for (const item of chosen) {
      if (!sliceIdSet.has(item.id)) {
        const localMatch = /^(?:__vk_f_|f)?(\d+)$/.exec(item.id);
        if (localMatch) {
          const localIdx = Number.parseInt(localMatch[1], 10);
          if (localIdx >= 0 && localIdx < slice.length) {
            out.push({
              ...item,
              id: needsGlobalIdRewrite ? globalIds[offset + localIdx] : slice[localIdx].id,
            });
            continue;
          }
        }
      }
      out.push(item);
    }
  }
  return out;
}

/** Resolves open-ended saved attributes using names only; a model never receives their values. */
export async function chooseHeldAttributes(
  fields: Pick<FormFieldInput, "id" | "label" | "section" | "format">[],
  heldAttributes: readonly string[],
  ask: (request: object) => Promise<unknown>,
): Promise<Map<string, string>> {
  const chosen = new Map<string, string>();
  if (fields.length === 0 || heldAttributes.length === 0) {
    return chosen;
  }
  const held = new Set(heldAttributes);
  const criteria = Object.fromEntries([
    ...heldAttributes.map((attribute) => [attribute, detail_label(attribute)]),
    ["none", "No saved attribute fits: an unknown fact, signature, declaration, or free comment."],
  ]);
  const result = await ask({
    state: {
      about: "Choose saved attribute names for these form questions. No saved values are present.",
      fields: fields.map(({ id, label, section, format }) => ({ id, label, section, format })),
    },
    questions: Object.fromEntries(fields.map(({ id }) => [id, {
      type: "choice",
      instructions: `Which saved attribute does field ${id} ask for? Match the specific person or institution, not another contact. Choose none when no saved attribute fits.`,
      criteria,
    }])),
  });
  if (result == null || typeof result !== "object" || !("answers" in result) ||
      result.answers == null || typeof result.answers !== "object") {
    return chosen;
  }
  for (const field of fields) {
    const answer: unknown = Reflect.get(result.answers, field.id);
    if (answer == null || typeof answer !== "object" || !("choice" in answer) ||
        typeof answer.choice !== "string" || !held.has(answer.choice) ||
        !("probabilities" in answer) || answer.probabilities == null ||
        typeof answer.probabilities !== "object") {
      continue;
    }
    const probability: unknown = Reflect.get(answer.probabilities, answer.choice);
    if (typeof probability === "number" && probability >= 0.65 && probability <= 1) {
      chosen.set(field.id, answer.choice);
    }
  }
  return chosen;
}
