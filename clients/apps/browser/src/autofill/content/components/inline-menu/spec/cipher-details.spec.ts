import { nothing } from "lit";

import { ThemeTypes } from "@vowkey/common/platform/enums";
import { CipherRepromptType, CipherType } from "@vowkey/common/vault/enums";

import { litValues } from "../../lit-stories/lit-values";
import {
  makeCipher,
  mockCardCiphers,
  mockLoginCiphers,
  mockPasskeyCiphers,
} from "../../lit-stories/mock-data";
import { CipherDetails } from "../cipher-details";

jest.mock("lit", () => jest.requireActual("../../lit-stories/lit-jest-mocks").litMock);

describe("CipherDetails", () => {
  const SUBTITLE_SLOT = 1;
  const PASSKEY_SECOND_LINE_SLOT = 2;

  it("renders login username as the subtitle", () => {
    const values = litValues(
      CipherDetails({
        theme: ThemeTypes.Light,
        cipher: mockLoginCiphers[0],
      }),
    );

    expect(values[SUBTITLE_SLOT]).toContain(mockLoginCiphers[0].login!.username);
  });

  it("renders card details as the subtitle", () => {
    const values = litValues(
      CipherDetails({
        theme: ThemeTypes.Light,
        cipher: mockCardCiphers[0],
      }),
    );

    expect(values[SUBTITLE_SLOT]).toContain(mockCardCiphers[0].card);
  });

  it("renders nothing for subtitle when none is available", () => {
    const values = litValues(
      CipherDetails({
        theme: ThemeTypes.Light,
        cipher: makeCipher({
          id: "1",
          name: "Empty login",
          type: CipherType.Login,
          login: { passkey: null },
        }),
      }),
    );

    expect(values[SUBTITLE_SLOT]).toBe(nothing);
  });

  it("shows the saved detail as the primary text and retains its profile context", () => {
    const values = litValues(
      CipherDetails({
        theme: ThemeTypes.Light,
        cipher: makeCipher({
          id: "profile-1",
          name: "Travel profile",
          type: CipherType.Identity,
          identity: { fullName: "", field: { label: "Passport number", value: "P1234567" } },
        }),
      }),
    );

    expect(values[2]).toBe("P1234567");
    expect(values[5]).toBe("Passport number · Travel profile");
  });

  it("does not expose a reprompt detail in text or tooltip bindings", () => {
    const values = litValues(
      CipherDetails({
        theme: ThemeTypes.Light,
        cipher: makeCipher({
          id: "profile-1",
          name: "Travel profile",
          type: CipherType.Identity,
          reprompt: CipherRepromptType.Password,
          identity: { fullName: "", field: { label: "Passport number", value: "P1234567" } },
        }),
      }),
    );

    expect(values).not.toContain("P1234567");
    expect(values[0]).toBe("●●●●●●");
    expect(values[2]).toBe("●●●●●●");
  });

  describe("passkey", () => {
    it("shows rpName when it differs from the cipher name", () => {
      const cipher = mockPasskeyCiphers[0];
      const values = litValues(
        CipherDetails({
          theme: ThemeTypes.Light,
          cipher,
        }),
      );

      expect(values[SUBTITLE_SLOT]).toContain(cipher.login!.passkey!.rpName);
      expect(values[PASSKEY_SECOND_LINE_SLOT]).toContain(cipher.login!.passkey!.userName);
    });

    it("uses the username as the first line when rpName matches the cipher name", () => {
      const cipher = mockPasskeyCiphers[1];
      const values = litValues(
        CipherDetails({
          theme: ThemeTypes.Light,
          cipher,
        }),
      );

      expect(values[SUBTITLE_SLOT]).toContain(cipher.login!.passkey!.userName);
      expect(values[PASSKEY_SECOND_LINE_SLOT]).toBe(nothing);
    });
  });
});
