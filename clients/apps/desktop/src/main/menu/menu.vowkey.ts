import { BrowserWindow, MenuItemConstructorOptions } from "electron";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";

import { isMac } from "../platform-utils.main";
import { UpdaterMain } from "../updater.main";

import { FirstMenu } from "./menu.first";
import { MenuAccount } from "./menu.updater";
import { IMenubarMenu } from "./menubar";

// AKA: "FirstMenu" or "MacMenu" - the first menu that shows on all macOs apps
export class VowkeyMenu extends FirstMenu implements IMenubarMenu {
  readonly id: string = "vowkey";
  readonly label: string = "Vowkey";

  get items(): MenuItemConstructorOptions[] {
    const items = [this.aboutVowkey, this.checkForUpdates];
    if (this.aboutVowkey.visible === true || this.checkForUpdates.visible === true) {
      items.push(this.separator);
    }
    items.push(this.settings);
    items.push(this.lock);
    items.push(this.lockAll);
    items.push(this.logOut);
    items.push(this.separator);
    items.push(this.services);

    if (
      this.hideVowkey.visible === true ||
      this.hideOthers.visible === true ||
      this.showAll.visible === true
    ) {
      items.push(this.separator);
    }

    items.push(this.hideVowkey);
    items.push(this.hideOthers);
    items.push(this.showAll);

    if (this.quitVowkey.visible === true) {
      items.push(this.separator);
    }
    items.push(this.quitVowkey);
    return items;
  }

  constructor(
    i18nService: I18nService,
    messagingService: MessagingService,
    updater: UpdaterMain,
    window: BrowserWindow,
    accounts: { [userId: string]: MenuAccount },
    isLocked: boolean,
    isLockable: boolean,
  ) {
    super(i18nService, messagingService, updater, window, accounts, isLocked, isLockable);
  }

  private get aboutVowkey(): MenuItemConstructorOptions {
    return {
      id: "aboutVowkey",
      label: this.localize("aboutVowkey"),
      role: "about",
      visible: isMac(),
    };
  }

  private get services(): MenuItemConstructorOptions {
    return {
      id: "services",
      label: this.localize("services"),
      role: "services",
      submenu: [],
      visible: isMac(),
    };
  }

  private get hideVowkey(): MenuItemConstructorOptions {
    return {
      id: "hideVowkey",
      label: this.localize("hideVowkey"),
      role: "hide",
      visible: isMac(),
    };
  }

  private get hideOthers(): MenuItemConstructorOptions {
    return {
      id: "hideOthers",
      label: this.localize("hideOthers"),
      role: "hideOthers",
      visible: isMac(),
    };
  }

  private get showAll(): MenuItemConstructorOptions {
    return {
      id: "showAll",
      label: this.localize("showAll"),
      role: "unhide",
      visible: isMac(),
    };
  }

  private get quitVowkey(): MenuItemConstructorOptions {
    return {
      id: "quitVowkey",
      label: this.localize("quitVowkey"),
      role: "quit",
      visible: isMac(),
    };
  }
}
