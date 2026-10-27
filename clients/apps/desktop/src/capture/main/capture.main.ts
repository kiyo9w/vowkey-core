import { execFile } from "child_process";
import { existsSync } from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

import { app, ipcMain, shell } from "electron";

import { SaveCopyMessage } from "../types/capture";

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
  }

  /** The text of a PDF or an image: the PDF's text layer, or what recognition reads from a page. */
  private async readDocument(bytes: Uint8Array, name: string): Promise<string> {
    const helper = this.helperPath();
    if (helper == null) {
      throw new Error("Reading documents is not available on this computer yet.");
    }
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "vowkey-read-"));
    try {
      const file = path.join(folder, "document" + path.extname(name).toLowerCase());
      await fs.writeFile(file, bytes);
      const { stdout } = await run(helper, [file], { maxBuffer: 64 * 1024 * 1024 });
      return stdout;
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
