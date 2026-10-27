import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";

import { applyProfileFields, profileFieldsOf } from "./profile-fields";

function field(name: string, value: string, type: FieldType = FieldType.Text): FieldView {
  return Object.assign(new FieldView(), { name, value, type });
}

function profileItem(): CipherView {
  const cipher = new CipherView();
  cipher.identity = Object.assign(new IdentityView(), {
    firstName: "Linh",
    lastName: "Nguyen",
    passportNumber: "B1234567",
    city: "Tokyo",
  });
  cipher.fields = [field("birth.date", "1998-03-14"), field("pin", "1234", FieldType.Hidden)];
  return cipher;
}

describe("profile fields", () => {
  it("reads the Identity fields and the text custom fields of an item", () => {
    const profile = profileFieldsOf(profileItem());

    expect(profile.identity.first_name).toBe("Linh");
    expect(profile.identity.passport_number).toBe("B1234567");
    expect(profile.identity.middle_name).toBe("");
    expect(profile.custom.get("birth.date")).toBe("1998-03-14");
    expect(profile.custom.has("pin")).toBe(false);
  });

  it("writes a profile back, changing a custom field in place and adding new ones", () => {
    const cipher = profileItem();
    const profile = profileFieldsOf(cipher);
    profile.identity.last_name = "NGUYEN";
    profile.custom.set("birth.date", "1998-03-15");
    profile.custom.set("bank.code", "0001");

    applyProfileFields(cipher, profile);

    expect(cipher.identity.lastName).toBe("NGUYEN");
    expect(cipher.fields.filter((f) => f.name === "birth.date")).toHaveLength(1);
    expect(cipher.fields.find((f) => f.name === "birth.date")?.value).toBe("1998-03-15");
    expect(cipher.fields.find((f) => f.name === "bank.code")?.value).toBe("0001");
    expect(cipher.fields.find((f) => f.name === "pin")?.value).toBe("1234");
  });

  it("gives a cipher without an Identity item one", () => {
    const cipher = new CipherView();
    const profile = profileFieldsOf(cipher);
    profile.identity.email = "linh@example.com";

    applyProfileFields(cipher, profile);

    expect(cipher.identity.email).toBe("linh@example.com");
  });
});
