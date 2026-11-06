// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import * as http from "http";

import { app, BrowserWindow, ipcMain } from "electron";
import { firstValueFrom } from "rxjs";

import { SsoUrlService } from "@vowkey/auth/common";
import { ClientType } from "@vowkey/common/enums";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { MessageSender } from "@vowkey/common/platform/messaging";

/**
 * The SSO Localhost login service uses a local host listener as fallback in case scheme handling deeplinks does not work.
 * This way it is possible to log in with SSO on appimage and electron dev using the same methods that the cli uses.
 */
export class SSOLocalhostCallbackService {
  private ssoRedirectUri = "";
  // We will only track one server at a time for use-case and performance considerations.
  // This will result in a last-one-wins behavior if multiple SSO flows are started simultaneously.
  private currentServer: http.Server | null = null;

  constructor(
    private environmentService: EnvironmentService,
    private messagingService: MessageSender,
    private ssoUrlService: SsoUrlService,
  ) {
    ipcMain.handle(
      "openSsoPrompt",
      async (event, { codeChallenge, state, email, orgSsoIdentifier }) => {
        // Close any existing server before starting new one
        if (this.currentServer) {
          await this.closeCurrentServer();
        }

        return this.openSsoPrompt(codeChallenge, state, email, orgSsoIdentifier).then(
          ({ ssoCode, recvState }) => {
            this.messagingService.send("setFocus");
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              if (win.isMinimized()) {
                win.restore();
              }
              win.show();
              win.focus();
            }
            app.focus({ steal: true });
            this.messagingService.send("ssoCallback", {
              code: ssoCode,
              state: recvState,
              redirectUri: this.ssoRedirectUri,
            });
          },
        );
      },
    );
  }

  private async closeCurrentServer(): Promise<void> {
    if (!this.currentServer) {
      return;
    }

    return new Promise<void>((resolve) => {
      this.currentServer!.close(() => {
        this.currentServer = null;
        resolve();
      });
    });
  }

  private async openSsoPrompt(
    codeChallenge: string,
    state: string,
    email: string,
    orgSsoIdentifier?: string,
  ): Promise<{ ssoCode: string; recvState: string }> {
    // Use the global environment because the user-scoped environment is not set until authentication is complete.
    const env = await firstValueFrom(this.environmentService.globalEnvironment$);

    return new Promise((resolve, reject) => {
      const callbackServer = http.createServer((req, res) => {
        const urlString = "http://localhost" + req.url;
        const url = new URL(urlString);
        const code = url.searchParams.get("code");
        if (code == null) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        const receivedState = url.searchParams.get("state");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (code != null && receivedState != null && this.checkState(receivedState, state)) {
          res.writeHead(200);
          res.end(this.renderCallbackHtml(true));
          this.currentServer = null;
          callbackServer.close(() =>
            resolve({
              ssoCode: code,
              recvState: receivedState,
            }),
          );
        } else {
          res.writeHead(400);
          res.end(this.renderCallbackHtml(false));
          this.currentServer = null;
          callbackServer.close(() => reject(new Error("SSO state mismatch")));
        }
      });

      // Store reference to current server
      this.currentServer = callbackServer;

      const webUrl = env.getWebVaultUrl();

      const tryNextPort = (port: number) => {
        if (port > 8070) {
          this.currentServer = null;
          reject("All available SSO ports in use");
          return;
        }

        this.ssoRedirectUri = "http://localhost:" + port;
        const ssoUrl = this.ssoUrlService.buildSsoUrl(
          webUrl,
          ClientType.Desktop,
          this.ssoRedirectUri,
          state,
          codeChallenge,
          email,
          orgSsoIdentifier,
        );

        // Set up error handler before attempting to listen
        callbackServer.once("error", (err: any) => {
          if (err.code === "EADDRINUSE") {
            // Port is in use, try next port
            tryNextPort(port + 1);
          } else {
            // Another error - reject and set the current server to null
            // (one server alive at a time)
            this.currentServer = null;
            reject();
          }
        });

        // Attempt to listen on the port
        callbackServer.listen(port, "localhost", () => {
          // Success - remove error listener and launch SSO
          callbackServer.removeAllListeners("error");

          this.messagingService.send("launchUri", {
            url: ssoUrl,
          });
        });
      };

      // Start trying from port 8065
      tryNextPort(8065);

      // Don't allow any server to stay up for more than 5 minutes;
      // this gives plenty of time to complete SSO but ensures we don't
      // have a server running indefinitely.
      setTimeout(
        () => {
          if (this.currentServer === callbackServer) {
            this.currentServer = null;
          }
          callbackServer.close(() => reject(new Error("SSO prompt timed out")));
        },
        5 * 60 * 1000,
      );
    });
  }

  private renderCallbackHtml(success: boolean): string {
    const title = success ? "Signed in to Vowkey" : "Sign-in could not finish";
    const subtitle = success
      ? "Return to the Vowkey desktop app to continue. You can close this tab."
      : "Return to the Vowkey desktop app and try again.";
    const badgeBg = success ? "#e4f4ec" : "#fdecea";
    const badgeColor = success ? "#128a5a" : "#c2352b";
    const iconSvg = success
      ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/></svg>';
    const autoCloseScript = success
      ? "<script>setTimeout(function(){try{window.close();}catch(e){}},400);</script>"
      : "";
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      `<title>${title}</title>` +
      "<style>" +
      "body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f4f0;color:#121216;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;-webkit-font-smoothing:antialiased;}" +
      ".card{max-width:360px;width:100%;background:#fff;border:1px solid #e2e0da;border-radius:16px;padding:28px 24px;text-align:center;box-shadow:0 1px 2px rgba(18,18,22,.04),0 12px 28px -12px rgba(18,18,22,.09);}" +
      `.badge{width:44px;height:44px;margin:0 auto 14px;border-radius:12px;display:grid;place-items:center;background:${badgeBg};color:${badgeColor};}` +
      "h1{margin:0 0 8px;font-size:19px;font-weight:600;letter-spacing:-0.02em;}" +
      "p{margin:0;font-size:14px;line-height:1.5;color:#5b5d66;}" +
      "</style></head><body>" +
      `<div class="card"><div class="badge">${iconSvg}</div><h1>${title}</h1><p>${subtitle}</p></div>` +
      autoCloseScript +
      "</body></html>"
    );
  }

  private checkState(state: string, checkState: string): boolean {
    if (state === null || state === undefined) {
      return false;
    }
    if (checkState === null || checkState === undefined) {
      return false;
    }

    const stateSplit = state.split("_identifier=");
    const checkStateSplit = checkState.split("_identifier=");
    return stateSplit[0] === checkStateSplit[0];
  }
}
