// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { filter, firstValueFrom, Observable } from "rxjs";

import { AccountService } from "@vowkey/common/auth/abstractions/account.service";
import { AuthService } from "@vowkey/common/auth/abstractions/auth.service";
import { AuthenticationStatus } from "@vowkey/common/auth/enums/authentication-status";
import { getOptionalUserId } from "@vowkey/common/auth/services/account.service";
import { ExtensionCommand, ExtensionCommandType } from "@vowkey/common/autofill/constants";
import { PlatformUtilsService } from "@vowkey/common/platform/abstractions/platform-utils.service";
import {
  IntraprocessMessageSender,
  isExternalMessage,
  MessageListener,
} from "@vowkey/common/platform/messaging";
import { CipherType } from "@vowkey/common/vault/enums";
import { LockService, LockSource } from "@vowkey/unlock";

// FIXME (PM-22628): Popup imports are forbidden in background
// eslint-disable-next-line no-restricted-imports
import { openUnlockPopout } from "../auth/popup/utils/auth-popout-window";
import {
  ADD_TO_LOCKED_VAULT_PENDING_NOTIFICATIONS,
  LockedVaultPendingNotificationsData,
  RETRY_SENDER,
  RETRY_WHEN_UNLOCK_COMPLETED,
} from "../autofill/background/abstractions/notification.background";
import { BrowserApi } from "../platform/browser/browser-api";

import MainBackground from "./main.background";

export default class CommandsBackground {
  private isSafari: boolean;
  private isVivaldi: boolean;

  constructor(
    private main: MainBackground,
    private platformUtilsService: PlatformUtilsService,
    private authService: AuthService,
    private generatePasswordToClipboard: () => Observable<string>,
    private accountService: AccountService,
    private lockService: LockService,
    /** Publishes the retry queued for after the unlock. */
    private intraprocessMessageSender: IntraprocessMessageSender,
    private messageListener: MessageListener,
  ) {
    this.isSafari = this.platformUtilsService.isSafari();
    this.isVivaldi = this.platformUtilsService.isVivaldi();
  }

  init() {
    this.messageListener
      .messages$(RETRY_WHEN_UNLOCK_COMPLETED)
      .pipe(filter((message) => !isExternalMessage(message)))
      .subscribe(({ data }) => {
        this.handleUnlockCompleted(data).catch((error) => this.main.logService.error(error));
      });

    if (chrome && chrome.commands) {
      chrome.commands.onCommand.addListener(async (command: string) => {
        await this.processCommand(command);
      });
    }
  }

  /**
   * Replays the command the user issued while the vault was locked.
   *
   * @param data - The command the background retained when it opened the unlock popout
   * @see {@link RETRY_WHEN_UNLOCK_COMPLETED}
   */
  private async handleUnlockCompleted(data: LockedVaultPendingNotificationsData) {
    if (data?.target !== "commands.background") {
      return;
    }

    // `RETRY_SENDER` is only retained when retry commands are sent through intraprocess messaging.
    // This ensures that the command to retry never round-tripped through a untrusted environment.
    const sender = data.commandToRetry?.[RETRY_SENDER];

    // replayed commands must identify the tab they target; they cannot default to the active tab.
    if (!sender?.tab) {
      return;
    }

    await this.processCommand(data.commandToRetry.message.command, sender);
  }

  private async processCommand(command: string, sender?: chrome.runtime.MessageSender) {
    switch (command) {
      case ExtensionCommand.GeneratePassword:
        await firstValueFrom(this.generatePasswordToClipboard(), { defaultValue: undefined });
        break;
      case ExtensionCommand.AutofillLogin:
        await this.triggerAutofillCommand(
          sender ? sender.tab : null,
          ExtensionCommand.AutofillCommand,
        );
        break;
      case ExtensionCommand.AutofillCard:
        await this.triggerAutofillCommand(
          sender ? sender.tab : null,
          ExtensionCommand.AutofillCard,
        );
        break;
      case ExtensionCommand.AutofillIdentity:
        await this.triggerAutofillCommand(
          sender ? sender.tab : null,
          ExtensionCommand.AutofillIdentity,
        );
        break;
      case ExtensionCommand.OpenPopup:
        await this.openPopup();
        break;
      case ExtensionCommand.LockVault: {
        const activeUserId = await firstValueFrom(
          getOptionalUserId(this.accountService.activeAccount$),
        );
        if (activeUserId) {
          await this.lockService.lock(activeUserId, LockSource.Manual);
        } else if (typeof this.main.localVaultService?.lock === "function") {
          await this.main.localVaultService.lock();
        }
        break;
      }
      default:
        break;
    }
  }

  private async getEffectiveAuthStatus(): Promise<AuthenticationStatus> {
    const authStatus = await this.authService.getAuthStatus();
    if (
      authStatus === AuthenticationStatus.LoggedOut &&
      typeof this.main.localVaultService?.initialize === "function" &&
      typeof this.main.localVaultService?.state$?.value === "string"
    ) {
      await this.main.localVaultService.initialize();
      if (this.main.localVaultService.state$.value === "persisted-locked") {
        return AuthenticationStatus.Locked;
      }
      await this.main.localVaultService.ensureUnlocked();
      return AuthenticationStatus.Unlocked;
    }
    return authStatus;
  }

  private async triggerAutofillCommand(
    tab?: chrome.tabs.Tab,
    commandSender?: ExtensionCommandType,
  ) {
    if (!tab) {
      tab = await BrowserApi.getTabFromCurrentWindowId();
    }

    if (tab == null || !commandSender) {
      return;
    }

    if ((await this.getEffectiveAuthStatus()) < AuthenticationStatus.Unlocked) {
      await openUnlockPopout(tab, () =>
        this.intraprocessMessageSender.send(ADD_TO_LOCKED_VAULT_PENDING_NOTIFICATIONS, {
          data: {
            commandToRetry: {
              message: {
                command:
                  commandSender === ExtensionCommand.AutofillCommand
                    ? ExtensionCommand.AutofillLogin
                    : commandSender,
              },
              [RETRY_SENDER]: { tab: tab },
            },
            target: "commands.background",
          },
        }),
      );
      return;
    }

    switch (commandSender) {
      case ExtensionCommand.AutofillCard:
        this.main.autofillOrchestrator.autofillActiveTabForCipherType(tab, CipherType.Card);
        break;
      case ExtensionCommand.AutofillIdentity:
        this.main.autofillOrchestrator.autofillActiveTabForCipherType(tab, CipherType.Identity);
        break;
      default:
        this.main.autofillOrchestrator.autofillActiveTabFromCommand(tab);
        break;
    }
  }

  private async openPopup() {
    // Chrome APIs cannot open popup
    if (!this.isSafari) {
      return;
    }

    await this.main.openPopup();
  }
}
