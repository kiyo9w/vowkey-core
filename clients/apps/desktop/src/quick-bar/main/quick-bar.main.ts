import { deferred } from "@vowkey/common/platform/misc/deferred";
import { execFile } from "child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import * as fs from "fs/promises";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { firstValueFrom } from "rxjs";

import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Rectangle,
  screen,
  shell,
  systemPreferences,
} from "electron";

import * as desktopNapi from "@vowkey/desktop-napi";
import { autostart, autotype_mvp } from "@vowkey/desktop-napi";
import { LogService } from "@vowkey/logging";

import { AiFillRunner } from "../../ai-fill/ai-fill-runner";
import { vaultForAgent, withheldFromAgent } from "../../ai-fill/fill-tools";
import { NativeMessagingMain } from "../../main/native-messaging.main";
import { TrayMain } from "../../main/tray.main";
import { WindowMain } from "../../main/window.main";
import { DesktopSettingsService } from "../../platform/services/desktop-settings.service";
import {
  AiFillAgentOption,
  AiFillProgressMessage,
  AppPresenceMode,
  DesktopShellPreferences,
  FocusedInputField,
  FrontContext,
  PasswordCredentialEntry,
  PillStatus,
  QuickBarRequest,
  QuickBarVaultItem,
  QuickBarWindowMode,
} from "../types";

import { ConcealedSegment, MacosAxBridge } from "./macos-ax-bridge";
import { MacosPermissionGuide } from "./macos-permission-guide";

const run = promisify(execFile);

/** Opens the Quick Bar from any app. */
export const QUICK_BAR_SHORTCUT = "Control+Shift+Space";
/** Fills the frontmost browser tab, native app login, or open form from anywhere on the Mac. */
export const UNIVERSAL_FILL_SHORTCUT = "CommandOrControl+\\";

const PILL_WIDTH = 440;
const PILL_HEIGHT = 56;
const FIELD_PILL_WIDTH = 176;
const FIELD_PILL_HEIGHT = 32;
/** How long the app in front needs to take keyboard focus back before keys are sent to it. */
const REFOCUS_MS = 160;
const FILLABLE = /\.(pdf|docx|xlsx|hwpx|png|jpe?g|heic|webp|tiff?)$/i;
const VOWKEY_TEAM_APP_GROUP = "9ASJ75KP6N.com.vowkey.desktop";
const SHELL_PREFS_FILENAME = "vowkey-shell-prefs.json";
const AUTOSTART_FLAG = "--autostart";

const DEFAULT_SHELL_PREFS: DesktopShellPreferences = {
  appPresence: "both",
  quickBarMode: "floating",
  floatAboveWindows: true,
  openAtLogin: false,
};

const FRONT_CONTEXT_APPLESCRIPT = `
set appName to ""
set bundleId to ""
set winTitle to ""
set docUrl to ""
set tabUrl to ""
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set appName to name of frontProc
  try
    set bundleId to bundle identifier of frontProc
  end try
  try
    set winTitle to name of front window of frontProc
  end try
  try
    set docUrl to value of attribute "AXDocument" of front window of frontProc
  end try
end tell
if bundleId is "com.apple.Safari" or bundleId is "com.apple.SafariTechnologyPreview" then
  try
    tell application id bundleId to set tabUrl to URL of current tab of front window
  end try
else if bundleId is "com.google.Chrome" or bundleId is "com.brave.Browser" or bundleId is "com.microsoft.edgemac" or bundleId is "com.vivaldi.Vivaldi" or bundleId is "org.chromium.Chromium" or bundleId is "company.thebrowser.Browser" then
  try
    tell application id bundleId to set tabUrl to URL of active tab of front window
  end try
end if
return appName & linefeed & bundleId & linefeed & winTitle & linefeed & docUrl & linefeed & tabUrl
`;

type FieldPillAction =
  | {
      kind: "login";
      label: string;
      username: string;
      password: string;
      totp?: string;
      onlyPassword?: boolean;
    }
  | {
      kind: "detail";
      label: string;
      value: string;
    };

function buildFieldPillHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; user-select: none; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 174px;
    height: 28px;
    margin: 2px 1px;
    padding: 0 10px 0 8px;
    border-radius: 999px;
    border: 1px solid rgba(37, 99, 235, 0.28);
    background: rgba(250, 250, 252, 0.96);
    color: #15171c;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(15, 18, 26, 0.18);
    white-space: nowrap;
  }
  button:hover {
    border-color: #2563eb;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2563eb;
    flex: none;
  }
  #lbl {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-color-scheme: dark) {
    button {
      background: rgba(28, 30, 36, 0.96);
      color: #f3f4f7;
      border-color: rgba(59, 130, 246, 0.42);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.45);
    }
    .dot { background: #3b82f6; }
  }
</style>
</head>
<body>
  <button id="btn" type="button" title="Fill with Vowkey">
    <span class="dot"></span>
    <span id="lbl">Fill</span>
  </button>
  <script>
    const { ipcRenderer } = require("electron");
    ipcRenderer.on("fieldPill.label", (_e, text) => {
      document.getElementById("lbl").textContent = text || "Fill";
    });
    document.getElementById("btn").addEventListener("click", () => {
      ipcRenderer.send("fieldPill.fill");
    });
  </script>
