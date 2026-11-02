// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import * as path from "path";

import { app, BrowserWindow, Menu, MenuItemConstructorOptions, nativeImage, Tray } from "electron";

import { I18nService } from "@vowkey/common/platform/abstractions/i18n.service";
import { MessagingService } from "@vowkey/common/platform/abstractions/messaging.service";
import { BiometricsService } from "@vowkey/key-management";

import { DesktopSettingsService } from "../platform/services/desktop-settings.service";
import type { AppPresenceMode } from "../quick-bar/types";

import { WindowMain } from "./window.main";

export class TrayMain {
  contextMenu: Menu;
  /** Toggles the Quick Bar on left-click; set once QuickBarMain initializes. */
  onIconClick: ((bounds: Electron.Rectangle) => void) | null = null;
  /** Fills the frontmost app, browser tab, or open file from the menu bar right-click menu. */
  onFillClick: (() => void) | null = null;
  /** Opens Vowkey's Settings sheet from the menu bar right-click menu. */
  onSettingsClick: (() => void) | null = null;

  private appName: string;
  private tray: Tray;
  private icon: string | Electron.NativeImage;
  private pressedIcon: Electron.NativeImage;
  private appPresence: AppPresenceMode = "both";
  private runInBackground = false;

  constructor(
    private windowMain: WindowMain,
    private i18nService: I18nService,
    private desktopSettingsService: DesktopSettingsService,
    private messagingService: MessagingService,
    private biometricService: BiometricsService,
  ) {
    this.desktopSettingsService.runInBackground$.subscribe((value) => {
      this.runInBackground = Boolean(value);
    });
    if (process.platform === "win32") {
      this.icon = path.join(__dirname, "/images/icon.ico");
    } else if (process.platform === "darwin") {
      const nImage = nativeImage.createFromPath(path.join(__dirname, "/images/icon-template.png"));
      nImage.setTemplateImage(true);
      this.icon = nImage;
      this.pressedIcon = nativeImage.createFromPath(
        path.join(__dirname, "/images/icon-highlight.png"),
      );
    } else {
      this.icon = path.join(__dirname, "/images/icon.png");
    }
  }

  async init(appName: string, additionalMenuItems: MenuItemConstructorOptions[] = null) {
    this.appName = appName;

    const menuItemOptions: MenuItemConstructorOptions[] = [
      {
        label: "Toggle Quick Bar",
        accelerator: "Control+Shift+Space",
        click: () => {
          const bounds = this.tray ? this.tray.getBounds() : undefined;
          if (this.onIconClick) {
            this.onIconClick(bounds);
          } else {
            void this.restoreFromTray();
          }
        },
      },
      {
        label: "Fill current window",
        accelerator: "CommandOrControl+\\",
        click: () => {
          if (this.onFillClick) {
            this.onFillClick();
          }
        },
      },
      { type: "separator" },
      {
        label: "Open Vowkey",
        click: () => void this.restoreFromTray(),
      },
      {
        label: "Settings…",
        accelerator: "CommandOrControl+,",
        click: () => {
          if (this.onSettingsClick) {
            this.onSettingsClick();
          } else {
            void this.restoreFromTray();
          }
        },
      },
      { type: "separator" },
      {
        label: "Lock",
        id: "lockVault",
        enabled: true,
        click: () => this.messagingService.send("lockVault"),
      },
      {
        label: "Quit Vowkey",
        accelerator: this.isDarwin() ? "Command+Q" : undefined,
        click: () => this.closeWindow(),
      },
    ];

    if (additionalMenuItems != null) {
      const filtered = additionalMenuItems.filter((item) => item.id !== "lockVault");
      if (filtered.length > 0) {
        menuItemOptions.splice(menuItemOptions.length - 1, 0, ...filtered);
      }
    }

    this.contextMenu = Menu.buildFromTemplate(menuItemOptions);
    this.setAppPresence(this.appPresence);
  }

