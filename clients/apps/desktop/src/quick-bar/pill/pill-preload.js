// Gives the pill window the few calls it makes; everything else stays in the main process.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("vowkeyPill", {
  /** Runs each time the pill is shown, with the platform and the window in front. */
  onShow: (callback) => ipcRenderer.on("pill.show", (_event, message) => callback(message)),
  /** The details in the vault, or `{ locked: true }` while the vault is locked. */
  details: (profileId) => ipcRenderer.invoke("pill.details", profileId),
  openProfile: (profileId, sourceId, variantId) =>
    ipcRenderer.invoke("pill.openProfile", profileId, sourceId, variantId),
  unlock: (password) => ipcRenderer.invoke("pill.unlock", password),
  protect: (password) => ipcRenderer.invoke("pill.protect", password),
  dismissProtection: () => ipcRenderer.invoke("pill.dismissProtection"),
  /** Types a value into the field of the app in front; resolves to what stopped it, or null. */
  type: (value) => ipcRenderer.invoke("pill.type", value),
  copy: (value) => ipcRenderer.invoke("pill.copy", value),
  /** Adds a dropped document to the vault, or fills a dropped form. */
  add: (file, profileId) => ipcRenderer.invoke("pill.add", webUtils.getPathForFile(file), profileId),
  /** Fills the document in the window in front. */
  fill: (profileId) => ipcRenderer.invoke("pill.fill", profileId),
  openHub: () => ipcRenderer.send("pill.openHub"),
  hide: () => ipcRenderer.send("pill.hide"),
  /** Makes the window as tall as what the pill shows. */
  resize: (height) => ipcRenderer.send("pill.resize", height),
});
