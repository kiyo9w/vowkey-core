import { app } from "electron";
import { mock } from "jest-mock-extended";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { LogService } from "@vowkey/common/platform/abstractions/log.service";
import { UserId } from "@vowkey/common/types/guid";
import { passwords } from "@vowkey/desktop-napi";
// eslint-disable-next-line no-restricted-imports
import { SymmetricCryptoKey } from "@vowkey/legacy-crypto";

import OsBiometricsServiceMac from "./os-biometrics-mac.service";

jest.mock("electron", () => ({
  app: {
    getName: jest.fn().mockReturnValue("Vowkey"),
  },
  systemPreferences: {
    canPromptTouchID: jest.fn(),
    promptTouchID: jest.fn(),
  },
}));

jest.mock("@vowkey/desktop-napi", () => ({
  biometrics: {
    setBiometricSecret: jest.fn(),
    getBiometricSecret: jest.fn(),
    deleteBiometricSecret: jest.fn(),
    prompt: jest.fn(),
    available: jest.fn(),
    deriveKeyMaterial: jest.fn(),
  },
  passwords: {
    deletePassword: jest.fn(),
    getPassword: jest.fn(),
    setPassword: jest.fn().mockResolvedValue(undefined),
    isAvailable: jest.fn(),
    PASSWORD_NOT_FOUND: "Password not found",
  },
}));

describe("OsBiometricsServiceMac", () => {
  let service: OsBiometricsServiceMac;
  let i18nService: I18nService;
  let logService: LogService;

  const mockUserId = "test-user-id" as UserId;

  beforeEach(() => {
    i18nService = mock<I18nService>();
    logService = mock<LogService>();
    service = new OsBiometricsServiceMac(i18nService, logService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("deleteBiometricKey", () => {
    const serviceName = "Vowkey_biometric";
    const keyName = "test-user-id_user_biometric";

    it("should delete biometric key successfully", async () => {
      await service.deleteBiometricKey(mockUserId);

      expect(passwords.deletePassword).toHaveBeenCalledWith(serviceName, keyName);
    });

    it("should not throw error if key not found", async () => {
      passwords.deletePassword = jest
        .fn()
        .mockRejectedValueOnce(new Error(passwords.PASSWORD_NOT_FOUND));

      await service.deleteBiometricKey(mockUserId);

      expect(passwords.deletePassword).toHaveBeenCalledWith(serviceName, keyName);
      expect(logService.debug).toHaveBeenCalledWith(
        "[OsBiometricService] Biometric key %s not found for service %s.",
        keyName,
        serviceName,
      );
    });

    it("should throw error for unexpected errors", async () => {
      const error = new Error("Unexpected error");
      passwords.deletePassword = jest.fn().mockRejectedValueOnce(error);

      await expect(service.deleteBiometricKey(mockUserId)).rejects.toThrow(error);

      expect(passwords.deletePassword).toHaveBeenCalledWith(serviceName, keyName);
    });
  });

  describe("keychain service name derivation", () => {
    // The keychain service used to store biometric keys is derived from app.getName()
    // at module load time. This isolates the stable and Beta channels so their signed
    // binaries do not share a keychain entry and trigger macOS ACL prompts.
    const keyName = "test-user-id_user_biometric";
    const key = new SymmetricCryptoKey(new Uint8Array(64)) as SymmetricCryptoKey;

    async function enrollUnderAppName(appName: string): Promise<void> {
      (app.getName as jest.Mock).mockReturnValueOnce(appName);
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ServiceCtor = require("./os-biometrics-mac.service").default;
        const isolated = new ServiceCtor(mock<I18nService>(), mock<LogService>());
        await isolated.enrollPersistent(mockUserId, key);
      });
    }

    it("derives 'Vowkey_biometric' on the stable channel", async () => {
      await enrollUnderAppName("Vowkey");

      expect(passwords.setPassword).toHaveBeenCalledWith(
        "Vowkey_biometric",
        keyName,
        key.toBase64(),
      );
    });

    it("derives 'Vowkey Beta_biometric' on the Beta channel", async () => {
      await enrollUnderAppName("Vowkey Beta");

      expect(passwords.setPassword).toHaveBeenCalledWith(
        "Vowkey Beta_biometric",
        keyName,
        key.toBase64(),
      );
    });
  });
});
