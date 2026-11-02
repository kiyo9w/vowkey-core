import {
  ChosenField,
  decision_form_begin,
  decision_form_choices,
  decision_form_requests,
  decision_form_take_first_answers,
  FormFieldInput,
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

  const out: ChosenField[] = [];
  for (let offset = 0; offset < fields.length; offset += MAX_FIELDS_PER_DECISION_PLAN) {
    const slice = fields.slice(offset, offset + MAX_FIELDS_PER_DECISION_PLAN);
    let plan = decision_form_begin(JSON.stringify({ fields: slice, held }), perRequest);
    plan = decision_form_take_first_answers(
      plan,
      JSON.stringify(await askAll(decision_form_requests(plan, false))),
    );
    const chosen = decision_form_choices(
      plan,
      JSON.stringify(await askAll(decision_form_requests(plan, true))),
    );
    out.push(...chosen);
  }
  return out;
}
