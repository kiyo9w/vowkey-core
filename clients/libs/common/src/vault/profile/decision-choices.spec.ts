import * as sdk from "@vowkey/sdk-internal";

import { chooseDetails, chooseHeldAttributes } from "./decision-choices";

jest.mock("@vowkey/sdk-internal", () => ({
  decision_form_begin: jest.fn(),
  decision_form_choices: jest.fn(),
  decision_form_requests: jest.fn(),
  decision_form_take_first_answers: jest.fn(),
  detail_label: (attribute: string) => attribute,
}));

describe("chooseDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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


    expect(chosen).toEqual([
      { id: "op_0", attribute: "name.given", owner: "applicant" },
      { id: "op_104", attribute: "id.passport.number", owner: "applicant" },
    ]);
  });
});

describe("chooseHeldAttributes", () => {
  it("keeps saved values out of the model request even when the caller passes extra properties", async () => {
    const field = {
      id: "office_phone", label: "School telephone", section: "Education", format: "",
      value: "private-value-not-for-the-model",
    };
    let sent = "";
    const chosen = await chooseHeldAttributes([field], ["education.school.phone"], async (request) => {
      sent = JSON.stringify(request);
      return { answers: { office_phone: {
        choice: "education.school.phone", probabilities: { "education.school.phone": 0.95 },
      } } };
    });
    expect(sent).not.toContain(field.value);
    expect(chosen.get(field.id)).toBe("education.school.phone");
  });

  it("rejects unknown attributes, uncertain answers, and answers for another form", async () => {
    const fields = ["unknown", "uncertain", "accepted"].map((id) => ({
      id, label: id, section: "", format: "",
    }));
    const chosen = await chooseHeldAttributes(fields, ["custom.membership.code"], async () => ({
      answers: {
        unknown: { choice: "bank.account.number", probabilities: { "bank.account.number": 0.99 } },
        uncertain: { choice: "custom.membership.code", probabilities: { "custom.membership.code": 0.1 } },
        accepted: { choice: "custom.membership.code", probabilities: { "custom.membership.code": 0.99 } },
        another_form: { choice: "custom.membership.code", probabilities: { "custom.membership.code": 0.99 } },
      },
    }));
    expect([...chosen]).toEqual([["accepted", "custom.membership.code"]]);
  });
});
