import { ChildProcess, execFile, spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import * as fs from "fs/promises";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as path from "path";
import { promisify } from "util";

const runExecFile = promisify(execFile);

export const LLAMA_CPP_RELEASE_TAG = "b12123";

export interface RuntimeArchiveSpec {
  tag: string;
  filename: string;
  bytes: number;
  sha256: string;
}

const RUNTIME_ARCHIVES: Record<string, RuntimeArchiveSpec> = {
  "darwin-arm64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-arm64.tar.gz`,
    bytes: 16_671_950,
    sha256: "4273bf18f29f51ca7849d0993bcf01245bbaeef5caeced1050e634475ba8cbca",
  },
  "darwin-x64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-x64.tar.gz`,
    bytes: 12_411_406,
    sha256: "1e14763c3a6c797f00c218d23069114ecea020a9def2874c34f8a0adcf2208f2",
  },
  "win32-x64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-cpu-x64.zip`,
    bytes: 24_730_714,
    sha256: "c9aa8f2eca3579edc0eabaf5b87a4a939c2a971ac294e616b100ce751662f6b2",
  },
  "win32-arm64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-win-cpu-arm64.zip`,
    bytes: 13_225_421,
    sha256: "7b440cc0b8439d112a2f0152a85b21ac0785936e79e95444851a943400abe8e",
  },
  "linux-x64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-x64.tar.gz`,
    bytes: 23_080_658,
    sha256: "aefc041852631c49c785d6c8049595fe846c43e3d9238fd83cb91cc804b584dd",
  },
  "linux-arm64": {
    tag: LLAMA_CPP_RELEASE_TAG,
    filename: `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-arm64.tar.gz`,
    bytes: 18_753_352,
    sha256: "bed0e2229729d57be728b065fa02e2116161e3b1aa95ee804efc728cdc3f49fd",
  },
};

export function runtimeArchiveForPlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): RuntimeArchiveSpec | null {
  return RUNTIME_ARCHIVES[`${platform}-${arch}`] ?? null;
}

export function resolveRuntimeDownloadUrl(spec: RuntimeArchiveSpec): string {
  const base = (
    process.env.VOWKEY_LLAMA_RELEASE_BASE_URL ||
    "https://github.com/ggml-org/llama.cpp/releases/download"
  ).replace(/\/+$/, "");
  return `${base}/${spec.tag}/${spec.filename}`;
}

function openHttpDownloadStream(
  rawUrl: string,
  signal?: AbortSignal,
  redirectsLeft = 8,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      reject(err);
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(
      parsed,
      {
        headers: {
          "User-Agent": "VowkeyDesktop/1.0",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
          res.resume();
          signal?.removeEventListener("abort", onAbort);
          if (redirectsLeft <= 0) {
            reject(new Error("Too many download redirects."));
            return;
          }
          const nextUrl = new URL(res.headers.location, parsed).toString();
          openHttpDownloadStream(nextUrl, signal, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          signal?.removeEventListener("abort", onAbort);
          reject(new Error(`Download failed (${status}).`));
          return;
        }
        signal?.removeEventListener("abort", onAbort);
        resolve(res);
      },
    );
    const onAbort = () => {
      req.destroy(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
  });
}

function probeLocalHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        timeout: 1000,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

export async function streamVerifiedDownload(options: {
  url: string;
  destinationPath: string;
  expectedBytes: number;
  expectedSha256: string;
  signal?: AbortSignal;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
}): Promise<void> {
  const { url, destinationPath, expectedBytes, expectedSha256, signal, onProgress } = options;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const partPath = `${destinationPath}.part`;
  await fs.rm(partPath, { force: true }).catch((): void => undefined);

  let handle: fs.FileHandle | null = null;
  let response: http.IncomingMessage | null = null;
  const onAbortStream = () => {
    response?.destroy(new DOMException("Aborted", "AbortError"));
  };
  try {
    response = await openHttpDownloadStream(url, signal);
    signal?.addEventListener("abort", onAbortStream, { once: true });
    handle = await fs.open(partPath, "w", 0o644);
    const hash = createHash("sha256");
    let downloaded = 0;
    let lastReportAt = 0;

    for await (const chunk of response) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (buf.byteLength > 0) {
        await handle.write(buf);
        hash.update(buf);
        downloaded += buf.byteLength;
        const now = Date.now();
        if (onProgress && (now - lastReportAt >= 80 || downloaded === expectedBytes)) {
          lastReportAt = now;
          onProgress(downloaded, expectedBytes);
        }
      }
    }

    await handle.sync();
    await handle.close();
    handle = null;

    if (downloaded !== expectedBytes) {
      throw new Error(
        `Incomplete download (${downloaded.toLocaleString()} of ${expectedBytes.toLocaleString()} bytes).`,
      );
    }
    const actualSha256 = hash.digest("hex").toLowerCase();
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      throw new Error("Downloaded file did not match its expected SHA-256 checksum.");
    }
    await fs.rename(partPath, destinationPath);
  } catch (err) {
    response?.destroy();
    if (handle != null) {
      await handle.close().catch((): void => undefined);
    }
    await fs.rm(partPath, { force: true }).catch((): void => undefined);
    throw err;
  } finally {
    signal?.removeEventListener("abort", onAbortStream);
  }
}

