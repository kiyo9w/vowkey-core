declare const VOWKEY_BUNDLED_DECISION_KEY: string;

import { execFile } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { app, ipcMain, shell } from "electron";

import {
  ClassifiedFile,
  DecisionConfig,
  FillPdfMessage,
  PdfFormField,
  SaveCopyMessage,
  UpdateDecisionConfigMessage,
} from "../types/capture";

const run = promisify(execFile);
const DECISION_CONFIG_FILENAME = "vowkey-decision.json";

interface StoredDecisionConfig {
  url?: string;
  apiKey?: string;
}

function resolveHelperCommand(helper: string, args: string[]): [string, string[]] {
  const lower = helper.toLowerCase();
  if (lower.endsWith(".ps1")) {
    return ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, ...args]];
  }
  if (lower.endsWith(".py")) {
    const py = process.env.VOWKEY_PYTHON || (process.platform === "win32" ? "python" : "python3");
    return [py, [helper, ...args]];
  }
  return [helper, args];
}

/**
 * Reads documents on this computer and saves the files Vowkey fills. A document is read by a
 * helper that uses the operating system's own PDF text and text recognition, so a photo of a
 * passport is read on this computer and goes nowhere else.
 */
export class CaptureMain {
  init() {
    ipcMain.handle("capture.readDocument", (_event, bytes: Uint8Array, name: string) =>
      this.readDocument(bytes, name),
    );
    ipcMain.handle("capture.readPieces", (_event, bytes: Uint8Array, name: string) =>
      this.readPieces(bytes, name),
    );
    ipcMain.handle("capture.decisionSettings", async () => {
      const decision = await this.decision();
      return decision && { perRequest: decision.perRequest };
    });
    ipcMain.handle("capture.getDecisionConfig", () => this.getDecisionConfig());
    ipcMain.handle(
      "capture.setDecisionConfig",
      (_event, patch: UpdateDecisionConfigMessage) => this.setDecisionConfig(patch),
    );
    ipcMain.handle("capture.askDecision", (_event, request: object) => this.askDecision(request));
    ipcMain.handle("capture.saveCopy", (_event, message: SaveCopyMessage) =>
      this.saveCopy(message),
    );
    ipcMain.handle("capture.readPdfForm", (_event, bytes: Uint8Array) => this.readPdfForm(bytes));
    ipcMain.handle("capture.fillPdfForm", (_event, message: FillPdfMessage) =>
      this.fillPdfForm(message),
    );
    ipcMain.handle("capture.classifyFile", (_event, bytes: Uint8Array, name: string) =>
      this.classifyFile(bytes, name),
    );
    ipcMain.handle("capture.openPath", (_event, targetPath: string) => {
      if (typeof targetPath !== "string" || !targetPath.trim()) {
        return "Missing path";
      }
      return shell.openPath(targetPath);
    });
    ipcMain.handle("capture.showInFolder", (_event, targetPath: string) => {
      if (typeof targetPath === "string" && targetPath.trim()) {
        shell.showItemInFolder(targetPath);
      }
    });
  }

