import { execFile } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { app, ipcMain, shell } from "electron";

import { FillPdfMessage, PdfFormField, SaveCopyMessage } from "../types/capture";

const run = promisify(execFile);

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
    ipcMain.handle("capture.saveCopy", (_event, message: SaveCopyMessage) =>
      this.saveCopy(message),
    );
    ipcMain.handle("capture.readPdfForm", (_event, bytes: Uint8Array) => this.readPdfForm(bytes));
    ipcMain.handle("capture.fillPdfForm", (_event, message: FillPdfMessage) =>
      this.fillPdfForm(message),
    );
  }

  /** The text of a PDF or an image: the PDF's text layer, or what recognition reads from a page. */
  private async readDocument(bytes: Uint8Array, name: string): Promise<string> {
    return this.withHelper(bytes, path.extname(name).toLowerCase(), async (helper, file) => {
      const { stdout } = await run(helper, [file], { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
    });
  }

  /** The fields of a PDF form, each with the printed words that name it. */
  private async readPdfForm(bytes: Uint8Array): Promise<PdfFormField[]> {
    return this.withHelper(bytes, ".pdf", async (helper, file) => {
      const { stdout } = await run(helper, ["--form", file], { maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(stdout).fields as PdfFormField[];
    });
  }

  /** Fills a PDF form the way Preview does and saves the copy beside the original. */
  private async fillPdfForm(message: FillPdfMessage): Promise<{ path: string; filled: number }> {
    const filled = await this.withHelper(message.bytes, ".pdf", async (helper, file) => {
      const out = file.replace(/\.pdf$/, "-filled.pdf");
      const child = execFile(helper, ["--fill", file, out]);
      child.stdin?.end(JSON.stringify(message.values));
      const [code, stdout] = await new Promise<[number | null, string]>((resolve, reject) => {
        let text = "";
        child.stdout?.on("data", (chunk) => (text += chunk));
        child.on("error", reject);
        child.on("close", (exit) => resolve([exit, text]));
      });
      if (code !== 0) {
        throw new Error("The PDF could not be filled.");
      }
      return { bytes: await fs.readFile(out), count: Number(stdout.trim()) || 0 };
    });
    const path = await this.saveCopy({
      sourcePath: message.sourcePath,
      name: message.name,
      bytes: filled.bytes,
    });
    return { path, filled: filled.count };
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
    if (process.platform !== "darwin") {
      return null;
    }
    const candidates = [
      process.env.VOWKEY_READ_HELPER,
      path.join(process.resourcesPath, "vowkey-read"),
      path.join(app.getAppPath(), "..", "desktop_native", "ocr", "vowkey-read"),
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
        shell.showItemInFolder(target);
      }
      return target;
    }
    throw lastError;
  }
}
