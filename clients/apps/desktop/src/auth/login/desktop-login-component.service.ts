// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Injectable } from "@angular/core";
import { firstValueFrom } from "rxjs";

import { DefaultLoginComponentService, LoginComponentService } from "@vowkey/auth/angular";
import { DESKTOP_SSO_CALLBACK, SsoUrlService } from "@vowkey/auth/common";
import { SsoLoginServiceAbstraction } from "@vowkey/common/auth/abstractions/sso-login.service.abstraction";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import { ToastService } from "@vowkey/components";
import { PasswordGenerationServiceAbstraction } from "@vowkey/generator-legacy";
// eslint-disable-next-line no-restricted-imports
import { CryptoFunctionService } from "@vowkey/legacy-crypto";

@Injectable()
export class DesktopLoginComponentService
  extends DefaultLoginComponentService
  implements LoginComponentService
{
  constructor(
    protected cryptoFunctionService: CryptoFunctionService,
    protected environmentService: EnvironmentService,
    protected passwordGenerationService: PasswordGenerationServiceAbstraction,
    protected platformUtilsService: PlatformUtilsService,
    protected ssoLoginService: SsoLoginServiceAbstraction,
    protected i18nService: I18nService,
    protected toastService: ToastService,
    protected ssoUrlService: SsoUrlService,
  ) {
    super(
      cryptoFunctionService,
      environmentService,
      passwordGenerationService,
      platformUtilsService,
      ssoLoginService,
    );
  }

  /**
   * On the desktop, redirecting to the SSO login page is done via a new browser window, opened
   * to the SSO component on the web client.
   * @param email the email of the user trying to log in, used to look up the org SSO identifier
   * @param state the state that will be used to verify the SSO login, which needs to be passed to the IdP
   * @param codeChallenge the challenge that will be verified after the code is returned from the IdP, which needs to be passed to the IdP
   */
  protected override async redirectToSso(
    email: string,
    state: string,
    codeChallenge: string,
    orgSsoIdentifier?: string,
  ): Promise<void> {
    // Prefer the localhost loopback callback on all desktop builds so the browser returns
    // seamlessly without OS custom-scheme confirmation prompts; fall back to vowkey:// if ports 8065-8070 are all busy.
    if (ipc?.platform?.localhostCallbackService?.openSsoPrompt) {
      const fallbackNeeded = await this.initiateSsoThroughLocalhostCallback(
        email,
        state,
        codeChallenge,
        orgSsoIdentifier,
      );
      if (!fallbackNeeded) {
        return;
      }
    }

    const env = await firstValueFrom(this.environmentService.environment$);
    const webVaultUrl = env.getWebVaultUrl();
    const redirectUri = DESKTOP_SSO_CALLBACK;

    const ssoWebAppUrl = this.ssoUrlService.buildSsoUrl(
      webVaultUrl,
      this.clientType,
      redirectUri,
      state,
      codeChallenge,
      email,
      orgSsoIdentifier,
    );

    this.platformUtilsService.launchUri(ssoWebAppUrl);
  }

  private async initiateSsoThroughLocalhostCallback(
    email: string,
    state: string,
    challenge: string,
    orgSsoIdentifier?: string,
  ): Promise<boolean> {
    try {
      await ipc.platform.localhostCallbackService.openSsoPrompt(
        challenge,
        state,
        email,
        orgSsoIdentifier,
      );
      return false;
    } catch (err) {
      if (String(err).includes("All available SSO ports in use")) {
        return true;
      }
      if (!String(err).includes("SSO prompt timed out")) {
        this.toastService.showToast({
          variant: "error",
          title: this.i18nService.t("errorOccurred"),
          message: this.i18nService.t("ssoError"),
        });
      }
      return false;
    }
  }
}
