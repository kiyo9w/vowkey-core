import * as sdk from "@vowkey/sdk-internal";

import { chooseDetails } from "./decision-choices";

jest.mock("@vowkey/sdk-internal", () => ({
  decision_form_begin: jest.fn(),
  decision_form_choices: jest.fn(),
  decision_form_requests: jest.fn(),
  decision_form_take_first_answers: jest.fn(),
}));

describe("chooseDetails", () => {
  it("asks about the form in two rounds, sending the model no values", async () => {
    (sdk.decision_form_begin as jest.Mock).mockReturnValue("plan-1");
    (sdk.decision_form_take_first_answers as jest.Mock).mockReturnValue("plan-2");
    (sdk.decision_form_requests as jest.Mock).mockImplementation((_plan: string, second: boolean) =>
      JSON.stringify([{ round: second ? 2 : 1 }]),
    );
    (sdk.decision_form_choices as jest.Mock).mockReturnValue([
      { id: "f1", attribute: "bank.account.number", owner: "applicant" },
    ]);
    const ask = jest.fn(async (request: object) => ({ answers: {}, request }));
    const fields = [{ id: "f1", label: "口座番号" }] as never;

    const chosen = await chooseDetails(fields, ["bank.account.number"], ask, 1);

    expect(chosen).toEqual([{ id: "f1", attribute: "bank.account.number", owner: "applicant" }]);
    expect(sdk.decision_form_begin).toHaveBeenCalledWith(
      JSON.stringify({ fields, held: ["bank.account.number"] }),
      1,
    );
    expect(ask).toHaveBeenCalledWith({ round: 1 });
    expect(ask).toHaveBeenCalledWith({ round: 2 });
    expect(sdk.decision_form_take_first_answers).toHaveBeenCalledWith("plan-1", expect.any(String));
    expect(sdk.decision_form_choices).toHaveBeenCalledWith("plan-2", expect.any(String));
  });
});