  /** Classifies a PDF or image as a blank fillable form, personal source document, or ambiguous. */
  private async classifyFile(bytes: Uint8Array, name: string): Promise<ClassifiedFile> {
    const ext = this.extensionOf(bytes, name);
    return this.withHelper(bytes, ext, async (helper, file) => {
      const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--classify", file]);
      const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout) as ClassifiedFile;
    });
  }

  /** The text of a PDF or an image: the PDF's text layer, or what recognition reads from a page. */
  private async readDocument(bytes: Uint8Array, name: string): Promise<string> {
    return this.withHelper(bytes, path.extname(name).toLowerCase(), async (helper, file) => {
      const [cmd, cmdArgs] = resolveHelperCommand(helper, [file]);
      const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    });
  }

  /** The pieces of printed text on each page of a document, each with its place on the page. */
  private async readPieces(bytes: Uint8Array, name: string): Promise<string> {
    return this.withHelper(bytes, path.extname(name).toLowerCase(), async (helper, file) => {
      const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--pieces", file]);
      const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    });
  }

  private decisionConfigPath(): string {
    return path.join(app.getPath("userData"), DECISION_CONFIG_FILENAME);
  }

  private async readStoredDecisionConfig(): Promise<StoredDecisionConfig> {
    try {
      const file = this.decisionConfigPath();
      if (!existsSync(file)) {
        return {};
      }
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as StoredDecisionConfig;
      return {
        url: typeof raw?.url === "string" ? raw.url.trim() : "",
        apiKey: typeof raw?.apiKey === "string" ? raw.apiKey.trim() : "",
      };
    } catch {
      return {};
    }
  }

  async getDecisionConfig(): Promise<DecisionConfig> {
    const stored = await this.readStoredDecisionConfig();
    return {
      url: stored.url ?? "",
      hasKey: Boolean(stored.apiKey),
    };
  }

  async setDecisionConfig(patch: UpdateDecisionConfigMessage): Promise<DecisionConfig> {
    const stored = await this.readStoredDecisionConfig();
    const rawUrl = patch?.url ?? patch?.customUrl;
    const nextUrl = typeof rawUrl === "string" ? rawUrl.trim() : (stored.url ?? "");
    const nextKey =
      patch?.clearKey || patch?.apiKey === ""
        ? ""
        : typeof patch?.apiKey === "string" && patch.apiKey.trim()
          ? patch.apiKey.trim()
          : (stored.apiKey ?? "");

    const file = this.decisionConfigPath();
    if (!nextUrl && !nextKey) {
      if (existsSync(file)) {
        await fs.unlink(file).catch((): void => undefined);
      }
      return { url: "", hasKey: false };
    }

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({ url: nextUrl || undefined, apiKey: nextKey || undefined }, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
    if (process.platform !== "win32") {
      await fs.chmod(file, 0o600).catch((): void => undefined);
    }
    return { url: nextUrl, hasKey: Boolean(nextKey) };
  }

  /**
   * Where Decision is asked: Jev's `/v1/systemone`, or a server that speaks it, such as an open
   * model run on this computer. User-configured endpoint settings in `vowkey-decision.json` take
   * precedence in both development and packaged builds, followed by environment variables
   * (`VOWKEY_DECISION_URL`, `VOWKEY_DECISION_KEY`, `VOWKEY_DECISION_MODEL`) and the macOS keychain
   * item `typesafe.ai.jev`.
   */
  private async decision(): Promise<{
    url: string;
    key: string;
    model: string;
    perRequest: number;
  } | null> {
    const stored = await this.readStoredDecisionConfig();
    const customUrl = stored.url || process.env.VOWKEY_DECISION_URL || "";
    let key = stored.apiKey || process.env.VOWKEY_DECISION_KEY;
    const useKeychainFallback =
      !app?.isPackaged ||
      Boolean(customUrl) ||
      process.env.VOWKEY_E2E === "1";
    if (!key && useKeychainFallback && process.platform === "darwin") {
      try {
        const { stdout } = await run("security", [
          "find-generic-password",
          "-s",
          "typesafe.ai.jev",
          "-w",
        ]);
        key = stdout.trim();
      } catch {
        // No such item: Decision is not set up on this computer.
      }
    }
    if (!key && !customUrl && VOWKEY_BUNDLED_DECISION_KEY) {
      key = VOWKEY_BUNDLED_DECISION_KEY;
    }
    if (!key && !customUrl) {
      return null;
    }
    return {
      key: key ?? "",
      url: customUrl || "https://api.typesafe.ai/v1/systemone",
      model: process.env.VOWKEY_DECISION_MODEL ?? "jev-1.14.0",
      perRequest: Number(process.env.VOWKEY_DECISION_BATCH ?? 0) || 0,
    };
  }

  /** Asks Decision one request. The call is made here because a page cannot call the service. */
  private async askDecision(request: object): Promise<unknown> {
    const decision = await this.decision();
    if (decision == null) {
      throw new Error("Decision is not set up.");
    }
    let status = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(decision.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(decision.key ? { Authorization: `Bearer ${decision.key}` } : {}),
        },
        body: JSON.stringify({ model: decision.model, ...request }),
      });
      if (response.ok) {
        return response.json();
      }
      status = response.status;
      if (![429, 500, 502, 503, 504].includes(status)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    throw new Error(`Decision answered ${status}.`);
  }

  private extensionOf(bytes: Uint8Array, name?: string): string {
    const fromName = name ? path.extname(name).toLowerCase() : "";
    if (fromName) {
      return fromName;
    }
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return ".png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return ".jpg";
    }
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46
    ) {
      return ".webp";
    }
    return ".pdf";
  }

  /** The fields of a PDF or photographed paper form, each with the printed words that name it. */
  private async readPdfForm(bytes: Uint8Array): Promise<PdfFormField[]> {
    const ext = this.extensionOf(bytes);
    return this.withHelper(bytes, ext, async (helper, file) => {
      const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--form", file]);
      const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
      const parsed = JSON.parse(stdout) as { fields?: PdfFormField[]; xfaOnly?: boolean };
      if (parsed.xfaOnly && (!parsed.fields || parsed.fields.length === 0)) {
        throw new Error(
          "This PDF uses Adobe XFA forms. Print or save it as a standard PDF first, then drop it again.",
        );
      }
      return parsed.fields ?? [];
    });
  }

  /** Fills a PDF or photographed paper form and saves the copy beside the original. */
  private async fillPdfForm(message: FillPdfMessage): Promise<{ path: string; filled: number }> {
    const ext = this.extensionOf(message.bytes, message.name);
    const filled = await this.withHelper(message.bytes, ext, async (helper, file) => {
      const runFill = async (outPath: string, map: Record<string, string>) => {
        const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--fill", file, outPath]);
        const child = execFile(cmd, cmdArgs);
        child.stdin?.end(JSON.stringify(map));
        const [code, stdout] = await new Promise<[number | null, string]>((resolve, reject) => {
          let text = "";
          child.stdout?.on("data", (chunk) => (text += chunk));
          child.on("error", reject);
          child.on("close", (exit) => resolve([exit, text]));
        });
        if (code !== 0) {
          throw new Error("The PDF could not be filled.");
        }
        return { bytes: await fs.readFile(outPath), count: Number(stdout.trim()) || 0 };
      };
      const out = file.slice(0, -ext.length) + "-filled" + ext;
      return runFill(out, message.values);
    });
    const pathOut = await this.saveCopy({
      sourcePath: message.sourcePath,
      name: message.name,
      bytes: filled.bytes,
    });
    return { path: pathOut, filled: filled.count };
  }

  private async withHelper<T>(
    bytes: Uint8Array,
    extension: string,
    use: (helper: string, file: string) => Promise<T>,
  ): Promise<T> {
    const helper = this.helperPath();
    if (helper == null) {
      throw new Error("Reading documents is not available on this computer yet.");
    }
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vowkey-read-"));
    try {
      const file = path.join(folder, "document" + extension);
      await fs.writeFile(file, bytes);
      return await use(helper, file);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  }

  private helperPath(): string | null {
    if (process.platform === "win32") {
      const winCandidates = [
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
        path.join(app.getAppPath(), "..", "desktop_native", "dist", "vowkey-read.win32-arm64.exe"),
        path.join(app.getAppPath(), "..", "desktop_native", "ocr", "vowkey-read.exe"),
        path.join(process.resourcesPath, "win-ocr.ps1"),
        path.join(app.getAppPath(), "..", "desktop_native", "ocr", "win-ocr.ps1"),
      ];
      return winCandidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
    }
    const candidates = [
      process.env.VOWKEY_READ_HELPER,
      ...(process.platform === "darwin"
        ? [
            path.join(process.resourcesPath, "vowkey-read"),
            path.join(app.getAppPath(), "..", "desktop_native", "ocr", "vowkey-read"),
          ]
        : []),
      path.join(process.resourcesPath, "open-read.py"),
      path.join(app.getAppPath(), "..", "..", "scripts", "open-read.py"),
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
  }

  /** Writes a filled copy next to the original, or in Downloads, and shows it. */
  private async saveCopy(message: SaveCopyMessage): Promise<string> {
    const { name, ext } = path.parse(message.name);
    const folders = [
      message.sourcePath ? path.dirname(message.sourcePath) : null,
      app.getPath("downloads"),
    ].filter((folder): folder is string => folder != null);

    let lastError: unknown;
    for (const folder of folders) {
      let target = path.join(folder, `${name} (filled)${ext}`);
      for (let n = 2; existsSync(target); n++) {
        target = path.join(folder, `${name} (filled ${n})${ext}`);
      }
      try {
        await fs.writeFile(target, message.bytes);
      } catch (error) {
        lastError = error;
        continue;
      }
      if (process.env.VOWKEY_E2E !== "1") {
        const error = await shell.openPath(target);
        if (error) {
          shell.showItemInFolder(target);
          throw new Error(`The copy was saved as ${target}, but could not be opened: ${error}`);
        }
      }
      return target;
    }
    throw lastError;
  }
}
