import { CipherType, FieldType } from "@vowkey/common/vault/enums";
import { CipherView } from "@vowkey/common/vault/models/view/cipher.view";
import { FieldView } from "@vowkey/common/vault/models/view/field.view";
import { IdentityView } from "@vowkey/common/vault/models/view/identity.view";
import { migrateLegacyProfile, readEnvelope } from "@vowkey/common/vault/profile/vk-meta";

import { formatVkReference, parseVkReference, readFieldPath, ReferenceError } from "@vowkey/common/vault/reference"

function keyItem(): CipherView {
  const view = new CipherView();
  view.type = CipherType.ApiKey;
  view.apiKey.value = "sk-live-1234567890";
  view.apiKey.sendStyle = "bearer";
  view.apiKey.allowedHosts = ["api.openai.com"];
  view.viewPassword = false;
  return view;
}

describe("parseVkReference", () => {
  it("parses an item id and a field path", () => {
    expect(parseVkReference("@vk:abc-123/key.value")).toEqual({
      itemId: "abc-123",
      fieldPath: "key.value",
    });
    expect(parseVkReference(" @vk:abc/detail.d1.v2 ")?.fieldPath).toBe("detail.d1.v2");
  });

  it("does not parse the gallery's symbolic spellings or plain values", () => {
    expect(parseVkReference("@vk:key.openai")).toBeNull();
    expect(parseVkReference("@vk:passport.no")).toBeNull();
    expect(parseVkReference("sk-abc")).toBeNull();
    expect(parseVkReference("@vk:/key.value")).toBeNull();
  });

  it("round-trips through formatVkReference", () => {
    expect(parseVkReference(formatVkReference("id1", "key.value"))).toEqual({
      itemId: "id1",
      fieldPath: "key.value",
    });
  });
});

describe("readFieldPath", () => {
  it("resolves a key's value even when the member cannot view passwords", () => {
    expect(readFieldPath(keyItem(), "key.value")).toBe("sk-live-1234567890");
    expect(readFieldPath(keyItem(), "key.allowedHosts")).toBe('["api.openai.com"]');
  });

  it("reads login, card, identity, notes and custom fields", () => {
    const login = new CipherView();
    login.type = CipherType.Login;
    login.login.password = "hunter2";
    login.notes = "note";
    const field = new FieldView();
    field.name = "Account";
    field.value = "123";
    field.type = FieldType.Text;
    login.fields = [field];
    expect(readFieldPath(login, "login.password")).toBe("hunter2");
    expect(readFieldPath(login, "notes")).toBe("note");
    expect(readFieldPath(login, "field.Account")).toBe("123");

    const card = new CipherView();
    card.type = CipherType.Card;
    card.card.number = "4111111111111111";
    expect(readFieldPath(card, "card.number")).toBe("4111111111111111");

    const identity = new CipherView();
    identity.type = CipherType.Identity;
    identity.identity.passportNumber = "B1234567";
    expect(readFieldPath(identity, "identity.passportNumber")).toBe("B1234567");
  });

  it("names why a reference does not resolve", () => {
    const trashed = keyItem();
    trashed.deletedDate = new Date();
    const reason = (cipher: CipherView, path: string) => {
      try {
        readFieldPath(cipher, path);
      } catch (e) {
        return (e as ReferenceError).reason;
      }
      return "resolved";
    };
    expect(reason(trashed, "key.value")).toBe("trashed");
    expect(reason(keyItem(), "key.nope")).toBe("unknown-path");
    expect(reason(keyItem(), "env.members")).toBe("unknown-path");
    expect(reason(keyItem(), "login.password")).toBe("unknown-path");
    const empty = keyItem();
    empty.apiKey.headerName = undefined;
    expect(reason(empty, "key.headerName")).toBe("empty");
  });

  it("refuses a custom-field name that matches twice", () => {
    const login = new CipherView();
    login.type = CipherType.Login;
    const a = new FieldView();
    a.name = "Dup";
    a.value = "1";
    const b = new FieldView();
    b.name = "Dup";
    b.value = "2";
    login.fields = [a, b];
    expect(() => readFieldPath(login, "field.Dup")).toThrow(ReferenceError);
  });

  it("resolves a profile's detail by id and an Identity path to the value fill writes", () => {
    const profile = new CipherView();
    profile.id = "6f1c0a2e-7b34-4c1d-9a10-2d5e6f708192";
    profile.type = CipherType.Identity;
    profile.identity = new IdentityView();
    profile.identity.passportNumber = "C8492011";
    migrateLegacyProfile(profile);
    const detail = readEnvelope(profile)!.details.find(
      (d) => d.attribute === "id.passport.number",
    )!;

    expect(readFieldPath(profile, `detail.${detail.id}`)).toBe("C8492011");
    expect(readFieldPath(profile, "identity.passportNumber")).toBe("C8492011");
    expect(() => readFieldPath(profile, "detail.nothing")).toThrow(ReferenceError);
  });

  it("reads the secret strings of SSH key, bank account, licence and passport items", () => {
    const passport = new CipherView();
    passport.type = CipherType.Passport;
    passport.passport.passportNumber = "C8492011";
    expect(readFieldPath(passport, "passport.passportNumber")).toBe("C8492011");
    // A path of another type's group does not resolve.
    expect(() => readFieldPath(passport, "bankAccount.accountNumber")).toThrow(ReferenceError);

    const bank = new CipherView();
    bank.type = CipherType.BankAccount;
    bank.bankAccount.accountNumber = "000123456789";
    expect(readFieldPath(bank, "bankAccount.accountNumber")).toBe("000123456789");
  });
});