function findLlamaServerBinarySync(rootDir: string, depth = 0): string | null {
  if (depth > 4 || !existsSync(rootDir)) {
    return null;
  }
  const binaryName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const direct = path.join(rootDir, binaryName);
  try {
    if (existsSync(direct) && statSync(direct).isFile()) {
      return direct;
    }
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nested = findLlamaServerBinarySync(path.join(rootDir, entry.name), depth + 1);
        if (nested) {
          return nested;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function locateInstalledRuntimeBinary(userDataDir: string): string | null {
  const envOverride = process.env.VOWKEY_LLAMA_SERVER?.trim();
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }
  const runtimeDir = path.join(userDataDir, "decision-runtime", LLAMA_CPP_RELEASE_TAG);
  return findLlamaServerBinarySync(runtimeDir);
}

export async function ensureDecisionRuntimeBinary(options: {
  userDataDir: string;
  signal?: AbortSignal;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
}): Promise<string> {
  const existing = locateInstalledRuntimeBinary(options.userDataDir);
  if (existing) {
    return existing;
  }
  const spec = runtimeArchiveForPlatform();
  if (!spec) {
    throw new Error(
      `Local decision runtime is not prebuilt for ${process.platform}-${process.arch}. Set VOWKEY_LLAMA_SERVER to a llama-server binary.`,
    );
  }
  const runtimeDir = path.join(options.userDataDir, "decision-runtime", spec.tag);
  const archivePath = path.join(runtimeDir, spec.filename);
  const extractStaging = path.join(runtimeDir, "extract-staging");

  await fs.rm(extractStaging, { recursive: true, force: true }).catch((): void => undefined);
  await streamVerifiedDownload({
    url: resolveRuntimeDownloadUrl(spec),
    destinationPath: archivePath,
    expectedBytes: spec.bytes,
    expectedSha256: spec.sha256,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  await fs.mkdir(extractStaging, { recursive: true });
  try {
    if (spec.filename.endsWith(".tar.gz")) {
      await runExecFile("tar", ["-xzf", archivePath, "-C", extractStaging]);
    } else if (process.platform === "win32") {
      try {
        await runExecFile("tar.exe", ["-xf", archivePath, "-C", extractStaging]);
      } catch {
        await runExecFile("powershell.exe", [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractStaging.replace(/'/g, "''")}' -Force`,
        ]);
      }
    } else {
      await runExecFile("unzip", ["-oq", archivePath, "-d", extractStaging]);
    }

    const entries = await fs.readdir(extractStaging);
    for (const entry of entries) {
      const dest = path.join(runtimeDir, entry);
      await fs.rm(dest, { recursive: true, force: true }).catch((): void => undefined);
      await fs.rename(path.join(extractStaging, entry), dest);
    }
  } finally {
    await fs.rm(extractStaging, { recursive: true, force: true }).catch((): void => undefined);
    await fs.rm(archivePath, { force: true }).catch((): void => undefined);
  }

  const binary = findLlamaServerBinarySync(runtimeDir);
  if (!binary) {
    throw new Error("Could not locate llama-server inside the downloaded runtime archive.");
  }
  if (process.platform !== "win32") {
    await fs.chmod(binary, 0o755).catch((): void => undefined);
  }
  return binary;
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close(() => reject(new Error("Could not allocate local port.")));
        return;
      }
      const port = addr.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export class DecisionServerSupervisor {
  private child: ChildProcess | null = null;
  private currentModelPath: string | null = null;
  private currentPort: number | null = null;
  private ready = false;
  private starting: Promise<string> | null = null;

  isReadyFor(modelPath: string): boolean {
    return (
      this.ready &&
      this.currentModelPath === modelPath &&
      this.currentPort != null &&
      this.child != null &&
      this.child.exitCode == null &&
      !this.child.killed
    );
  }

  endpointUrl(): string | null {
    if (!this.ready || this.currentPort == null || !this.child || this.child.exitCode != null) {
      return null;
    }
    return `http://127.0.0.1:${this.currentPort}/v1/systemone`;
  }

  async ensureRunning(
    binaryPath: string,
    modelPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.isReadyFor(modelPath) && this.currentPort != null) {
      return `http://127.0.0.1:${this.currentPort}/v1/systemone`;
    }
    if (this.starting != null && this.currentModelPath === modelPath) {
      return this.starting;
    }
    await this.stop();
    this.currentModelPath = modelPath;
    const startPromise = this.spawnAndAwaitHealth(binaryPath, modelPath, signal);
    this.starting = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.starting === startPromise) {
        this.starting = null;
      }
    }
  }

  private async spawnAndAwaitHealth(
    binaryPath: string,
    modelPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const port = await allocateLoopbackPort();
    const args = [
      "-m",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-c",
      "16384",
      "-ub",
      "4096",
      "-b",
      "4096",
    ];
    const child = spawn(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.currentPort = port;
    this.ready = false;

    let recentLogs = "";
    const appendLog = (chunk: Buffer) => {
      recentLogs = (recentLogs + chunk.toString("utf8")).slice(-2048);
    };
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);

    const onAbort = () => {
      void this.stop();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        if (child.exitCode != null) {
          const tail = recentLogs.trim().split("\n").slice(-3).join(" ").trim();
          throw new Error(
            tail
              ? `Could not load this model (${tail}).`
              : `Model server exited early (code ${child.exitCode}).`,
          );
        }
        if (await probeLocalHealth(port)) {
          this.ready = true;
          return `http://127.0.0.1:${port}/v1/systemone`;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("Timed out waiting for the local decision model to start.");
    } catch (err) {
      await this.stop();
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async stop(): Promise<void> {
    const proc = this.child;
    this.child = null;
    this.currentPort = null;
    this.currentModelPath = null;
    this.ready = false;
    if (!proc || proc.exitCode != null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Already exited.
        }
        resolve();
      }, 2000);
      proc.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        proc.kill("SIGTERM");
      } catch {
        clearTimeout(killTimer);
        resolve();
      }
    });
  }
}
