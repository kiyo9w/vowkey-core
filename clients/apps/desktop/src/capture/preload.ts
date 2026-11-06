import { ipcRenderer, webUtils } from "electron";

import {
  ClassifiedFile,
  DecisionConfig,
  FillPdfMessage,
  PdfFormField,
  SaveCopyMessage,
  UpdateDecisionConfigMessage,
} from "./types/capture";

export default {
  /** Where a dropped or chosen file lives on this computer. */
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Classifies a dropped file as a fillable form, source document, or ambiguous from its layout. */
  classifyFile: (bytes: Uint8Array, name: string): Promise<ClassifiedFile> =>
    ipcRenderer.invoke("capture.classifyFile", bytes, name),
  /** Opens a saved file on this computer using the default viewer. */
  openPath: (targetPath: string): Promise<string> =>
    ipcRenderer.invoke("capture.openPath", targetPath),
  /** Reveals a saved file in Finder / Explorer. */
  showInFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke("capture.showInFolder", targetPath),
  /** The text of a PDF or an image, read on this computer. */
  readDocument: (bytes: Uint8Array, name: string): Promise<string> =>
    ipcRenderer.invoke("capture.readDocument", bytes, name),
  /** The pieces of printed text on each page of a document, each with its place on the page, as JSON. */
  readPieces: (bytes: Uint8Array, name: string): Promise<string> =>
    ipcRenderer.invoke("capture.readPieces", bytes, name),
  /** How Decision is asked, or null when it is not set up on this computer. */
  decisionSettings: (): Promise<{ perRequest: number } | null> =>
    ipcRenderer.invoke("capture.decisionSettings"),
  /** Reads the user-configured Decision endpoint URL and whether an API key is stored. */
  getDecisionConfig: (): Promise<DecisionConfig> =>
    ipcRenderer.invoke("capture.getDecisionConfig"),
  /** Persists or clears the user-configured Decision endpoint URL and API key. */
  setDecisionConfig: (patch: UpdateDecisionConfigMessage): Promise<DecisionConfig> =>
    ipcRenderer.invoke("capture.setDecisionConfig", patch),
  /** Asks Decision one request; resolves to its answers. */
  askDecision: (request: object): Promise<unknown> => ipcRenderer.invoke("capture.askDecision", request),
  /** Writes a filled copy of a form and shows it; resolves to where it went. */
  saveCopy: (message: SaveCopyMessage): Promise<string> =>
    ipcRenderer.invoke("capture.saveCopy", message),
  /** The fields of a PDF or photographed paper form, with the words printed beside each. */
  readPdfForm: (bytes: Uint8Array, name: string): Promise<PdfFormField[]> =>
    ipcRenderer.invoke("capture.readPdfForm", bytes, name),
  /** Fills a PDF or image form and saves the copy beside the original; resolves to where it went. */
  fillPdfForm: (
    message: FillPdfMessage,
  ): Promise<{ path: string; filled: number; bytes?: Uint8Array }> =>
    ipcRenderer.invoke("capture.fillPdfForm", message),
};
