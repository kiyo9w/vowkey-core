import { execFile, spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { FILL_BRIDGE_SWIFT } from "./fill-bridge-swift";

const run = promisify(execFile);
const BRIDGE_VERSION = "v1";

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScannedElement {
  id: string;
  role: string;
  subrole?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  frame?: Frame;
  enabled?: boolean;
  focused?: boolean;
  secure?: boolean;
  settable?: boolean;
  options?: string[];
}

export interface WindowScan {
  appName?: string;
  bundleId?: string;
  pid: number;
  windowTitle?: string;
  window?: Frame;
  elements: ScannedElement[];
  truncated: boolean;
  note?: string;
}

export interface BridgeOp {
  op: "fill" | "select" | "press" | "focus" | "read" | "click" | "type" | "key" | "scroll" | "wait";
  id?: string;
  value?: string;
  x?: number;
  y?: number;
  count?: number;
  key?: string;
  modifiers?: string[];
  dx?: number;
  dy?: number;
}

export interface BridgeOpResult {
  op: string;
  id?: string;
  ok: boolean;
  method?: string;
  readback?: string;
  error?: string;
}

export interface Screenshot {
  /** PNG bytes, one image pixel per `scale` screen points. */
  png: Buffer;
  width: number;
  height: number;
  /** Screen position of the image's top-left corner, in points. */
  origin: { x: number; y: number };
  /** Screen points per image pixel. */
  scale: number;
}

/**
 * Reads and drives the window of another app through macOS Accessibility, CoreGraphics events and
 * `screencapture`. The helper is compiled from Swift on first use and cached under user data.
 */
export class FillBridge {
  private binaryPath: string | null = null;
  private building: Promise<string> | null = null;

  constructor(private readonly userDataPath: string) {}

  async ensureBinary(): Promise<string> {
    if (this.binaryPath && existsSync(this.binaryPath)) {
      return this.binaryPath;
    }
    this.building ??= this.compile().finally(() => (this.building = null));
    return this.building;
  }

  private async compile(): Promise<string> {
    const binDir = path.join(this.userDataPath, "bin");
    mkdirSync(binDir, { recursive: true });
    const target = path.join(binDir, `vowkey-fill-bridge-${BRIDGE_VERSION}`);
    if (!existsSync(target)) {
      const source = path.join(binDir, `vowkey-fill-bridge-${BRIDGE_VERSION}.swift`);
      const tmp = `${target}.tmp-${process.pid}`;
      await fs.writeFile(source, FILL_BRIDGE_SWIFT, "utf8");
      try {
        await run("/usr/bin/swiftc", ["-O", source, "-o", tmp], { timeout: 120_000 });
      } catch {
        throw new Error(
          "Vowkey could not build its window helper. Install the Xcode Command Line Tools (xcode-select --install) and try again.",
        );
      }
      await fs.rename(tmp, target);
      await fs.unlink(source).catch((): void => undefined);
    }
    this.binaryPath = target;
    return target;
  }

  private async call<T>(mode: string, input: unknown, timeoutMs: number): Promise<T> {
    const bin = await this.ensureBinary();
    return new Promise<T>((resolve, reject) => {
      const child = spawn(bin, [mode], { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`The window helper took longer than ${Math.round(timeoutMs / 1000)}s.`));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(out.trim()) as T);
        } catch {
          reject(new Error(err.trim() || "The window helper returned nothing."));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  }

  scan(pid: number, maxElements = 700): Promise<WindowScan> {
    return this.call<WindowScan>("scan", { pid, maxElements }, 20_000);
  }

  act(pid: number, ops: BridgeOp[]): Promise<BridgeOpResult[]> {
    return this.call<BridgeOpResult[]>("act", { pid, ops }, 15_000 + ops.length * 4_000);
  }

  window(pid: number): Promise<{ pid: number; frame?: Frame; windowNumber?: number; title?: string }> {
    return this.call("window", { pid }, 8_000);
  }

  /** Captures the target window, resized so one pixel is one point (at most 1600 px wide). */
  async screenshot(pid: number): Promise<Screenshot> {
    const info = await this.window(pid);
    const file = path.join(os.tmpdir(), `vowkey-fill-${process.pid}-${Date.now()}.png`);
    try {
      const frame = info.frame;
      const args = ["-x", "-o", "-t", "png"];
      if (info.windowNumber != null) {
        args.push("-l", String(info.windowNumber));
      } else if (frame) {
        args.push("-R", `${frame.x},${frame.y},${frame.w},${frame.h}`);
      }
      args.push(file);
      await run("/usr/sbin/screencapture", args, { timeout: 10_000 });
      const pointsWidth = Math.round(frame?.w ?? 0);
      const targetWidth = Math.min(1600, pointsWidth > 0 ? pointsWidth : 1600);
      await run("/usr/bin/sips", ["--resampleWidth", String(targetWidth), file], { timeout: 10_000 });
      const { stdout } = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
      const width = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1] ?? targetWidth);
      const height = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1] ?? 0);
      const png = await fs.readFile(file);
      return {
        png,
        width,
        height,
        origin: { x: frame?.x ?? 0, y: frame?.y ?? 0 },
        scale: frame && width > 0 ? frame.w / width : 1,
      };
    } finally {
      await fs.unlink(file).catch((): void => undefined);
    }
  }
}
