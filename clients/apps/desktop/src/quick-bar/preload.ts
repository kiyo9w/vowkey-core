import { ipcRenderer } from "electron";

import type { AiFillAgentOption, DesktopShellPreferences, QuickBarRequest } from "./types";

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
  show: (profileId?: string): Promise<void> => ipcRenderer.invoke("quickBar.show", profileId),
  /** Captures a form region on screen via crosshairs and fills it from the chosen profile. */
  scanScreen: (profileId?: string): Promise<unknown> =>
    ipcRenderer.invoke("quickBar.scanScreen", profileId),
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
  /** Opens the Accessibility list with the floating drag guide docked beside it. */
  showAccessibilityGuide: (template: string): Promise<boolean> =>
    ipcRenderer.invoke("quickBar.showAccessibilityGuide", template),
  /** Clears a stale Accessibility entry left by an older copy and asks macOS to list Vowkey again. */
  resetAccessibility: (): Promise<boolean> => ipcRenderer.invoke("quickBar.resetAccessibility"),
  /** The AI agents installed on this Mac that AI mode can start (Claude Code, Codex, Gemini CLI). */
  aiAgents: (): Promise<AiFillAgentOption[]> => ipcRenderer.invoke("quickBar.aiAgents"),
  /** Quits and reopens Vowkey, for permissions macOS applies only at launch. */
  relaunch: (): Promise<void> => ipcRenderer.invoke("quickBar.relaunch"),
  /** Runs when the user picks `Settings…` from the menu bar / system tray right-click menu. */
  onOpenSettings: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on("quickBar.openSettings", listener);
    return () => ipcRenderer.removeListener("quickBar.openSettings", listener);
  },
};
