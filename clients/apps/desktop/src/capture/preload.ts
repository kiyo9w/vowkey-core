import { ipcRenderer, webUtils } from "electron";

import { FillPdfMessage, PdfFormField, SaveCopyMessage } from "./types/capture";

export default {
  /** Where a dropped or chosen file lives on this computer. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** The text of a PDF or an image, read on this computer. */
  readDocument: (bytes: Uint8Array, name: string): Promise<string> =>
    ipcRenderer.invoke("capture.readDocument", bytes, name),
  /** The pieces of printed text on each page of a document, each with its place on the page, as JSON. */
  readPieces: (bytes: Uint8Array, name: string): Promise<string> =>
    ipcRenderer.invoke("capture.readPieces", bytes, name),
  /** Whether Clef is set up, so a document can be read by asking it. */
  clefConfigured: (): Promise<boolean> => ipcRenderer.invoke("capture.clefConfigured"),
  /** Asks Clef one request; resolves to its answers. */
  askClef: (request: object): Promise<unknown> => ipcRenderer.invoke("capture.askClef", request),
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
