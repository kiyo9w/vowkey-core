import { ipcRenderer } from "electron";

import type { DesktopShellPreferences, QuickBarRequest } from "./types";

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
  /** Asks the Quick Bar to pop forward when an external AI agent is waiting for approval. */
  notifyAgentPending: () => ipcRenderer.send("quickBar.agentPending"),
  /** Opens and focuses the floating Quick Bar window from the in-app walkthrough. */
  show: (): Promise<void> => ipcRenderer.invoke("quickBar.show"),
  /** Reads persisted Quick Bar & Menu Bar shell preferences. */
  getShellPreferences: (): Promise<DesktopShellPreferences> =>
    ipcRenderer.invoke("quickBar.getShellPreferences"),
  /** Updates Quick Bar & Menu Bar shell preferences and applies them live. */
  updateShellPreferences: (
    patch: Partial<DesktopShellPreferences>,
  ): Promise<DesktopShellPreferences> =>
    ipcRenderer.invoke("quickBar.updateShellPreferences", patch),
  /** Checks whether macOS Accessibility permission is granted (always true on Windows/Linux). */
  accessibilityStatus: (): Promise<boolean> => ipcRenderer.invoke("quickBar.accessibilityStatus"),
  /** Prompts for macOS Accessibility permission and returns whether it is now granted. */
  requestAccessibility: (): Promise<boolean> => ipcRenderer.invoke("quickBar.requestAccessibility"),
  /** Runs when the user picks `Settings…` from the menu bar / system tray right-click menu. */
  onOpenSettings: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("quickBar.openSettings", listener);
    return () => ipcRenderer.removeListener("quickBar.openSettings", listener);
  },
};
