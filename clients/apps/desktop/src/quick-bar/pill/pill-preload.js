// Gives the pill window the few calls it makes; everything else stays in the main process.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vowkeyPill", {
  /** Runs each time the pill is shown, with the platform and the window/app in front. */
  onShow: (callback) => ipcRenderer.on("pill.show", (_event, message) => callback(message)),
  /** Runs when the vault or agent state changes while the pill is open. */
  onRefresh: (callback) => ipcRenderer.on("pill.refresh", (_event, message) => callback(message)),
  /** Runs when the user switches external apps/files while Quick Bar floats above windows. */
  onFront: (callback) => ipcRenderer.on("pill.front", (_event, front) => callback(front)),
  /** Runs when Quick Bar window mode preferences change live in Settings. */
  onPrefs: (callback) => ipcRenderer.on("pill.prefs", (_event, prefs) => callback(prefs)),
  /** Runs immediately after an interactive screen scan captures a region. */
  onScanning: (callback) => ipcRenderer.on("pill.scanning", (_event, label) => callback(label)),
  /** The items and details in the vault, or `{ locked: true }` while the vault is locked. */
  details: (profileId) => ipcRenderer.invoke("pill.details", profileId),
  openProfile: (profileId, sourceId, variantId) =>
    ipcRenderer.invoke("pill.openProfile", profileId, sourceId, variantId),
  openItem: (cipherId) => ipcRenderer.invoke("pill.openItem", cipherId),
  unlock: (password) => ipcRenderer.invoke("pill.unlock", password),
  protect: (password) => ipcRenderer.invoke("pill.protect", password),
  dismissProtection: () => ipcRenderer.invoke("pill.dismissProtection"),
  /** Answers an external AI agent pairing or @vk: approval request. */
  agentDecision: (payload) => ipcRenderer.invoke("pill.agentDecision", payload),
  /** Types a single value into the focused field of the app in front; resolves to error or null. */
  type: (value) => ipcRenderer.invoke("pill.type", value),
  /** Types username -> Tab -> password into the login form in front; resolves to error or null. */
  typeLogin: (username, password, totp) =>
    ipcRenderer.invoke("pill.typeLogin", username, password, totp),
  copy: (value) => ipcRenderer.invoke("pill.copy", value),
  /** Adds a dropped document to the vault, or fills a dropped form. */
  add: (file, profileId) => ipcRenderer.invoke("pill.add", webUtils.getPathForFile(file), profileId),
  /** Reads an image or document pasted via ⌘V into the selected profile. */
  pasteImage: (name, bytes, profileId) =>
    ipcRenderer.invoke("pill.pasteImage", name, bytes, profileId),
  /** Reads a native macOS screenshot on the clipboard (⌘⌃⇧4) into the selected profile. */
  pasteClipboardImage: (profileId) => ipcRenderer.invoke("pill.pasteClipboardImage", profileId),
  /** Interactive macOS screen region capture (`screencapture -i -x`) straight into a profile. */
  scanScreen: (profileId) => ipcRenderer.invoke("pill.scanScreen", profileId),
  /** Fills the open document or frontmost app/site login. */
  fill: (profileId) => ipcRenderer.invoke("pill.fill", profileId),
  openHub: () => ipcRenderer.send("pill.openHub"),
  hide: () => ipcRenderer.send("pill.hide"),
  /** Makes the window as tall as what the pill shows. */
  resize: (height) => ipcRenderer.send("pill.resize", height),
});
