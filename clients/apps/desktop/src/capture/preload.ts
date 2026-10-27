import { ipcRenderer, webUtils } from "electron";

import { FillPdfMessage, PdfFormField, SaveCopyMessage } from "./types/capture";

export default {
  /** Where a dropped or chosen file lives on this computer. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** The text of a PDF or an image, read on this computer. */
  readDocument: (bytes: Uint8Array, name: string): Promise<string> =>
    ipcRenderer.invoke("capture.readDocument", bytes, name),
  /** Writes a filled copy of a form and shows it; resolves to where it went. */
  saveCopy: (message: SaveCopyMessage): Promise<string> =>
    ipcRenderer.invoke("capture.saveCopy", message),
  /** The fields of a PDF form, each with the words printed beside it. */
  readPdfForm: (bytes: Uint8Array): Promise<PdfFormField[]> =>
    ipcRenderer.invoke("capture.readPdfForm", bytes),
  /** Fills a PDF form and saves the copy beside the original; resolves to where it went. */
  fillPdfForm: (message: FillPdfMessage): Promise<{ path: string; filled: number }> =>
    ipcRenderer.invoke("capture.fillPdfForm", message),
};
