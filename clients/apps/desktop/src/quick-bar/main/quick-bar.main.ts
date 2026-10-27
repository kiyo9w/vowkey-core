import { execFile } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { promisify } from "util";

import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Rectangle,
  screen,
  systemPreferences,
} from "electron";

import { autotype_mvp } from "@vowkey/desktop-napi";
import { LogService } from "@vowkey/logging";

import { WindowMain } from "../../main/window.main";
import { PillStatus, QuickBarRequest } from "../types";

const run = promisify(execFile);

/** Opens the pill from any app, as the design's "When it shows" says. */
export const QUICK_BAR_SHORTCUT = "Control+Shift+Space";

const PILL_WIDTH = 480;
const PILL_HEIGHT = 84;
/** How long the app in front needs to take keyboard focus back before keys are sent to it. */
const REFOCUS_MS = 150;
const FILLABLE = /\.(pdf|docx|xlsx|hwpx)$/i;

/** What the pill shows on the right: the file in the window in front, when Vowkey can fill it. */
type FrontDocument = { name: string; path: string };


/**
 * The case pill: a click on the Vowkey icon in the menu bar or the taskbar, or the shortcut,
 * opens a compact pill next to the icon. It searches the vault and types a detail into the app in
 * front, takes a dropped document, and fills the document in the window in front. The vault itself
 * stays in the main window, which answers the pill's requests.
 */
export class QuickBarMain {
  private pill: BrowserWindow | null = null;
  private anchor: { x: number; y: number; bottom: boolean } | null = null;
  private front: FrontDocument | null = null;
  private pending = new Map<number, (result: unknown) => void>();
  private nextRequest = 1;

  constructor(
    private logService: LogService,
    private windowMain: WindowMain,
  ) {}

  init() {
    // Kept on the main process's global for debugging and the end-to-end tests, as the extension
    // keeps its main instance on `self`.
    (globalThis as { vowkeyQuickBar?: QuickBarMain }).vowkeyQuickBar = this;
    ipcMain.on("quickBar.response", (_event, id: number, result: unknown) => {
      this.pending.get(id)?.(result);
      this.pending.delete(id);
    });
    ipcMain.handle("pill.details", () => this.ask({ kind: "details" }));
    ipcMain.handle("pill.type", (_event, value: string) => this.typeDetail(value));
    ipcMain.handle("pill.copy", (_event, value: string) => clipboard.writeText(value));
    ipcMain.handle("pill.add", (_event, file: string) => this.process(file));
    ipcMain.handle("pill.fill", () =>
      this.front
        ? this.process(this.front.path)
        : { good: false, title: "Nothing to fill", subtitle: "" },
    );
    ipcMain.on("pill.openHub", () => this.openHub());
    ipcMain.on("pill.hide", () => this.hide());
    ipcMain.on("pill.resize", (_event, height: number) => this.resize(height));

    void app.whenReady().then(() => {
      const registered = globalShortcut.register(QUICK_BAR_SHORTCUT, () => void this.toggle());
      if (!registered) {
        this.logService.warning(`${QUICK_BAR_SHORTCUT} is taken by another app.`);
      }
    });
    app.on("will-quit", () => globalShortcut.unregister(QUICK_BAR_SHORTCUT));
  }

  /** Opens the pill under the icon that was clicked, or hides it when it is open. */
  async toggle(icon?: Rectangle) {
    if (this.pill?.isVisible()) {
      this.hide();
      return;
    }
    await this.show(icon);
  }

  private async show(icon?: Rectangle) {
    // Ask what is in front before the pill appears, while that app still is.
    this.front = await this.frontDocument();
    const win = this.pill ?? (await this.createPill());
    this.place(win, icon);
    win.showInactive();
    win.focus();
    win.webContents.send("pill.show", {
      platform: process.platform === "darwin" ? "mac" : "win",
      front: this.front && { name: this.front.name },
    });
  }

