import * as sdk from "@vowkey/sdk-internal";

import { chooseDetails } from "./decision-choices";

jest.mock("@vowkey/sdk-internal", () => ({
  decision_form_begin: jest.fn(),
  decision_form_choices: jest.fn(),
  decision_form_requests: jest.fn(),
  decision_form_take_first_answers: jest.fn(),
}));

describe("chooseDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it("preserves unique global field IDs across >100-field chunks even if SDK resets local indices", async () => {
    const fields = Array.from({ length: 125 }, (_, i) => ({
      id: `op_${i}`,
      label: `Field ${i}`,
    })) as never;

    let chunkIndex = 0;
    (sdk.decision_form_begin as jest.Mock).mockImplementation(() => `plan-r1-${chunkIndex++}`);
    (sdk.decision_form_take_first_answers as jest.Mock).mockImplementation(
      (plan: string) => `${plan}-r2`,
    );
    (sdk.decision_form_requests as jest.Mock).mockReturnValue(JSON.stringify([{ round: 1 }]));
    // Simulate WASM returning chunk-local 0-based numeric IDs ("0", "1", ...)
    (sdk.decision_form_choices as jest.Mock).mockImplementation((plan: string) => {
      if (plan.startsWith("plan-r1-0")) {
        return [{ id: "0", attribute: "name.given", owner: "applicant" }];
      }
      return [{ id: "4", attribute: "id.passport.number", owner: "applicant" }];
    });

    const ask = jest.fn(async () => ({ answers: {} }));
    const chosen = await chooseDetails(fields, ["name.given", "id.passport.number"], ask, 1);

    expect(sdk.decision_form_begin).toHaveBeenCalledTimes(2);
    const secondChunkPayload = JSON.parse((sdk.decision_form_begin as jest.Mock).mock.calls[1][0]);
    expect(secondChunkPayload.fields[0].id).toBe("op_100");
    expect(secondChunkPayload.fields[24].id).toBe("op_124");

    expect(chosen).toEqual([
      { id: "op_0", attribute: "name.given", owner: "applicant" },
      { id: "op_104", attribute: "id.passport.number", owner: "applicant" },
    ]);
  });
});
