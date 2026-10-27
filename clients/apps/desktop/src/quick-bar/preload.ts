import { ipcRenderer } from "electron";

import type { QuickBarRequest } from "./types";

export default {
  /**
   * Hands this window the requests of the pill, which reaches the vault through it. The answer goes
   * back with `respond`: a promise made in the page cannot cross into this isolated preload.
   */
  onRequest: (handler: (id: number, request: QuickBarRequest) => void) => {
    ipcRenderer.on("quickBar.request", (_event, id: number, request: QuickBarRequest) =>
      handler(id, request),
    );
  },
  respond: (id: number, result: unknown) => ipcRenderer.send("quickBar.response", id, result),
};