  private async createPill(): Promise<BrowserWindow> {
    const win = new BrowserWindow({
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      show: false,
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
      // A panel takes typing without bringing Vowkey to the front, so the app the person was in
      // keeps its focused field.
      type: process.platform === "darwin" ? "panel" : undefined,
      webPreferences: {
        preload: path.join(__dirname, "quick-pill", "pill-preload.js"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on("blur", () => {
      if (process.env.VOWKEY_E2E !== "1") {
        this.hide();
      }
    });
    win.on("closed", () => (this.pill = null));
    this.pill = win;
    await win.loadFile(path.join(__dirname, "quick-pill", "pill.html"));
    return win;
  }

  /** On a Mac the pill hangs under the menu bar at the icon; on Windows it sits above the taskbar. */
  private place(win: BrowserWindow, icon?: Rectangle) {
    const point = icon ? { x: icon.x + icon.width / 2, y: icon.y } : screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const bottom = process.platform !== "darwin" && (!icon || icon.y > area.y + area.height / 2);
    const right = icon ? Math.min(icon.x + icon.width + 12, area.x + area.width) : area.x + area.width;
    const x = Math.max(area.x, Math.round(right - PILL_WIDTH));
    this.anchor = bottom ? { x, y: area.y + area.height, bottom } : { x, y: area.y, bottom };
    this.resize(PILL_HEIGHT, win);
  }

  private resize(height: number, win: BrowserWindow | null = this.pill) {
    if (win == null || this.anchor == null) {
      return;
    }
    const h = Math.max(PILL_HEIGHT, Math.min(600, Math.round(height)));
    const y = this.anchor.bottom ? this.anchor.y - h : this.anchor.y;
    const current = win.getBounds();
    if (current.height !== h || current.y !== y || current.x !== this.anchor.x) {
      win.setBounds({ x: this.anchor.x, y, width: PILL_WIDTH, height: h });
    }
  }

  private hide() {
    this.pill?.hide();
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
      void app.dock?.show();
      app.focus({ steal: true });
    }
  }

  /** Asks the main window, which holds the unlocked vault. */
  private ask<T>(request: QuickBarRequest): Promise<T> {
    const win = this.windowMain.win;
    if (win == null || win.isDestroyed()) {
      return Promise.resolve({ locked: true } as T);
    }
    const id = this.nextRequest++;
    return new Promise<T>((resolve) => {
      this.pending.set(id, resolve as (result: unknown) => void);
      win.webContents.send("quickBar.request", id, request);
    });
  }

  private async process(file: string): Promise<PillStatus> {
    try {
      const bytes = new Uint8Array(await fs.readFile(file));
      return await this.ask<PillStatus>({
        kind: "process",
        name: path.basename(file),
        path: file,
        bytes,
      });
    } catch (error) {
      return { good: false, title: `Couldn't open ${path.basename(file)}`, subtitle: String(error) };
    }
  }

  /** Resolves to null when the detail was typed, or to what stopped it. */
  private async typeDetail(value: string): Promise<string | null> {
    if (process.platform === "darwin" && !systemPreferences.isTrustedAccessibilityClient(true)) {
      return "Allow Vowkey under System Settings › Privacy & Security › Accessibility, then try again.";
    }
    this.hide();
    await new Promise((resolve) => setTimeout(resolve, REFOCUS_MS));
    try {
      autotype_mvp.typeInput(utf16(value), []);
      return null;
    } catch (error) {
      this.logService.error("Typing a detail failed", error);
      this.pill?.showInactive();
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** The file in the window in front, when it is a form Vowkey fills. */
  private async frontDocument(): Promise<FrontDocument | null> {
    const helper = [
      process.env.VOWKEY_READ_HELPER,
      path.join(process.resourcesPath, "vowkey-read"),
      path.join(app.getAppPath(), "..", "desktop_native", "ocr", "vowkey-read"),
    ].find((candidate) => candidate && existsSync(candidate));
    if (process.platform !== "darwin" || helper == null) {
      return null;
    }
    try {
      const { stdout } = await run(helper, ["--front"], { timeout: 1500 });
      const front = JSON.parse(stdout) as { app?: string; document?: string };
      const document = front.document;
      if (!document || !FILLABLE.test(document) || front.app === app.name) {
        return null;
      }
      if (/\.pdf$/i.test(document)) {
        const head = await fs.readFile(document);
        if (!head.includes("/AcroForm")) {
          return null;
        }
      }
      return { name: path.basename(document), path: document };
    } catch {
      return null;
    }
  }
}

function utf16(value: string): number[] {
  const units: number[] = [];
  for (let i = 0; i < value.length; i++) {
    units.push(value.charCodeAt(i));
  }
  return units;
}
