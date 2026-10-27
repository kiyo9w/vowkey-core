import { FieldType } from "../enums";
import { CipherView } from "../models/view/cipher.view";
import { FieldView } from "../models/view/field.view";
import { IdentityView } from "../models/view/identity.view";

import { applyProfileFields, profileFieldsOf } from "./profile-fields";

function profile(): CipherView {
  const cipher = new CipherView();
  cipher.identity = Object.assign(new IdentityView(), {
    firstName: "Linh",
    lastName: "Nguyen",
    passportNumber: "C9481023",
  });
  const note = new FieldView();
  note.name = "bank.code";
  note.value = "0001";
  note.type = FieldType.Text;
  const secret = new FieldView();
  secret.name = "pin";
  secret.value = "1234";
  secret.type = FieldType.Hidden;
  cipher.fields = [note, secret];
  return cipher;
}

describe("profileFieldsOf", () => {
  it("reads the Identity fields and the text custom fields, and not the hidden ones", () => {
    const fields = profileFieldsOf(profile());

    expect(fields.identity.first_name).toBe("Linh");
    expect(fields.identity.passport_number).toBe("C9481023");
    expect(fields.identity.city).toBe("");
    expect([...fields.custom]).toEqual([["bank.code", "0001"]]);
  });

  it("reads an item with no Identity fields and no custom fields", () => {
    const fields = profileFieldsOf(new CipherView());

    expect(fields.identity.first_name).toBe("");
    expect(fields.custom.size).toBe(0);
  });
});

describe("applyProfileFields", () => {
  it("writes the Identity fields and a custom field for each detail", () => {
    const cipher = profile();
    const fields = profileFieldsOf(cipher);
    fields.identity.city = "Shinjuku-ku";
    fields.custom.set("bank.code", "0009");
    fields.custom.set("visa.status", "技術・人文知識・国際業務");

    applyProfileFields(cipher, fields);

    expect(cipher.identity?.city).toBe("Shinjuku-ku");
    expect(cipher.identity?.firstName).toBe("Linh");
    const byName = new Map(cipher.fields?.map((f) => [f.name, f]));
    // A detail already there changes in place, a new one is added, and a hidden field stays.
    expect(byName.get("bank.code")?.value).toBe("0009");
    expect(byName.get("visa.status")?.value).toBe("技術・人文知識・国際業務");
    expect(byName.get("pin")?.value).toBe("1234");
    expect(cipher.fields).toHaveLength(3);
  });

  it("gives an item without Identity fields some", () => {
    const cipher = new CipherView();
    const fields = profileFieldsOf(cipher);
    fields.identity.first_name = "Mai";

    applyProfileFields(cipher, fields);

    expect(cipher.identity?.firstName).toBe("Mai");
  });
});