</body>
</html>`;
}

/**
 * The Quick Bar: a click on the Vowkey icon in the menu bar or the taskbar, `Control+Shift+Space`,
 * or `⌘\` opens a native-vibrancy floating bar or fills the app/file in front directly.
 */
export class QuickBarMain {
  private pill: BrowserWindow | null = null;
  private fieldPill: BrowserWindow | null = null;
  private fieldPillAction: FieldPillAction | null = null;
  private fieldPillTimer: NodeJS.Timeout | null = null;
  private isRefreshingFieldPill = false;
  private anchor: { x: number; y: number; bottom: boolean } | null = null;
  private draggedPosition: { x: number; y: number } | null = null;
  private isSettingBounds = false;
  private isTypingIntoFrontApp = false;
  private floatingWatchTimer: NodeJS.Timeout | null = null;
  private front: FrontContext | null = null;
  private lastExternalHwnd: string | null = null;
  private prefs: DesktopShellPreferences = { ...DEFAULT_SHELL_PREFS };
  private pending = new Map<number, (result: unknown) => void>();
  private nextRequest = 1;
  private passwordSocketServers: Array<{ server: net.Server; socketPath: string }> = [];
  private axBridge: MacosAxBridge;
  private permissionGuide: MacosPermissionGuide;
  private aiFillRunner: AiFillRunner;
  private aiFillProgress: AiFillProgressMessage | null = null;

  constructor(
    private logService: LogService,
    private windowMain: WindowMain,
    private desktopSettingsService?: DesktopSettingsService,
    private trayMain?: TrayMain,
    private nativeMessagingMain?: NativeMessagingMain,
  ) {
    this.axBridge = new MacosAxBridge(app.getPath("userData"));
    this.permissionGuide = new MacosPermissionGuide(app.getPath("userData"));
    this.aiFillRunner = new AiFillRunner(app.getPath("userData"));
  }

  init() {
    (globalThis as { vowkeyQuickBar?: QuickBarMain }).vowkeyQuickBar = this;
    this.loadShellPreferencesSync();

    ipcMain.on("quickBar.response", (event, id: number, result: unknown) => {
      if (
        event.sender !== this.windowMain.win?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      ) {
        return;
      }
      this.pending.get(id)?.(result);
      this.pending.delete(id);
    });
    ipcMain.on("quickBar.agentPending", () => {
      if (this.pill?.isVisible()) {
        this.pill.webContents.send("pill.refresh");
      } else {
        void this.show();
      }
    });
    ipcMain.on("fieldPill.fill", () => {
      void this.executeFieldPillFill();
    });
    ipcMain.handle("quickBar.show", () => this.show());
    ipcMain.handle("quickBar.getShellPreferences", () => this.getShellPreferences());
    ipcMain.handle(
      "quickBar.updateShellPreferences",
      (_event, patch: Partial<DesktopShellPreferences>) => this.updateShellPreferences(patch),
    );
    ipcMain.handle("quickBar.accessibilityStatus", () => this.accessibilityStatus());
    ipcMain.handle("quickBar.requestAccessibility", () => this.requestAccessibility());
    ipcMain.handle("quickBar.showAccessibilityGuide", (_event, template: string) =>
      this.showAccessibilityGuide(template),
    );
    ipcMain.handle("quickBar.resetAccessibility", () => this.permissionGuide.resetAccessibility());
    ipcMain.handle("quickBar.relaunch", () => {
      app.relaunch();
      app.quit();
    });
    ipcMain.handle("pill.details", (_event, profileId?: string) =>
      this.ask({ kind: "details", profileId, front: this.front }),
    );
    ipcMain.handle(
      "pill.openProfile",
      async (_event, profileId: string, sourceId?: string, variantId?: string) => {
        this.openHub();
        return this.ask({ kind: "openProfile", profileId, sourceId, variantId });
      },
    );
    ipcMain.handle("pill.openItem", async (_event, cipherId: string) => {
      this.openHub();
      return this.ask({ kind: "openItem", cipherId });
    });
    ipcMain.handle("pill.unlock", (_event, password?: string) =>
      this.ask({ kind: "unlock", password }),
    );
    ipcMain.handle("pill.protect", (_event, password: string) =>
      this.ask({ kind: "protect", password }),
    );
    ipcMain.handle("pill.dismissProtection", () => this.ask({ kind: "dismissProtection" }));
    ipcMain.handle(
      "pill.agentDecision",
      (
        _event,
        payload: {
          decision: "allow_once" | "always_allow" | "deny";
          requestId?: string;
          entryIds?: string[];
          connectionId?: string;
        },
      ) => this.ask({ kind: "agentDecision", ...payload }),
    );
    ipcMain.handle("pill.type", (_event, value: string) => this.typeDetail(value));
    ipcMain.handle(
      "pill.typeLogin",
      (_event, username: string, password: string, totp?: string) =>
        this.typeLogin(username, password, totp),
    );
    ipcMain.handle("pill.copy", (_event, value: string) => {
      if (
        process.platform === "win32" &&
        typeof desktopNapi.writeConcealedClipboard === "function" &&
        desktopNapi.writeConcealedClipboard(value)
      ) {
        return;
      }
      clipboard.writeText(value);
    });
    ipcMain.handle("pill.add", (_event, file: string, profileId?: string) =>
      this.process(file, profileId, "auto"),
    );
    ipcMain.handle(
      "pill.pasteImage",
      (_event, name: string, bytes: Uint8Array, profileId?: string) =>
        this.processBytes(name || "Pasted image.png", new Uint8Array(bytes), profileId, "auto"),
    );
    ipcMain.handle("pill.pasteClipboardImage", (_event, profileId?: string) =>
      this.pasteClipboardImage(profileId),
    );
    ipcMain.handle("pill.scanScreen", (_event, profileId?: string) =>
      this.scanScreen(profileId),
    );
    ipcMain.handle("pill.fill", (_event, profileId?: string) => this.fillFromBar(profileId));
    ipcMain.handle("pill.setAiMode", (_event, on: boolean) =>
      this.updateShellPreferences({ aiMode: Boolean(on) }),
    );
    ipcMain.handle("pill.aiStop", () => this.aiFillRunner.cancel());
    ipcMain.handle("quickBar.aiAgents", async (): Promise<AiFillAgentOption[]> =>
      process.platform === "darwin" ? this.aiFillRunner.detect() : [],
    );
    ipcMain.on("pill.openHub", () => this.openHub());
    ipcMain.on("pill.hide", () => this.hide());
    ipcMain.on("pill.resize", (_event, height: number) => this.resize(height));

    this.startPasswordAutofillSockets();

    void app.whenReady().then(() => {
      if (process.platform === "darwin") {
        void this.axBridge.ensureBinary();
        void this.permissionGuide.ensureBinary();
        void this.aiFillRunner.bridge.ensureBinary().catch((): void => undefined);
        if (process.env.VOWKEY_E2E !== "1") {
          this.startFieldPillWatch();
        }
      }
      if (!globalShortcut.register(QUICK_BAR_SHORTCUT, () => void this.toggle())) {
        this.logService.warning(`${QUICK_BAR_SHORTCUT} is taken by another app.`);
      }
      if (!globalShortcut.register(UNIVERSAL_FILL_SHORTCUT, () => void this.universalFill())) {
        this.logService.warning(`${UNIVERSAL_FILL_SHORTCUT} is taken by another app.`);
      }
    });
    app.on("before-quit", () => {
      this.permissionGuide.close();
      this.stopFloatingWatch();
      this.stopFieldPillWatch();
      this.stopPasswordAutofillSockets();
      if (this.pill != null && !this.pill.isDestroyed()) {
        this.pill.destroy();
        this.pill = null;
      }
    });
    app.on("will-quit", () => {
      this.stopFloatingWatch();
      this.stopFieldPillWatch();
      globalShortcut.unregister(QUICK_BAR_SHORTCUT);
      globalShortcut.unregister(UNIVERSAL_FILL_SHORTCUT);
      this.stopPasswordAutofillSockets();
    });
  }

  /** Syncs persisted Quick Bar & Menu Bar shell preferences with TrayMain and login-item settings. */
  async syncShellPreferences(): Promise<DesktopShellPreferences> {
    if (this.desktopSettingsService != null) {
      try {
        this.prefs.openAtLogin = await firstValueFrom(this.desktopSettingsService.openAtLogin$);
      } catch {
        // Keep stored preference when settings stream is not yet initialized.
      }
    }
    this.trayMain?.setAppPresence(this.prefs.appPresence);
    if (this.pill != null && !this.pill.isDestroyed()) {
      this.applyPillWindowBehavior(this.pill);
    }
    return { ...this.prefs };
  }

  async getShellPreferences(): Promise<DesktopShellPreferences> {
    return this.syncShellPreferences();
  }

  private accessibilityStatus(): boolean {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.isTrustedAccessibilityClient(false);
  }

  private requestAccessibility(): boolean {
    if (process.platform !== "darwin") {
      return true;
    }
    return systemPreferences.isTrustedAccessibilityClient(true);
  }

  /**
   * Registers Vowkey in the Accessibility list, then opens the list with the drag guide beside it.
   * Returns whether access is already granted.
   */
  private async showAccessibilityGuide(template: string): Promise<boolean> {
    if (process.platform !== "darwin") {
      return true;
    }
    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      return true;
    }
    await this.permissionGuide.show(String(template ?? ""));
    return false;
  }

  async updateShellPreferences(
    patch: Partial<DesktopShellPreferences>,
  ): Promise<DesktopShellPreferences> {
    const validPresence: AppPresenceMode[] = ["both", "menubar", "dock"];
    const validModes: QuickBarWindowMode[] = ["floating", "popover"];

    if (patch.appPresence && validPresence.includes(patch.appPresence)) {
      this.prefs.appPresence = patch.appPresence;
    }
    if (patch.quickBarMode && validModes.includes(patch.quickBarMode)) {
      this.prefs.quickBarMode = patch.quickBarMode;
    }
    if (typeof patch.floatAboveWindows === "boolean") {
      this.prefs.floatAboveWindows = patch.floatAboveWindows;
    }
    if (typeof patch.aiMode === "boolean") {
      this.prefs.aiMode = patch.aiMode;
    }
    if (patch.aiAgent === null || ["claude-code", "codex", "gemini"].includes(patch.aiAgent ?? "")) {
      this.prefs.aiAgent = patch.aiAgent ?? null;
    }
    if (typeof patch.openAtLogin === "boolean") {
      this.prefs.openAtLogin = patch.openAtLogin;
      await this.desktopSettingsService?.setOpenAtLogin(patch.openAtLogin);
      this.applyOpenAtLogin(patch.openAtLogin);
    }

    await this.saveShellPreferences();
    this.trayMain?.setAppPresence(this.prefs.appPresence);
    await this.desktopSettingsService?.setRunInBackground(this.prefs.appPresence !== "dock");

    if (this.pill != null && !this.pill.isDestroyed()) {
      this.applyPillWindowBehavior(this.pill);
      this.pill.webContents.send("pill.prefs", this.prefs);
      if (this.pill.isVisible()) {
        if (this.prefs.quickBarMode === "floating") {
          this.startFloatingWatch();
        } else {
          this.stopFloatingWatch();
        }
      }
    }

    return { ...this.prefs };
  }

  async triggerUniversalFill(): Promise<void> {
    await this.universalFill();
  }

  /**
   * `vowkey://ai-fill`, sent by the browser extension's AI mode: fills the browser tab in front
   * with the chosen agent, whatever the Quick Bar's own switch says.
   */
  async aiFillFromLink(): Promise<void> {
    if (process.platform !== "darwin" || this.aiFillRunner.running) {
      return;
    }
    // The browser takes focus back once its "Open Vowkey?" prompt closes.
    await sleep(500);
    const front = await this.frontContext();
    if (front == null || front.file) {
      return;
    }
    this.front = front;
    const status = await this.aiFill(front);
    await this.show(undefined, status);
  }

  async openSettingsInHub(): Promise<void> {
    this.hide();
    if (this.trayMain != null) {
      await this.trayMain.restoreFromTray();
    } else {
      this.openHub();
    }
    this.windowMain.win?.webContents.send("quickBar.openSettings");
  }

  /** Opens the Quick Bar, or hides it when it is already visible. */
  async toggle(icon?: Rectangle) {
    if (this.pill?.isVisible()) {
      this.hide();
      return;
    }
    await this.show(icon);
  }

  private async show(icon?: Rectangle, initialStatus?: PillStatus) {
    this.hideFieldPill();
    const captured = await this.frontContext();
    if (captured != null) {
      this.front = captured;
    }
    const win = this.pill ?? (await this.createPill());
    this.applyPillWindowBehavior(win);
    this.place(win, icon);
    win.showInactive();
    win.focus();
    if (this.prefs.quickBarMode === "floating") {
      this.startFloatingWatch();
    } else {
      this.stopFloatingWatch();
    }
    win.webContents.send("pill.show", {
      platform: process.platform === "darwin" ? "mac" : "win",
      front: this.front,
      status: initialStatus ?? null,
      prefs: this.prefs,
      aiProgress: this.aiFillProgress,
    });
  }

  private async createPill(): Promise<BrowserWindow> {
    const isMac = process.platform === "darwin";
    const win = new BrowserWindow({
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      roundedCorners: true,
      vibrancy: isMac ? "popover" : undefined,
      visualEffectState: isMac ? "active" : undefined,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // A panel takes typing without bringing Vowkey to the front, so the app the person was in
      // keeps its focused field.
      type: isMac ? "panel" : undefined,
      webPreferences: {
        preload: path.join(__dirname, "quick-pill", "pill-preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.applyPillWindowBehavior(win);
    win.on("moved", () => {
      if (this.isSettingBounds || this.prefs.quickBarMode !== "floating") {
        return;
      }
      const b = win.getBounds();
      this.draggedPosition = { x: b.x, y: b.y };
      this.anchor = { x: b.x, y: b.y, bottom: false };
    });
    win.on("blur", () => {
      if (process.env.VOWKEY_E2E === "1") {
        return;
      }
      if (this.prefs.quickBarMode === "popover") {
        this.hide();
        return;
      }
      // Floating Quick Bar stays open above windows so users can switch apps or drag files in from Finder.
      setTimeout(() => {
        void this.refreshFloatingContext();
      }, 150);
    });
    win.on("closed", () => {
      this.stopFloatingWatch();
      this.pill = null;
    });
    this.pill = win;
    await win.loadFile(path.join(__dirname, "quick-pill", "pill.html"));
    return win;
  }

  private applyPillWindowBehavior(win: BrowserWindow): void {
    const floating = this.prefs.quickBarMode === "floating";
    win.setMovable(floating);
    const alwaysOnTop = floating ? this.prefs.floatAboveWindows : true;
    const level = floating ? "floating" : "pop-up-menu";
    win.setAlwaysOnTop(alwaysOnTop, level);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  /**
   * Positions the Quick Bar: remembers the user's dragged position in floating mode, or anchors
   * cleanly below the macOS menu bar icon / above the Windows taskbar tray icon.
   */
  private place(win: BrowserWindow, icon?: Rectangle) {
    if (this.prefs.quickBarMode === "floating" && this.draggedPosition != null && !icon) {
      const area = screen.getDisplayNearestPoint(this.draggedPosition).workArea;
      const x = Math.max(
        area.x + 8,
        Math.min(this.draggedPosition.x, area.x + area.width - PILL_WIDTH - 8),
      );
      const y = Math.max(
        area.y + 6,
        Math.min(this.draggedPosition.y, area.y + area.height - PILL_HEIGHT - 8),
      );
      this.anchor = { x, y, bottom: false };
      this.resize(PILL_HEIGHT, win);
      return;
    }

    const point = icon
      ? { x: icon.x + icon.width / 2, y: icon.y }
      : screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const bottom = process.platform !== "darwin" && (!icon || icon.y > area.y + area.height / 2);

    let x: number;
    if (icon) {
      const centeredX = Math.round(icon.x + icon.width / 2 - PILL_WIDTH / 2);
      x = Math.max(area.x + 12, Math.min(centeredX, area.x + area.width - PILL_WIDTH - 12));
    } else {
      x = Math.max(area.x + 12, area.x + area.width - PILL_WIDTH - 16);
    }

    if (bottom) {
      const bottomY = icon
        ? Math.min(area.y + area.height - 8, icon.y - 8)
        : area.y + area.height - 8;
      this.anchor = { x, y: bottomY, bottom: true };
    } else {
      const topY = icon
        ? Math.max(area.y + 6, icon.y + icon.height + 6)
        : process.platform === "darwin"
          ? area.y + 6
          : area.y + 8;
      this.anchor = { x, y: topY, bottom: false };
    }
    this.resize(PILL_HEIGHT, win);
  }

  private resize(height: number, win: BrowserWindow | null = this.pill) {
    if (win == null || this.anchor == null) {
      return;
    }
    const h = Math.max(PILL_HEIGHT, Math.min(580, Math.round(height)));
    const y = this.anchor.bottom ? this.anchor.y - h : this.anchor.y;
    const current = win.getBounds();
    if (current.height !== h || current.y !== y || current.x !== this.anchor.x) {
      this.isSettingBounds = true;
      try {
        win.setBounds({ x: this.anchor.x, y, width: PILL_WIDTH, height: h });
      } finally {
        this.isSettingBounds = false;
      }
    }
  }

  private hide() {
    this.stopFloatingWatch();
    this.pill?.hide();
  }

  private startFloatingWatch(): void {
    this.stopFloatingWatch();
    this.floatingWatchTimer = setInterval(() => {
      void this.refreshFloatingContext();
    }, 1500);
  }

  private stopFloatingWatch(): void {
    if (this.floatingWatchTimer != null) {
      clearInterval(this.floatingWatchTimer);
      this.floatingWatchTimer = null;
    }
  }

  private async refreshFloatingContext(): Promise<void> {
    if (
      this.pill == null ||
      this.pill.isDestroyed() ||
      !this.pill.isVisible() ||
      this.pill.isFocused() ||
      this.isTypingIntoFrontApp
    ) {
      return;
    }
    const captured = await this.frontContext();
    if (captured == null) {
      return;
    }
    const prevKey = `${this.front?.bundleId ?? ""}|${this.front?.url ?? ""}|${this.front?.file?.path ?? ""}|${this.front?.appName ?? ""}`;
    const nextKey = `${captured.bundleId ?? ""}|${captured.url ?? ""}|${captured.file?.path ?? ""}|${captured.appName ?? ""}`;
    this.front = captured;
    if (prevKey !== nextKey) {
      this.pill.webContents.send("pill.front", captured);
    }
  }

  /**
   * Extensionless browser & native app field pill (`AXManualAccessibility` + `AXWebArea`):
   * anchors a non-focusable `Fill` chip beneath focused `<input>` fields when Vowkey's browser
   * extension is not active in that browser.
   */
  private startFieldPillWatch(): void {
    this.stopFieldPillWatch();
    this.fieldPillTimer = setInterval(() => {
      void this.refreshFieldPill();
    }, 1200);
  }

  private stopFieldPillWatch(): void {
    if (this.fieldPillTimer != null) {
      clearInterval(this.fieldPillTimer);
      this.fieldPillTimer = null;
    }
    this.hideFieldPill();
    if (this.fieldPill != null && !this.fieldPill.isDestroyed()) {
      this.fieldPill.destroy();
    }
    this.fieldPill = null;
  }

  private hideFieldPill(): void {
    this.fieldPillAction = null;
    if (this.fieldPill != null && !this.fieldPill.isDestroyed() && this.fieldPill.isVisible()) {
      this.fieldPill.hide();
    }
  }

  private async ensureFieldPill(): Promise<BrowserWindow> {
    if (this.fieldPill != null && !this.fieldPill.isDestroyed()) {
      return this.fieldPill;
    }
    const win = new BrowserWindow({
      width: FIELD_PILL_WIDTH,
      height: FIELD_PILL_HEIGHT,
      show: false,
      focusable: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      type: "panel",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on("closed", () => {
      this.fieldPill = null;
    });
    this.fieldPill = win;
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(buildFieldPillHtml())}`,
    );
    return win;
  }

  private matchDetailForFocusedField(
    field: FocusedInputField,
    items: QuickBarVaultItem[],
  ): QuickBarVaultItem | undefined {
    const rawHint = [field.title, field.placeholder, field.description]
      .filter(Boolean)
      .join(" ")
      .trim()
      .toLowerCase();
    if (rawHint.length < 3) {
      return undefined;
    }
    return items.find((item) => {
      if (item.kind !== "detail" || !item.value) {
        return false;
      }
      const label = item.label.toLowerCase();
      return label.length >= 3 && (rawHint.includes(label) || label.includes(rawHint));
    });
  }

  private async refreshFieldPill(): Promise<void> {
    if (
      this.isRefreshingFieldPill ||
      this.isTypingIntoFrontApp ||
      this.pill?.isVisible() ||
      this.windowMain.win == null ||
      this.windowMain.win.isDestroyed()
    ) {
      if (this.pill?.isVisible()) {
        this.hideFieldPill();
      }
      return;
    }

    this.isRefreshingFieldPill = true;
    try {
      const captured = await this.frontContext(true);
      if (
        captured == null ||
        captured.browserExtensionActive ||
        captured.focusedField == null ||
        captured.focusedField.width < 48 ||
        captured.focusedField.height < 14
      ) {
        this.hideFieldPill();
        return;
      }

      this.front = captured;
      const state = await this.ask<{
        locked?: boolean;
        items?: QuickBarVaultItem[];
      }>({
        kind: "details",
        front: captured,
      });

      if (state?.locked || !state?.items?.length) {
        this.hideFieldPill();
        return;
      }

      const field = captured.focusedField;
      const matchedLogin = state.items.find((item) => item.kind === "login" && item.matched);
      let action: FieldPillAction | null = null;

      if (matchedLogin) {
        action = {
          kind: "login",
          label: `Fill ${matchedLogin.label}`,
          username: matchedLogin.username ?? "",
          password: matchedLogin.password ?? "",
          totp: matchedLogin.totp,
          onlyPassword: Boolean(field.isSecure && matchedLogin.password),
        };
      } else if (!field.isSecure) {
        const matchedDetail = this.matchDetailForFocusedField(field, state.items);
        if (matchedDetail) {
          action = {
            kind: "detail",
            label: `Fill ${matchedDetail.label}`,
            value: matchedDetail.value,
          };
        }
      }

      if (!action) {
        this.hideFieldPill();
        return;
      }

      this.fieldPillAction = action;
      const pillWin = await this.ensureFieldPill();
      const displayArea = screen.getDisplayNearestPoint({
        x: Math.round(field.x),
        y: Math.round(field.y),
      }).workArea;

      const x = Math.max(
        displayArea.x + 6,
        Math.min(
          Math.round(field.x + Math.max(0, field.width - FIELD_PILL_WIDTH)),
          displayArea.x + displayArea.width - FIELD_PILL_WIDTH - 6,
        ),
      );
      const yBelow = Math.round(field.y + field.height + 4);
      const y =
        yBelow + FIELD_PILL_HEIGHT <= displayArea.y + displayArea.height
          ? yBelow
          : Math.max(displayArea.y + 4, Math.round(field.y - FIELD_PILL_HEIGHT - 4));

      pillWin.setBounds({ x, y, width: FIELD_PILL_WIDTH, height: FIELD_PILL_HEIGHT });
      pillWin.webContents.send("fieldPill.label", action.label);
      if (!pillWin.isVisible()) {
        pillWin.showInactive();
      }
    } catch {
      this.hideFieldPill();
    } finally {
      this.isRefreshingFieldPill = false;
    }
  }

  private async executeFieldPillFill(): Promise<void> {
    const action = this.fieldPillAction;
    this.hideFieldPill();
    if (!action) {
      return;
    }
    if (action.kind === "login") {
      await this.typeLogin(
        action.onlyPassword ? "" : action.username,
        action.password,
        action.totp,
        false,
      );
    } else {
      this.isTypingIntoFrontApp = true;
      try {
        await this.pasteOrTypeText(action.value);
        await this.ask({ kind: "filled" });
      } catch (error) {
        this.logService.error("Extensionless field pill fill failed", error);
      } finally {
        this.isTypingIntoFrontApp = false;
      }
    }
  }

  private prefsFilePath(): string {
    return path.join(app.getPath("userData"), SHELL_PREFS_FILENAME);
  }

  private loadShellPreferencesSync(): void {
    try {
      const file = this.prefsFilePath();
      if (!existsSync(file)) {
        return;
      }
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<DesktopShellPreferences>;
      if (parsed.appPresence && ["both", "menubar", "dock"].includes(parsed.appPresence)) {
        this.prefs.appPresence = parsed.appPresence;
      }
      if (parsed.quickBarMode && ["floating", "popover"].includes(parsed.quickBarMode)) {
        this.prefs.quickBarMode = parsed.quickBarMode;
      }
      if (typeof parsed.floatAboveWindows === "boolean") {
        this.prefs.floatAboveWindows = parsed.floatAboveWindows;
      }
      if (typeof parsed.openAtLogin === "boolean") {
        this.prefs.openAtLogin = parsed.openAtLogin;
      }
      if (typeof parsed.aiMode === "boolean") {
        this.prefs.aiMode = parsed.aiMode;
      }
      if (["claude-code", "codex", "gemini"].includes(parsed.aiAgent ?? "")) {
        this.prefs.aiAgent = parsed.aiAgent;
      }
    } catch {
      // Keep default shell preferences when config file is absent or unreadable.
    }
  }

  private async saveShellPreferences(): Promise<void> {
    try {
      await fs.writeFile(this.prefsFilePath(), JSON.stringify(this.prefs, null, 2), "utf8");
    } catch (error) {
      this.logService.warning("Failed to persist shell preferences", error);
    }
  }

  private applyOpenAtLogin(enabled: boolean): void {
    if (process.platform === "linux") {
      autostart
        .setAutostart(enabled, {
          execPath: app.getPath("exe"),
          autostartFlag: AUTOSTART_FLAG,
        })
        .catch((err) => this.logService.error("Error setting autostart", err));
    } else {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: enabled ? [AUTOSTART_FLAG] : [],
      });
    }
  }

  private openHub() {
    this.hide();
    const win = this.windowMain.win;
    if (win == null) {
      return;
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
    if (process.platform === "darwin") {
      if (this.prefs.appPresence !== "menubar") {
        void app.dock?.show();
      }
      app.focus({ steal: true });
    }
  }

  /** Asks the main window, which holds the unlocked vault. */
  private async ask<T>(request: QuickBarRequest): Promise<T> {
    const win = this.windowMain.win;
    if (win == null || win.isDestroyed()) {
      return { locked: true } as T;
    }
    const id = this.nextRequest++;
    const pending = deferred<T>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      pending.reject(new Error("The vault window did not answer."));
    }, 30_000);
    this.pending.set(id, (result) => {
      clearTimeout(timer);
      pending.resolve(result as T);
    });
    win.webContents.send("quickBar.request", id, request);
    return pending.promise;
  }

  private async process(
    file: string,
    profileId?: string,
    intent: "auto" | "fill" = "auto",
  ): Promise<PillStatus> {
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      return await this.processBytes(path.basename(file), bytes, profileId, intent, file);
    } catch (error) {
      return {
        good: false,
        title: `Couldn't open ${path.basename(file)}`,
        subtitle: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async processBytes(
    name: string,
    bytes: Uint8Array,
    profileId?: string,
    intent: "auto" | "fill" = "auto",
    filePath = "",
  ): Promise<PillStatus> {
    return this.ask<PillStatus>({
      kind: "process",
      name,
      path: filePath,
      bytes,
      profileId,
      intent,
    });
  }

  /** Reads an image or screenshot currently on the system clipboard (`⌘V`) into the profile. */
  private async pasteClipboardImage(profileId?: string): Promise<PillStatus | null> {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    const pngBytes = new Uint8Array(image.toPNG());
    if (pngBytes.length === 0) {
      return null;
    }
    return this.processBytes("Clipboard image.png", pngBytes, profileId, "auto");
  }

  /**
   * Capture a form to fill: the person drags crosshairs over a form on screen, or a photo of a paper
   * form (`/usr/sbin/screencapture -i -x` on macOS, `ms-screenclip:` on Windows). Vowkey fills the
   * captured form from the selected profile, saves the filled copy and opens it; the temporary
   * capture is deleted immediately.
   */
  private async scanScreen(
    profileId?: string,
  ): Promise<PillStatus | { cancelled: true }> {
    if (process.platform === "win32") {
      return this.scanScreenWindows(profileId);
    }
    if (process.platform !== "darwin") {
      return {
        good: false,
        title: "Capture to fill works on macOS and Windows",
        subtitle: "",
      };
    }

    const wasVisible = Boolean(this.pill?.isVisible());
    this.hideFieldPill();
    if (wasVisible) {
      this.pill?.hide();
      await sleep(80);
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `vowkey-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`,
    );

    try {
      try {
        await run("/usr/sbin/screencapture", ["-i", "-x", tmpFile], { timeout: 120_000 });
      } catch {
        // `screencapture -i` exits non-zero when cancelled with Escape.
      }

      if (!existsSync(tmpFile)) {
        if (wasVisible && this.pill && !this.pill.isDestroyed()) {
          this.pill.showInactive();
          this.pill.focus();
          if (this.prefs.quickBarMode === "floating") {
            this.startFloatingWatch();
          }
        }
        return { cancelled: true };
      }

      const bytes = new Uint8Array(await fs.readFile(tmpFile));
      await fs.unlink(tmpFile).catch((): void => undefined);

      if (bytes.length === 0) {
        if (wasVisible && this.pill && !this.pill.isDestroyed()) {
          this.pill.showInactive();
          this.pill.focus();
        }
        return { cancelled: true };
      }

      if (wasVisible && this.pill && !this.pill.isDestroyed()) {
        this.pill.showInactive();
        this.pill.focus();
        if (this.prefs.quickBarMode === "floating") {
          this.startFloatingWatch();
        }
        this.pill.webContents.send("pill.scanning", "Screen capture");
      }

      return await this.processBytes("Screen capture.png", bytes, profileId, "fill");
    } finally {
      if (existsSync(tmpFile)) {
        await fs.unlink(tmpFile).catch((): void => undefined);
      }
    }
  }

  private async scanScreenWindows(
    profileId?: string,
  ): Promise<PillStatus | { cancelled: true }> {
    const wasVisible = Boolean(this.pill?.isVisible());
    this.hideFieldPill();
    if (wasVisible) {
      this.pill?.hide();
      await sleep(80);
    }

    const beforeImage = clipboard.readImage();
    const beforePng = beforeImage.isEmpty() ? Buffer.alloc(0) : beforeImage.toPNG();

    try {
      await shell.openExternal("ms-screenclip:");
    } catch {
      if (wasVisible && this.pill && !this.pill.isDestroyed()) {
        this.pill.showInactive();
        this.pill.focus();
      }
      return { cancelled: true };
    }

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await sleep(250);
      const current = clipboard.readImage();
      if (current.isEmpty()) {
        continue;
      }
      const png = current.toPNG();
      if (png.length === 0 || (beforePng.length > 0 && png.equals(beforePng))) {
        continue;
      }
      if (wasVisible && this.pill && !this.pill.isDestroyed()) {
        this.pill.showInactive();
        this.pill.focus();
        if (this.prefs.quickBarMode === "floating") {
          this.startFloatingWatch();
        }
        this.pill.webContents.send("pill.scanning", "Screen capture");
      }
      return await this.processBytes("Screen capture.png", new Uint8Array(png), profileId, "fill");
    }

    if (wasVisible && this.pill && !this.pill.isDestroyed()) {
      this.pill.showInactive();
      this.pill.focus();
      if (this.prefs.quickBarMode === "floating") {
        this.startFloatingWatch();
      }
    }
    return { cancelled: true };
  }

  /** Triggered when the person clicks `#fill` inside the Quick Bar. */
  private async fillFromBar(profileId?: string): Promise<PillStatus> {
    const front = this.front ?? (await this.frontContext());
    if (front?.file) {
      return this.process(front.file.path, profileId, "fill");
    }
    if (this.prefs.aiMode && process.platform === "darwin") {
      return this.aiFill(front, profileId);
    }
    const state = await this.ask<{
      locked?: boolean;
      items?: QuickBarVaultItem[];
    }>({
      kind: "details",
      profileId,
      front,
    });
    if (state?.locked) {
      return { good: false, title: "Unlock Vowkey first", subtitle: "" };
    }
    const matched = (state.items ?? []).find((item) => item.kind === "login" && item.matched);
    if (matched) {
      const err = await this.typeLogin(
        matched.username ?? "",
        matched.password ?? "",
        matched.totp,
      );
      if (err) {
        return { good: false, title: `Couldn't fill ${matched.label}`, subtitle: err };
      }
      return {
        good: true,
        title: `Filled ${matched.label}`,
        subtitle: matched.totp ? "Verification code copied" : "",
      };
    }
    const targetName = front?.host || front?.appName || "this window";
    return {
      good: false,
      title: `No saved login for ${targetName}`,
      subtitle: "Choose a detail or login below to type it",
    };
  }

  /**
   * AI mode: the chosen agent reads the window in front and fills it through Vowkey's tools,
   * falling back from Accessibility to screenshots and clicks when the app exposes no fields.
   */
  private async aiFill(front: FrontContext | null, profileId?: string): Promise<PillStatus> {
    if (this.aiFillRunner.running) {
      return { good: false, title: "A fill is already running", subtitle: "" };
    }
    if (!systemPreferences.isTrustedAccessibilityClient(true)) {
      return {
        good: false,
        title: "Allow Accessibility first",
        subtitle: "System Settings › Privacy & Security › Accessibility",
      };
    }
    if (front?.pid == null) {
      return { good: false, title: "Click the window to fill, then try again", subtitle: "" };
    }
    const state = await this.ask<{ locked?: boolean; items?: QuickBarVaultItem[] }>({
      kind: "details",
      profileId,
      front,
    });
    if (state?.locked) {
      return { good: false, title: "Unlock Vowkey first", subtitle: "" };
    }
    const vault = vaultForAgent(state.items ?? [], profileId);

    const wasPillOpen = Boolean(this.pill?.isVisible());
    this.isTypingIntoFrontApp = true;
    this.hideFieldPill();
    this.hide();
    const sendProgress = (message: AiFillProgressMessage) => {
      this.aiFillProgress = message;
      if (this.pill != null && !this.pill.isDestroyed()) {
        this.pill.webContents.send("pill.aiProgress", message);
      }
    };
    try {
      const result = await this.aiFillRunner.run({
        pid: front.pid,
        appName: front.appName ?? "",
        windowTitle: front.windowTitle,
        url: front.url,
        locale: app.getLocale(),
        vault,
        withheld: withheldFromAgent(state.items ?? [], profileId),
        agentId: this.prefs.aiAgent ?? null,
        onProgress: (p) =>
          sendProgress({ agent: p.agent, step: p.step as AiFillProgressMessage["step"], detail: p.detail }),
      });
      if (result.filled > 0) {
        await this.ask({ kind: "filled" }).catch((): void => undefined);
      }
      const skipped = result.skipped.length
        ? ` · ${result.skipped.length} left empty`
        : "";
      return {
        good: result.status === "done" || result.status === "partial" || result.status === "nothing_to_fill",
        title:
          result.status === "nothing_to_fill"
            ? "Nothing to fill here"
            : result.status === "failed"
              ? `${result.agent} couldn't fill this`
              : `Filled ${result.filled} with ${result.agent}${skipped}`,
        subtitle: result.summary,
      };
    } catch (error) {
      this.logService.error("AI fill failed", error);
      return {
        good: false,
        title: "AI fill didn't start",
        subtitle: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.aiFillProgress = null;
      this.isTypingIntoFrontApp = false;
      if (wasPillOpen && this.pill != null && !this.pill.isDestroyed()) {
        this.pill.showInactive();
        if (this.prefs.quickBarMode === "floating") {
          this.startFloatingWatch();
        }
      }
    }
  }

  /** Triggered anywhere on the system via `⌘\` (`CommandOrControl+\`). */
  private async universalFill(): Promise<void> {
    this.hideFieldPill();
    if (this.prefs.aiMode && process.platform === "darwin" && !this.aiFillRunner.running) {
      const front = this.pill?.isVisible() ? this.front : await this.frontContext();
      if (front != null && !front.file) {
        this.front = front;
        const status = await this.aiFill(front);
        await this.show(undefined, status);
        return;
      }
    }
    if (this.pill?.isVisible()) {
      const status = await this.fillFromBar();
      if (!status.good) {
        this.pill.webContents.send("pill.show", {
          platform: process.platform === "darwin" ? "mac" : "win",
          front: this.front,
          status,
        });
      }
      return;
    }

    const front = await this.frontContext();
    if (front != null) {
      this.front = front;
    }

    if (front?.file) {
      const status = await this.process(front.file.path, undefined, "fill");
      await this.show(undefined, status);
      return;
    }

    const state = await this.ask<{
      locked?: boolean;
      items?: QuickBarVaultItem[];
    }>({
      kind: "details",
      front,
    });

    if (state?.locked) {
      await this.show();
      return;
    }

    const matchedLogins = (state.items ?? []).filter(
      (item) => item.kind === "login" && item.matched,
    );
    if (matchedLogins.length === 1) {
      const login = matchedLogins[0];
      // Brief pause so held ⌘\ modifier keys settle before pasting into the focused field.
      await sleep(80);
      const err = await this.typeLogin(
        login.username ?? "",
        login.password ?? "",
        login.totp,
        false,
      );
      if (err) {
        await this.show(undefined, {
          good: false,
          title: `Couldn't fill ${login.label}`,
          subtitle: err,
        });
      }
      return;
    }

    // Multiple matches or no direct login match: open Quick Bar ranked for the front app/site.
    await this.show();
  }

  /** Yields keyboard focus cleanly to the target external app before injecting keystrokes. */
  private async yieldFocusToTargetApp(wasPillOpen: boolean): Promise<void> {
    this.hideFieldPill();
    if (wasPillOpen) {
      this.pill?.hide();
    }
    if (
      process.platform === "darwin" &&
      this.front?.bundleId &&
      this.windowMain.win?.isFocused()
    ) {
      try {
        await run(
          "osascript",
          ["-e", `tell application id ${JSON.stringify(this.front.bundleId)} to activate`],
          { timeout: 600 },
        );
      } catch {
        // Fall back to natural macOS focus return.
      }
    } else if (process.platform === "win32") {
      const targetHwnd = this.front?.hwnd ?? this.lastExternalHwnd;
      if (targetHwnd && typeof desktopNapi.focusExternalWindow === "function") {
        try {
          desktopNapi.focusExternalWindow(targetHwnd);
        } catch {
          // Fall back to natural Windows focus return.
        }
      }
    }
    if (wasPillOpen || process.platform === "win32") {
      await sleep(REFOCUS_MS);
    }
  }

  private async restoreFloatingPillAfterTyping(wasPillOpen: boolean): Promise<void> {
    if (!wasPillOpen || this.prefs.quickBarMode !== "floating") {
      return;
    }
    await sleep(60);
    if (this.pill != null && !this.pill.isDestroyed()) {
      this.pill.showInactive();
      this.startFloatingWatch();
    }
  }

  /**
   * Pastes text on macOS via Raycast-style concealed transient paste (`ConcealedType` +
   * `TransientType` + `AutoGeneratedType` + 150 ms snapshot restore), falling back to native
   * `autotype_mvp` when the Swift AX bridge is unavailable or on Windows/Linux.
   */
  private async pasteOrTypeText(value: string): Promise<void> {
    if (process.platform === "darwin") {
      const ok = await this.axBridge.pasteConcealed([{ kind: "text", value }]);
      if (ok) {
        return;
      }
    }
    autotype_mvp.typeInput(utf16(value), []);
  }

  /** Resolves to null when the detail was typed, or to what stopped it. */
  private async typeDetail(value: string): Promise<string | null> {
    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(true)) {
      return "Allow Vowkey under System Settings › Privacy & Security › Accessibility, then try again.";
    }
    this.isTypingIntoFrontApp = true;
    try {
      await this.yieldFocusToTargetApp(true);
      await this.pasteOrTypeText(value);
      await this.ask({ kind: "filled" });
      await this.restoreFloatingPillAfterTyping(true);
      return null;
    } catch (error) {
      this.logService.error("Typing a detail failed", error);
      this.pill?.showInactive();
      return error instanceof Error ? error.message : String(error);
    } finally {
      this.isTypingIntoFrontApp = false;
    }
  }

  /** Fills `username -> Tab -> password` via concealed transient paste and copies TOTP if present. */
  private async typeLogin(
    username: string,
    password: string,
    totp?: string,
    wasPillOpen = true,
  ): Promise<string | null> {
    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(true)) {
      return "Allow Vowkey under System Settings › Privacy & Security › Accessibility, then try again.";
    }
    this.isTypingIntoFrontApp = true;
    try {
      await this.yieldFocusToTargetApp(wasPillOpen);

      let handledByConcealedBridge = false;
      if (process.platform === "darwin") {
        const segments: ConcealedSegment[] = [];
        if (username && password) {
          segments.push(
            { kind: "text", value: username },
            { kind: "tab" },
            { kind: "text", value: password },
          );
        } else if (password) {
          segments.push({ kind: "text", value: password });
        } else if (username) {
          segments.push({ kind: "text", value: username });
        }
        if (segments.length > 0) {
          handledByConcealedBridge = await this.axBridge.pasteConcealed(segments, totp);
        }
      }

      if (!handledByConcealedBridge) {
        if (username && password) {
          autotype_mvp.typeInput(utf16(username), []);
          await sleep(30);
          await this.sendTabKey();
          await sleep(45);
          autotype_mvp.typeInput(utf16(password), []);
        } else if (password) {
          autotype_mvp.typeInput(utf16(password), []);
        } else if (username) {
          autotype_mvp.typeInput(utf16(username), []);
        }
        if (totp) {
          if (
            process.platform === "win32" &&
            typeof desktopNapi.writeConcealedClipboard === "function"
          ) {
            if (!desktopNapi.writeConcealedClipboard(totp)) {
              clipboard.writeText(totp);
            }
          } else {
            clipboard.writeText(totp);
          }
        }
      }

      await this.ask({ kind: "filled" });
      await this.restoreFloatingPillAfterTyping(wasPillOpen);
      return null;
    } catch (error) {
      this.logService.error("Typing a login failed", error);
      if (wasPillOpen) {
        this.pill?.showInactive();
      }
      return error instanceof Error ? error.message : String(error);
    } finally {
      this.isTypingIntoFrontApp = false;
    }
  }

  private async sendTabKey(): Promise<void> {
    if (process.platform === "darwin") {
      try {
        await run("osascript", ["-e", 'tell application "System Events" to key code 48'], {
          timeout: 800,
        });
        return;
      } catch {
        // Fall through to native autotype Tab segment.
      }
    }
    autotype_mvp.typeInput(utf16("\t"), []);
  }

  /**
   * Inspects the frontmost macOS or Windows app, active browser tab URL (preferring `AXWebArea`
   * `AXURL` / `AXDocument` on macOS without AppleScript Automation popups), focused `<input>`
   * bounds, and any open fillable document or image.
   */
  private async frontContext(axOnly = false): Promise<FrontContext | null> {
    if (process.platform === "win32") {
      return this.frontContextWindows(axOnly);
    }
    if (process.platform !== "darwin") {
      return null;
    }

    const ax = await this.axBridge.inspect();
    let appName = ax?.appName ?? "";
    let bundleId = ax?.bundleId ?? "";
    let windowTitle = ax?.windowTitle ?? "";
    let axDocUrl = ax?.docUrl ?? "";
    let tabUrl = ax?.webUrl ?? "";
    const pid = ax?.pid;
    const focusedField = ax?.focusedField;

    let helperDoc: string | undefined;
    if (!axOnly) {
      const helper = [
        process.env.VOWKEY_READ_HELPER,
        path.join(process.resourcesPath, "vowkey-read"),
        path.join(app.getAppPath(), "..", "desktop_native", "ocr", "vowkey-read"),
      ].find((candidate) => candidate && existsSync(candidate));

      if (helper != null) {
        try {
          const { stdout } = await run(helper, ["--front"], { timeout: 1000 });
          const parsed = JSON.parse(stdout) as { app?: string; document?: string };
          if (!appName && parsed.app) {
            appName = parsed.app;
          }
          helperDoc = parsed.document;
        } catch {
          // Continue with AX / AppleScript inspection.
        }
      }
    }

    // Only fall back to AppleScript when AX inspection was unavailable (e.g., before Accessibility
    // permission is granted) so users are not prompted for per-browser AppleEvents Automation.
    if (!axOnly && !ax && !appName && !bundleId) {
      try {
        const { stdout } = await run("osascript", ["-e", FRONT_CONTEXT_APPLESCRIPT], {
          timeout: 900,
        });
        const lines = stdout.split(/\r?\n/);
        appName = (lines[0] || appName).trim();
        bundleId = (lines[1] || "").trim();
        windowTitle = (lines[2] || "").trim();
        axDocUrl = (lines[3] || "").trim();
        tabUrl = (lines[4] || "").trim();
      } catch {
        // AppleScript can time out if System Events is busy.
      }
    }

    if (
      appName === app.name ||
      bundleId.startsWith("com.vowkey.") ||
      (bundleId === "com.github.Electron" &&
        (this.windowMain.win?.isFocused() ||
          this.pill?.isFocused() ||
          this.fieldPill?.isFocused()))
    ) {
      return null;
    }

    let filePath = helperDoc && existsSync(helperDoc) ? helperDoc : undefined;
    if (!filePath && axDocUrl.startsWith("file://")) {
      try {
        const candidate = fileURLToPath(axDocUrl);
        if (existsSync(candidate)) {
          filePath = candidate;
        }
      } catch {
        // Ignore malformed AXDocument URL.
      }
    }

    const file =
      filePath && FILLABLE.test(filePath)
        ? { name: path.basename(filePath), path: filePath }
        : undefined;

    let host: string | undefined;
    if (tabUrl) {
      try {
        host = new URL(tabUrl).hostname.replace(/^www\./i, "") || undefined;
      } catch {
        host = undefined;
      }
    }

    if (!appName && !bundleId && !file && !tabUrl) {
      return null;
    }

    const browserExtensionActive = this.axBridge.isBrowserExtensionActive(
      bundleId || undefined,
      this.nativeMessagingMain,
    );

    return {
      appName: appName || undefined,
      bundleId: bundleId || undefined,
      pid,
      windowTitle: windowTitle || undefined,
      url: tabUrl || undefined,
      host,
      file,
      focusedField,
      browserExtensionActive,
    };
  }

  private async frontContextWindows(axOnly = false): Promise<FrontContext | null> {
    const info =
      typeof desktopNapi.getForegroundWindowInfo === "function"
        ? desktopNapi.getForegroundWindowInfo()
        : null;

    let hwnd = info?.hwnd ?? "";
    let appName = info?.app ?? "";
    const exePath = info?.exePath ?? "";
    let windowTitle = info?.windowTitle ?? "";
    let tabUrl = "";
    let helperDoc = "";

    if (!axOnly && (!appName || !helperDoc)) {
      const helper = [
        process.env.VOWKEY_READ_HELPER,
        path.join(process.resourcesPath, "vowkey-read.exe"),
        path.join(path.dirname(app.getPath("exe")), "vowkey-read.exe"),
        path.join(
          app.getAppPath(),
          "..",
          "desktop_native",
          "dist",
          `vowkey-read.win32-${process.arch}.exe`,
        ),
        path.join(app.getAppPath(), "..", "desktop_native", "dist", "vowkey-read.win32-x64.exe"),
      ].find((candidate) => candidate && existsSync(candidate));

      if (helper != null) {
        try {
          const { stdout } = await run(helper, ["--front"], { timeout: 1000 });
          const parsed = JSON.parse(stdout) as {
            app?: string;
            windowTitle?: string;
            title?: string;
            url?: string;
            filePath?: string;
            document?: string;
          };
          if (!appName && parsed.app) {
            appName = parsed.app;
          }
          if (!windowTitle && (parsed.windowTitle || parsed.title)) {
            windowTitle = (parsed.windowTitle || parsed.title || "").trim();
          }
          if (parsed.url) {
            tabUrl = parsed.url.trim();
          }
          helperDoc = (parsed.filePath || parsed.document || "").trim();
        } catch {
          // Continue with Win32 foreground window info.
        }
      }
    }

    const lowerApp = appName.toLowerCase();
    const lowerExe = path.basename(exePath).toLowerCase();
    if (
      lowerApp === app.name.toLowerCase() ||
      lowerApp.includes("vowkey") ||
      lowerExe.includes("vowkey") ||
      (lowerExe === "electron.exe" &&
        (this.windowMain.win?.isFocused() ||
          this.pill?.isFocused() ||
          this.fieldPill?.isFocused()))
    ) {
      return null;
    }

    if (hwnd) {
      this.lastExternalHwnd = hwnd;
    } else if (this.lastExternalHwnd) {
      hwnd = this.lastExternalHwnd;
    }

    let filePath = helperDoc && existsSync(helperDoc) ? helperDoc : undefined;
    if (!filePath && windowTitle) {
      const winPathMatch = windowTitle.match(/([A-Za-z]:\\[^<>:"|?*\r\n]+)/);
      if (winPathMatch?.[1]) {
        const candidate = winPathMatch[1].trim();
        if (existsSync(candidate)) {
          filePath = candidate;
        }
      }
    }

    const file =
      filePath && FILLABLE.test(filePath)
        ? { name: path.basename(filePath), path: filePath }
        : undefined;

    let host: string | undefined;
    if (tabUrl) {
      try {
        host = new URL(tabUrl).hostname.replace(/^www\./i, "") || undefined;
      } catch {
        host = undefined;
      }
    }

    if (!appName && !exePath && !windowTitle && !file && !tabUrl) {
      return null;
    }

    const browserExtensionActive = this.isWindowsBrowserExtensionActive(lowerApp, lowerExe);

    return {
      appName: appName || (exePath ? path.basename(exePath, path.extname(exePath)) : undefined),
      bundleId: exePath || undefined,
      hwnd: hwnd || undefined,
      windowTitle: windowTitle || undefined,
      url: tabUrl || undefined,
      host,
      file,
      browserExtensionActive,
    };
  }

  private isWindowsBrowserExtensionActive(lowerApp: string, lowerExe: string): boolean {
    if (!this.nativeMessagingMain?.hasConnectedBrowserClient()) {
      return false;
    }
    const browserExes = new Set([
      "chrome.exe",
      "msedge.exe",
      "brave.exe",
      "vivaldi.exe",
      "arc.exe",
      "firefox.exe",
      "opera.exe",
    ]);
    if (browserExes.has(lowerExe)) {
      return true;
    }
    return /\b(chrome|edge|brave|vivaldi|arc|firefox|opera)\b/.test(lowerApp);
  }

  /**
   * Hosts a private (`0o600`) Unix domain socket `s.pw` in the App Group container and user cache
   * so the macOS Credential Provider `.appex` can query saved passwords and TOTP codes in both
   * signed-in and guest vaults.
   */
  private startPasswordAutofillSockets(): void {
    if (process.platform !== "darwin") {
      return;
    }
    const home = os.homedir();
    const candidateDirs = [
      process.env.VOWKEY_IPC_SOCKET_DIR,
      path.join(home, "Library", "Group Containers", VOWKEY_TEAM_APP_GROUP),
      path.join(home, "Library", "Caches", "com.vowkey.desktop"),
    ].filter((dir): dir is string => Boolean(dir));

    const uniqueDirs = Array.from(new Set(candidateDirs));
    for (const dir of uniqueDirs) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch {
        continue;
      }
      const socketPath = path.join(dir, "s.pw");
      try {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath);
        }
      } catch {
        // Ignore stale socket cleanup failure.
      }

      const server = net.createServer((socket) => {
        let buffer = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk: string) => {
          buffer += chunk;
          const newline = buffer.indexOf("\n");
          if (newline === -1) {
            return;
          }
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          void this.handlePasswordSocketRequest(line).then((reply) => {
            try {
              socket.end(JSON.stringify(reply) + "\n");
            } catch {
              socket.destroy();
            }
          });
        });
        socket.on("error", () => socket.destroy());
      });

      server.on("error", (err) => {
        this.logService.warning(`Password AutoFill socket skipped at ${socketPath}: ${String(err)}`);
      });

      try {
        server.listen(socketPath, () => {
          try {
            chmodSync(socketPath, 0o600);
          } catch {
            // Ignore chmod if filesystem manages socket permissions.
          }
        });
        this.passwordSocketServers.push({ server, socketPath });
      } catch {
        // Skip unbindable container path on unsigned dev runs.
      }
    }
  }

  private async handlePasswordSocketRequest(raw: string): Promise<{
    ok: boolean;
    locked?: boolean;
    credentials?: PasswordCredentialEntry[];
    error?: string;
  }> {
    try {
      const parsed = JSON.parse(raw) as {
        op?: "list" | "get";
        serviceIdentifiers?: string[];
        recordIdentifier?: string;
      };
      const result = await this.ask<{
        locked?: boolean;
        credentials?: PasswordCredentialEntry[];
      }>({
        kind: "passwordCredentials",
        serviceIdentifiers: parsed.serviceIdentifiers,
        recordIdentifier: parsed.op === "get" ? parsed.recordIdentifier : undefined,
      });
      if (result?.locked) {
        return { ok: false, locked: true, error: "Vault is locked" };
      }
      return { ok: true, credentials: result?.credentials ?? [] };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private stopPasswordAutofillSockets(): void {
    for (const { server, socketPath } of this.passwordSocketServers) {
      try {
        server.close();
      } catch {
        // Ignore close errors during shutdown.
      }
      try {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath);
        }
      } catch {
        // Ignore unlink errors during shutdown.
      }
    }
    this.passwordSocketServers = [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function utf16(value: string): number[] {
  const units: number[] = [];
  for (let i = 0; i < value.length; i++) {
    units.push(value.charCodeAt(i));
  }
  return units;
}
