import { ChildProcess, execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { app, ipcMain, shell } from "electron";

import {
  ClassifiedFile,
  DecisionConfig,
  DecisionSettings,
  FillPdfMessage,
  PdfFormField,
  SaveCopyMessage,
  UpdateDecisionConfigMessage,
} from "../types/capture";

import { DecisionModelManager } from "./decision-manager";

const run = promisify(execFile);
const DECISION_CONFIG_FILENAME = "vowkey-decision.json";

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

interface StoredDecisionConfig {
  url?: string;
  apiKey?: string;
}

function resolveHelperCommand(helper: string, args: string[]): [string, string[]] {
  const lower = helper.toLowerCase();
  if (lower.endsWith(".ps1")) {
    return [
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper, ...args],
    ];
  }
  if (lower.endsWith(".py")) {
    const py = process.env.VOWKEY_PYTHON || (process.platform === "win32" ? "python" : "python3");
    return [py, [helper, ...args]];
  }
  return [helper, args];
}

function piecesJsonToPlainText(rawJson: string): string {
  try {
    const parsed = JSON.parse(rawJson) as {
      pages?: { pieces?: { text?: string; x?: number; y?: number; h?: number }[] }[];
    };
    const linesOut: string[] = [];
    for (const page of parsed.pages ?? []) {
      const pieces = (page.pieces ?? []).filter(
        (p): p is { text: string; x?: number; y?: number; h?: number } =>
          typeof p?.text === "string" && p.text.trim() !== "",
      );
      const sorted = [...pieces].sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
      const rows: (typeof pieces)[] = [];
      for (const piece of sorted) {
        const last = rows[rows.length - 1];
        const anchor = last?.[0];
        const tol = Math.max(anchor?.h ?? 0.02, piece.h ?? 0.02) * 0.55;
        if (
          anchor != null &&
          anchor.y != null &&
          piece.y != null &&
          Math.abs(anchor.y + (anchor.h ?? 0) * 0.5 - (piece.y + (piece.h ?? 0) * 0.5)) <= tol
        ) {
          last.push(piece);
        } else {
          rows.push([piece]);
        }
      }
      for (const row of rows) {
        linesOut.push(
          row
            .sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
            .map((p) => p.text)
            .join(" "),
        );
      }
    }
    return linesOut.join("\n");
  } catch {
    return "";
  }
}

/**
 * Reads documents on this computer and saves the files Vowkey fills. A document is read by a
 * helper that uses the operating system's own PDF text and text recognition, so a photo of a
 * passport is read on this computer and goes nowhere else.
 */
export class CaptureMain {
  private readonly decisionModels = new DecisionModelManager(() => app.getPath("userData"));
  private readonly helperCache = new Map<string, Promise<unknown>>();
  private keychainDecisionKeyCache: { value: string; expiresAt: number } | null = null;
  private serveChild: ChildProcess | null = null;
  private serveHelperPath: string | null = null;
  private serveSeq = 0;
  private serveStdoutBuf = "";
  private readonly servePending = new Map<
    number,
    { resolve: (val: unknown) => void; reject: (err: Error) => void }
  >();

  private digestOf(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  private cacheKey(kind: string, bytes: Uint8Array, ext: string, digest?: string): string {
    return `${kind}:${ext}:${digest ?? this.digestOf(bytes)}`;
  }

  private canUseServeDaemon(helper: string): boolean {
    return process.platform === "darwin" && path.basename(helper) === "vowkey-read";
  }

  private resetServeDaemon(reason?: Error): void {
    const err = reason ?? new Error("vowkey-read daemon closed");
    for (const [, waiter] of this.servePending) {
      waiter.reject(err);
    }
    this.servePending.clear();
    this.serveStdoutBuf = "";
    this.serveChild = null;
    this.serveHelperPath = null;
  }

  private ensureServeDaemon(helper: string): ChildProcess {
    if (
      this.serveChild != null &&
      this.serveHelperPath === helper &&
      !this.serveChild.killed &&
      this.serveChild.exitCode == null &&
      this.serveChild.stdin?.writable
    ) {
      return this.serveChild;
    }
    this.disposeServeDaemon();
    const child = spawn(helper, ["--serve"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    child.unref();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (this.serveChild !== child) {
        return;
      }
      this.serveStdoutBuf += chunk;
      let nl = this.serveStdoutBuf.indexOf("\n");
      while (nl >= 0) {
        const line = this.serveStdoutBuf.slice(0, nl);
        this.serveStdoutBuf = this.serveStdoutBuf.slice(nl + 1);
        nl = this.serveStdoutBuf.indexOf("\n");
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as {
            id?: number;
            ok?: boolean;
            result?: unknown;
            error?: string;
          };
          const waiter = typeof parsed.id === "number" ? this.servePending.get(parsed.id) : null;
          if (waiter != null && typeof parsed.id === "number") {
            this.servePending.delete(parsed.id);
            if (parsed.ok) {
              waiter.resolve(parsed.result);
            } else {
              waiter.reject(new Error(parsed.error || "vowkey-read error"));
            }
          }
        } catch {
          // Ignore malformed stdout fragments.
        }
      }
    });
    child.on("error", (err) => {
      if (this.serveChild === child) {
        this.resetServeDaemon(err);
      }
    });
    child.on("close", () => {
      if (this.serveChild === child) {
        this.resetServeDaemon();
      }
    });
    this.serveChild = child;
    this.serveHelperPath = helper;
    return child;
  }

