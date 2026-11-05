import { TestBed } from "@angular/core/testing";
import { MockProxy, mock } from "jest-mock-extended";
import { of } from "rxjs";

import { DefaultLoginComponentService } from "@vowkey/auth/angular";
import { SsoUrlService } from "@vowkey/auth/common";
import { SsoLoginServiceAbstraction } from "@vowkey/common/auth/abstractions/sso-login.service.abstraction";
import { ClientType } from "@vowkey/common/enums";
import {
  Environment,
  EnvironmentService,
} from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { Utils } from "@vowkey/common/platform/misc/utils";
import { ToastService } from "@vowkey/components";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";
// eslint-disable-next-line no-restricted-imports
import { CryptoFunctionService } from "@vowkey/legacy-crypto";

import { ElectronPlatformUtilsService } from "../../platform/services/electron-platform-utils.service";

import { DesktopLoginComponentService } from "./desktop-login-component.service";

const defaultIpc = {
  platform: {
    isAppImage: false,
    isSnapStore: false,
    isDev: false,
    localhostCallbackService: {
      openSsoPrompt: jest.fn(),
    },
  },
};

(global as any).ipc = defaultIpc;

describe("DesktopLoginComponentService", () => {
  let service: DesktopLoginComponentService;
  let cryptoFunctionService: MockProxy<CryptoFunctionService>;
  let environmentService: MockProxy<EnvironmentService>;
  let passwordGenerationService: MockProxy<PasswordGenerationServiceAbstraction>;
  let platformUtilsService: MockProxy<ElectronPlatformUtilsService>;
  let ssoLoginService: MockProxy<SsoLoginServiceAbstraction>;
  let i18nService: MockProxy<I18nService>;
  let toastService: MockProxy<ToastService>;
  let ssoUrlService: MockProxy<SsoUrlService>;

  beforeEach(() => {
    cryptoFunctionService = mock<CryptoFunctionService>();
    environmentService = mock<EnvironmentService>();
    environmentService.environment$ = of({
      getWebVaultUrl: () => "https://webvault.vowkey.com",
      getRegion: () => "US",
      getUrls: () => ({}),
      isCloud: () => true,
      getApiUrl: () => "https://api.vowkey.com",
    } as Environment);

    passwordGenerationService = mock<PasswordGenerationServiceAbstraction>();
    platformUtilsService = mock<ElectronPlatformUtilsService>();
    ssoLoginService = mock<SsoLoginServiceAbstraction>();
    i18nService = mock<I18nService>();
    toastService = mock<ToastService>();
    platformUtilsService.getClientType.mockReturnValue(ClientType.Desktop);
    ssoUrlService = mock<SsoUrlService>();

    TestBed.configureTestingModule({
      providers: [
        {
          provide: DesktopLoginComponentService,
          useFactory: () =>
            new DesktopLoginComponentService(
              cryptoFunctionService,
              environmentService,
              passwordGenerationService,
              platformUtilsService,
              ssoLoginService,
              i18nService,
              toastService,
              ssoUrlService,
            ),
        },
        { provide: DefaultLoginComponentService, useExisting: DesktopLoginComponentService },
        { provide: CryptoFunctionService, useValue: cryptoFunctionService },
        { provide: EnvironmentService, useValue: environmentService },
        { provide: PasswordGenerationServiceAbstraction, useValue: passwordGenerationService },
        { provide: PlatformUtilsService, useValue: platformUtilsService },
        { provide: SsoLoginServiceAbstraction, useValue: ssoLoginService },
        { provide: I18nService, useValue: i18nService },
        { provide: ToastService, useValue: toastService },
        { provide: SsoUrlService, useValue: ssoUrlService },
      ],
    });

    service = TestBed.inject(DesktopLoginComponentService);
  });

  afterEach(() => {
    // Restore the original ipc object after each test
    (global as any).ipc = { ...defaultIpc };

    jest.clearAllMocks();
  });

  it("creates the service", () => {
    expect(service).toBeTruthy();
  });

  describe("redirectToSso", () => {
    const permutations = [
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ];

    permutations.forEach(([isAppImage, isDev]) => {
      it(`uses localhost loopback callback for isAppImage=${isAppImage}, isDev=${isDev}`, async () => {
        (global as any).ipc.platform.isAppImage = isAppImage;
        (global as any).ipc.platform.isDev = isDev;

        const email = "test@bitwarden.com";
        const state = "testState";
        const codeVerifier = "testCodeVerifier";
        const codeChallenge = "testCodeChallenge";

        passwordGenerationService.generatePassword.mockResolvedValueOnce(state);
        passwordGenerationService.generatePassword.mockResolvedValueOnce(codeVerifier);
        jest.spyOn(Utils, "fromArrayToUrlB64").mockReturnValue(codeChallenge);

        await service.redirectToSsoLogin(email);

        expect(ipc.platform.localhostCallbackService.openSsoPrompt).toHaveBeenCalledWith(
          codeChallenge,
          state,
          email,
          undefined,
        );
      });
    });

    it("falls back to vowkey://sso-callback when all localhost SSO ports are in use", async () => {
      const email = "test@bitwarden.com";
      const state = "testState";
      const codeVerifier = "testCodeVerifier";
      const codeChallenge = "testCodeChallenge";

      passwordGenerationService.generatePassword.mockResolvedValueOnce(state);
      passwordGenerationService.generatePassword.mockResolvedValueOnce(codeVerifier);
      jest.spyOn(Utils, "fromArrayToUrlB64").mockReturnValue(codeChallenge);
      ipc.platform.localhostCallbackService.openSsoPrompt.mockRejectedValueOnce(
        new Error("All available SSO ports in use"),
      );

      await service.redirectToSsoLogin(email);

      expect(ssoLoginService.setSsoState).toHaveBeenCalledWith(state);
      expect(ssoLoginService.setCodeVerifier).toHaveBeenCalledWith(codeVerifier);
      expect(platformUtilsService.launchUri).toHaveBeenCalled();
    });
  });

  describe("redirectToSsoLoginWithOrganizationSsoIdentifier", () => {
    const permutations = [
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ];

    permutations.forEach(([isAppImage, isDev]) => {
      it("calls redirectToSso with orgSsoIdentifier via localhost callback", async () => {
        (global as any).ipc.platform.isAppImage = isAppImage;
        (global as any).ipc.platform.isDev = isDev;

        const email = "test@bitwarden.com";
        const state = "testState";
        const codeVerifier = "testCodeVerifier";
        const codeChallenge = "testCodeChallenge";
        const orgSsoIdentifier = "orgSsoId";

        passwordGenerationService.generatePassword.mockResolvedValueOnce(state);
        passwordGenerationService.generatePassword.mockResolvedValueOnce(codeVerifier);
        jest.spyOn(Utils, "fromBufferToUrlB64").mockReturnValue(codeChallenge);

        await service.redirectToSsoLoginWithOrganizationSsoIdentifier(email, orgSsoIdentifier);

        expect(ipc.platform.localhostCallbackService.openSsoPrompt).toHaveBeenCalledWith(
          codeChallenge,
          state,
          email,
          orgSsoIdentifier,
        );
      });
    });

    it("falls back to vowkey://sso-callback with orgSsoIdentifier when localhost ports are busy", async () => {
      const email = "test@bitwarden.com";
      const state = "testState";
      const codeVerifier = "testCodeVerifier";
      const codeChallenge = "testCodeChallenge";
      const orgSsoIdentifier = "orgSsoId";

      passwordGenerationService.generatePassword.mockResolvedValueOnce(state);
      passwordGenerationService.generatePassword.mockResolvedValueOnce(codeVerifier);
      jest.spyOn(Utils, "fromBufferToUrlB64").mockReturnValue(codeChallenge);
      ipc.platform.localhostCallbackService.openSsoPrompt.mockRejectedValueOnce(
        new Error("All available SSO ports in use"),
      );

      await service.redirectToSsoLoginWithOrganizationSsoIdentifier(email, orgSsoIdentifier);

      expect(ssoUrlService.buildSsoUrl).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        email,
        orgSsoIdentifier,
      );
      expect(ssoLoginService.setSsoState).toHaveBeenCalledWith(state);
      expect(ssoLoginService.setCodeVerifier).toHaveBeenCalledWith(codeVerifier);
      expect(platformUtilsService.launchUri).toHaveBeenCalled();
    });
  });
});
