import { firstValueFrom, map } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { EnvironmentService } from "@vowkey/common/platform/abstractions/environment.service";
import { SyncService } from "@vowkey/common/vault/abstractions/sync/sync.service.abstraction";
import { LogService } from "@vowkey/logging";
import { UnlockService } from "@vowkey/unlock";
import { UserId } from "@vowkey/user-core";

import { Response } from "../models/response";
import { TemplateResponse } from "../models/response/template.response";

export class StatusCommand {
  constructor(
    private envService: EnvironmentService,
    private syncService: SyncService,
    private accountService: AccountService,
    private authService: AuthService,
    private unlockService: UnlockService,
    private logService: LogService,
  ) {}

  async run(): Promise<Response> {
    try {
      const baseUrl = await this.baseUrl();
      const lastSync = await this.syncService.getLastSync();
      const [userId, email] = await firstValueFrom(
        this.accountService.activeAccount$.pipe(map((a) => [a?.id, a?.email])),
      );
      const status = await this.status(userId);

      return Response.success(
        new TemplateResponse({
          serverUrl: baseUrl,
          lastSync: lastSync,
          userEmail: email,
          userId: userId,
          status: status,
        }),
      );
    } catch (e) {
      return Response.error(e);
    }
  }

  private async baseUrl(): Promise<string | undefined> {
    const env = await firstValueFrom(this.envService.environment$);
    return env.getUrls().base;
  }

  private async status(
    userId: UserId | undefined,
  ): Promise<"unauthenticated" | "locked" | "unlocked"> {
    if (userId != null) {
      // A failed auto-unlock is reported as a locked vault rather than an errored command.
      try {
        await this.unlockService.unlockWithAutoUnlockKey(userId);
      } catch (e) {
        this.logService.error("[StatusCommand] Failed to unlock with the never-lock key", e);
      }
    }

    const authStatus = await this.authService.getAuthStatus();
    if (authStatus === AuthenticationStatus.Unlocked) {
      return "unlocked";
    } else if (authStatus === AuthenticationStatus.Locked) {
      return "locked";
    } else {
      return "unauthenticated";
    }
  }
}
