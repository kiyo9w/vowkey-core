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
export async function chooseDetails(
  fields: FormFieldInput[],
  held: string[],
  ask: (request: object) => Promise<unknown>,
  perRequest = 0,
): Promise<ChosenField[]> {
  const askAll = (requests: string) =>
    Promise.all((JSON.parse(requests) as object[]).map((request) => ask(request)));

  let plan = decision_form_begin(JSON.stringify({ fields, held }), perRequest);
  plan = decision_form_take_first_answers(
    plan,
    JSON.stringify(await askAll(decision_form_requests(plan, false))),
  );
  return decision_form_choices(plan, JSON.stringify(await askAll(decision_form_requests(plan, true))));
}