  setAppPresence(presence: AppPresenceMode) {
    this.appPresence = presence;
    if (presence === "dock") {
      if (this.isDarwin()) {
        this.showDock();
      }
      this.removeTray(false);
      return;
    }
    this.showTray();
    if (this.isDarwin()) {
      if (presence === "menubar") {
        this.hideDock();
      } else {
        this.showDock();
      }
    }
  }

  getAppPresence(): AppPresenceMode {
    return this.appPresence;
  }

  setupWindowListeners(win: BrowserWindow) {
    win.on("restore", async () => {
      await this.biometricService.setShouldAutopromptNow(true);
    });

    win.on("close", (e: Event) => {
      if (this.windowMain.isQuitting) {
        return;
      }

      if (this.appPresence !== "dock" && this.runInBackground) {
        // Keep running in the background: closing the window hides it while Quick Bar stays ready.
        e.preventDefault();
        this.hideToTray();
      } else {
        // Not running in the background: closing the window quits the application.
        // Setting isQuitting ensures macOS also quits via the window-all-closed handler.
        this.windowMain.isQuitting = true;
      }
    });
  }

  removeTray(showWindow = true) {
    // Due to https://github.com/electron/electron/issues/17622
    // we cannot destroy the tray icon on linux.
    if (this.tray != null && process.platform !== "linux") {
      this.tray.destroy();
      this.tray = null;
    }

    if (showWindow && this.windowMain.win != null && !this.windowMain.win.isVisible()) {
      this.windowMain.win.show();
    }
  }

  hideToTray() {
    if (this.appPresence !== "dock") {
      this.showTray();
    }
    if (this.windowMain.win != null) {
      this.windowMain.win.hide();
    }
    if (this.isDarwin() && this.appPresence === "menubar") {
      this.hideDock();
    }
  }

  /**
   * Brings the application to the foreground. Recreates the window if it was destroyed
   * (macOS), unminimizes it if minimized, then shows and focuses it. This never hides
   * the window - foregrounding is not a toggle.
   */
  async restoreFromTray() {
    if (this.windowMain.win == null) {
      // On macOS, closing the window via the red button destroys the BrowserWindow instance.
      await this.windowMain.createWindow();
      this.windowMain.win.show();
    } else {
      if (this.windowMain.win.isMinimized()) {
        this.windowMain.win.restore();
      }
      this.windowMain.show();
      this.windowMain.win.focus();
    }

    if (this.isDarwin()) {
      if (this.appPresence !== "menubar") {
        this.showDock();
      }
      app.focus({ steal: true });
    }
  }

  showTray() {
    if (this.tray != null) {
      return;
    }

    this.tray = new Tray(this.icon);
    this.tray.setToolTip(this.appName);
    this.tray.on("click", (_event, bounds) =>
      this.onIconClick ? this.onIconClick(bounds) : void this.restoreFromTray(),
    );
    this.tray.on("right-click", () => {
      if (this.contextMenu != null) {
        this.tray.popUpContextMenu(this.contextMenu);
      }
    });

    if (this.pressedIcon != null) {
      this.tray.setPressedImage(this.pressedIcon);
    }
    // Never attach setContextMenu on macOS or Windows: doing so swallows left-click on macOS
    // instead of letting left-click toggle Quick Bar immediately.
    if (this.contextMenu != null && this.isLinux()) {
      this.tray.setContextMenu(this.contextMenu);
    }
  }

  updateContextMenu() {
    if (this.tray != null && this.contextMenu != null && this.isLinux()) {
      this.tray.setContextMenu(this.contextMenu);
    }
  }

  private hideDock() {
    app.dock.hide();
  }

  private showDock() {
    // FIXME: Verify that this floating promise is intentional. If it is, add an explanatory comment and ensure there is proper error handling.
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    app.dock.show();
  }

  private isDarwin() {
    return process.platform === "darwin";
  }

  private isLinux() {
    return process.platform === "linux";
  }

  private closeWindow() {
    this.windowMain.isQuitting = true;
    app.quit();
  }
}