  private disposeServeDaemon(): void {
    const child = this.serveChild;
    this.resetServeDaemon();
    if (child != null && !child.killed) {
      try {
        child.stdin?.end();
      } catch {
        // Ignore pipe shutdown errors.
      }
      try {
        child.kill();
      } catch {
        // Ignore if already exited.
      }
    }
  }

  private callServeHelper<T>(helper: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.ensureServeDaemon(helper);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const id = ++this.serveSeq;
      this.servePending.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      try {
        child.stdin?.write(JSON.stringify({ id, ...payload }) + "\n");
      } catch (err) {
        this.servePending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private warmServeHelper(): void {
    try {
      const helper = this.helperPath();
      if (helper && this.canUseServeDaemon(helper)) {
        void this.callServeHelper(helper, { cmd: "ping" }).catch((): void => undefined);
      }
    } catch {
      // Best-effort background warmup only.
    }
  }

  private memoizeHelper<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const existing = this.helperCache.get(key) as Promise<T> | undefined;
    if (existing != null) {
      return existing;
    }
    if (this.helperCache.size >= 24) {
      const oldest = this.helperCache.keys().next().value;
      if (oldest != null) {
        this.helperCache.delete(oldest);
      }
    }
    const pending = compute().catch((err) => {
      this.helperCache.delete(key);
      throw err;
    });
    this.helperCache.set(key, pending);
    return pending;
  }

  init() {
    ipcMain.handle("capture.readDocument", (_event, bytes: Uint8Array, name: string) =>
      this.readDocument(bytes, name),
    );
    ipcMain.handle("capture.readPieces", (_event, bytes: Uint8Array, name: string) =>
      this.readPieces(bytes, name),
    );
    ipcMain.handle("capture.decisionSettings", () => this.getDecisionSettings());
    ipcMain.handle("capture.getDecisionConfig", () => this.getDecisionConfig());
    ipcMain.handle("capture.setDecisionConfig", (_event, patch: UpdateDecisionConfigMessage) =>
      this.setDecisionConfig(patch),
    );
    ipcMain.handle("capture.getDecisionModelsState", () => this.decisionModels.getState());
    ipcMain.handle("capture.chooseDecisionModel", (_event, modelId: string) =>
      this.decisionModels.chooseModel(String(modelId ?? "")),
    );
    ipcMain.handle("capture.downloadDecisionModel", (_event, modelId?: string) =>
      this.decisionModels.downloadModel(typeof modelId === "string" ? modelId : undefined),
    );
    ipcMain.handle("capture.cancelDecisionDownload", () => this.decisionModels.cancelDownload());
    ipcMain.handle("capture.deleteDecisionModel", (_event, modelId: string) =>
      this.decisionModels.deleteModel(String(modelId ?? "")),
    );
    ipcMain.handle("capture.importDecisionModelFile", (_event, filePath?: string) =>
      this.decisionModels.importModelFile(typeof filePath === "string" ? filePath : undefined),
    );
    ipcMain.handle("capture.setLocalDecisionActive", (_event, active: boolean) =>
      this.decisionModels.setLocalActive(Boolean(active)),
    );
    ipcMain.handle("capture.askDecision", (_event, request: object) => this.askDecision(request));
    ipcMain.handle("capture.saveCopy", (_event, message: SaveCopyMessage) =>
      this.saveCopy(message),
    );
    ipcMain.handle("capture.readPdfForm", (_event, bytes: Uint8Array, name: string) =>
      this.readPdfForm(bytes, name),
    );
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
    this.warmServeHelper();
  }

  /** Classifies a PDF or image as a blank fillable form, personal source document, or ambiguous. */
  private async classifyFile(bytes: Uint8Array, name: string): Promise<ClassifiedFile> {
    const ext = this.extensionOf(bytes, name);
    const digest = this.digestOf(bytes);
    return this.memoizeHelper(this.cacheKey("classify", bytes, ext, digest), () =>
      this.withHelper(bytes, ext, async (helper, file) => {
        if (this.canUseServeDaemon(helper)) {
          try {
            return await this.callServeHelper<ClassifiedFile>(helper, {
              cmd: "classify",
              file,
              digest,
            });
          } catch {
            // Fall back to one-shot invocation below.
          }
        }
        const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--classify", file]);
        const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 16 * 1024 * 1024 });
        return JSON.parse(stdout) as ClassifiedFile;
      }),
    );
  }

  /** The text of a PDF or an image: the PDF's text layer, or what recognition reads from a page. */
  private async readDocument(bytes: Uint8Array, name: string): Promise<string> {
    const ext = this.extensionOf(bytes, name);
    const digest = this.digestOf(bytes);
    const piecesKey = this.cacheKey("pieces", bytes, ext, digest);
    const cachedPieces = this.helperCache.get(piecesKey) as Promise<string> | undefined;
    if (cachedPieces != null) {
      try {
        const derived = piecesJsonToPlainText(await cachedPieces);
        if (derived !== "") {
          return derived;
        }
      } catch {
        // Fall through to direct helper invocation if cached pieces rejected.
      }
    }
    return this.memoizeHelper(this.cacheKey("text", bytes, ext, digest), () =>
      this.withHelper(bytes, ext, async (helper, file) => {
        if (this.canUseServeDaemon(helper)) {
          try {
            return await this.callServeHelper<string>(helper, {
              cmd: "text",
              file,
              digest,
            });
          } catch {
            // Fall back to one-shot invocation below.
          }
        }
        const [cmd, cmdArgs] = resolveHelperCommand(helper, [file]);
        const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
        return stdout;
      }),
    );
  }

  /** The pieces of printed text on each page of a document, each with its place on the page. */
  private async readPieces(bytes: Uint8Array, name: string): Promise<string> {
    const ext = this.extensionOf(bytes, name);
    const digest = this.digestOf(bytes);
    return this.memoizeHelper(this.cacheKey("pieces", bytes, ext, digest), () =>
      this.withHelper(bytes, ext, async (helper, file) => {
        if (this.canUseServeDaemon(helper)) {
          try {
            const payload = await this.callServeHelper<Record<string, unknown>>(helper, {
              cmd: "pieces",
              file,
              digest,
            });
            return JSON.stringify(payload);
          } catch {
            // Fall back to one-shot invocation below.
          }
        }
        const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--pieces", file]);
        const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
        return stdout;
      }),
    );
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

  async dispose(): Promise<void> {
    this.disposeServeDaemon();
    await this.decisionModels.dispose();
  }

  private async getDecisionSettings(): Promise<DecisionSettings | null> {
    const localModel = await this.decisionModels.activeModelSettings();
    if (localModel) {
      return localModel;
    }
    const configured = await this.configuredRemoteOrLoopbackDecision();
    if (!configured) {
      return null;
    }
    return {
      perRequest: configured.perRequest,
      ...(configured.local ? { local: true } : {}),
    };
  }

  private async configuredRemoteOrLoopbackDecision(): Promise<{
    url: string;
    key: string;
    model: string;
    perRequest: number;
    local: boolean;
  } | null> {
    const stored = await this.readStoredDecisionConfig();
    const customUrl = stored.url || process.env.VOWKEY_DECISION_URL || "";
    let key = stored.apiKey || process.env.VOWKEY_DECISION_KEY;
    const useKeychainFallback =
      !app?.isPackaged || Boolean(customUrl) || process.env.VOWKEY_E2E === "1";
    if (!key && useKeychainFallback && process.platform === "darwin") {
      const now = Date.now();
      if (this.keychainDecisionKeyCache && this.keychainDecisionKeyCache.expiresAt > now) {
        key = this.keychainDecisionKeyCache.value || undefined;
      } else {
        try {
          const { stdout } = await run("security", [
            "find-generic-password",
            "-s",
            "typesafe.ai.jev",
            "-w",
          ]);
          const found = stdout.trim();
          this.keychainDecisionKeyCache = { value: found, expiresAt: now + 60_000 };
          key = found || undefined;
        } catch {
          this.keychainDecisionKeyCache = { value: "", expiresAt: now + 60_000 };
        }
      }
    }
    if (!key && !customUrl) {
      return null;
    }
    const resolvedUrl = customUrl || "https://api.typesafe.ai/v1/systemone";
    return {
      key: key ?? "",
      url: resolvedUrl,
      model: process.env.VOWKEY_DECISION_MODEL ?? "jev-1.14.0",
      perRequest: Number(process.env.VOWKEY_DECISION_BATCH ?? 0) || 0,
      local: Boolean(customUrl && isLoopbackUrl(customUrl)),
    };
  }

  /**
   * Where Decision is asked: an installed open-weight model running on this computer via
   * `llama-server`, or a configured `/v1/systemone` endpoint / Jev key.
   */
  private async decision(): Promise<{
    url: string;
    key: string;
    model: string;
    perRequest: number;
  } | null> {
    const localEndpoint = await this.decisionModels.activeEndpoint();
    if (localEndpoint) {
      return {
        url: localEndpoint.url,
        key: "",
        model: localEndpoint.model,
        perRequest: localEndpoint.perRequest,
      };
    }
    return this.configuredRemoteOrLoopbackDecision();
  }

  private readonly decisionAnswers = new Map<string, Promise<unknown>>();

  /** Asks Decision one request; the same question is answered once and remembered. */
  private async askDecision(request: object): Promise<unknown> {
    const decision = await this.decision();
    if (decision == null) {
      throw new Error("Decision is not set up.");
    }
    const key = `${decision.url}|${decision.model}|${JSON.stringify(request)}`;
    const known = this.decisionAnswers.get(key);
    if (known != null) {
      return known;
    }
    const answer = this.askDecisionUncached(decision, request);
    this.decisionAnswers.set(key, answer);
    answer.catch(() => this.decisionAnswers.delete(key));
    if (this.decisionAnswers.size > 300) {
      this.decisionAnswers.delete(this.decisionAnswers.keys().next().value as string);
    }
    return answer;
  }

  /** Asks Decision one request. The call is made here because a page cannot call the service. */
  private async askDecisionUncached(
    decision: { url: string; key: string; model: string; perRequest: number },
    request: object,
  ): Promise<unknown> {
    const isLocal = isLoopbackUrl(decision.url);
    const timeoutMs = isLocal ? 8_000 : 4_000;
    const maxAttempts = isLocal ? 2 : 2;
    let status = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(decision.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(decision.key ? { Authorization: `Bearer ${decision.key}` } : {}),
        },
        body: JSON.stringify({ model: decision.model, ...request }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return response.json();
      }
      status = response.status;
      if (![429, 500, 502, 503, 504].includes(status)) {
        break;
      }
      if (attempt + 1 < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
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
  private async readPdfForm(bytes: Uint8Array, name: string): Promise<PdfFormField[]> {
    const ext = this.extensionOf(bytes, name);
    const digest = this.digestOf(bytes);
    return this.memoizeHelper(this.cacheKey("form", bytes, ext, digest), () =>
      this.withHelper(bytes, ext, async (helper, file) => {
        let parsed: { fields?: PdfFormField[]; xfaOnly?: boolean } | null = null;
        if (this.canUseServeDaemon(helper)) {
          try {
            parsed = await this.callServeHelper<{ fields?: PdfFormField[]; xfaOnly?: boolean }>(
              helper,
              {
                cmd: "form",
                file,
                digest,
              },
            );
          } catch {
            parsed = null;
          }
        }
        if (parsed == null) {
          const [cmd, cmdArgs] = resolveHelperCommand(helper, ["--form", file]);
          const { stdout } = await run(cmd, cmdArgs, { maxBuffer: 64 * 1024 * 1024 });
          parsed = JSON.parse(stdout) as { fields?: PdfFormField[]; xfaOnly?: boolean };
        }
        if (parsed.xfaOnly && (!parsed.fields || parsed.fields.length === 0)) {
          throw new Error(
            "This PDF uses Adobe XFA forms. Print or save it as a standard PDF first, then drop it again.",
          );
        }
        return parsed.fields ?? [];
      }),
    );
  }

  /** Fills a PDF or photographed paper form and saves the copy beside the original. */
  private async fillPdfForm(
    message: FillPdfMessage,
  ): Promise<{ path: string; filled: number; bytes: Uint8Array }> {
    const ext = this.extensionOf(message.bytes, message.name);
    const digest = this.digestOf(message.bytes);
    const outputExt = ext === ".pdf" || ext === ".jpg" || ext === ".jpeg" ? ext : ".png";
    const filled = await this.withHelper(message.bytes, ext, async (helper, file) => {
      const out = file.slice(0, -ext.length) + "-filled" + outputExt;
      if (this.canUseServeDaemon(helper)) {
        try {
          const serveOut = await this.callServeHelper<{ filled?: number }>(helper, {
            cmd: "fill",
            file,
            digest,
            out,
            values: message.values,
          });
          return {
            bytes: await fs.readFile(out),
            count: Number(serveOut?.filled ?? 0) || 0,
          };
        } catch {
          // Fall back to one-shot invocation below.
        }
      }
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
          throw new Error("The form could not be filled.");
        }
        return { bytes: await fs.readFile(outPath), count: Number(stdout.trim()) || 0 };
      };
      return runFill(out, message.values);
    });
    const outBytes = new Uint8Array(filled.bytes);
    const pathOut = await this.saveCopy({
      sourcePath: message.sourcePath,
      name: path.parse(message.name).name + outputExt,
      bytes: outBytes,
    });
    return { path: pathOut, filled: filled.count, bytes: outBytes };
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
