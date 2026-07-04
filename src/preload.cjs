const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("crawler", {
  getState: () => ipcRenderer.invoke("get-state"),
  saveConfig: (config) => ipcRenderer.invoke("save-config", config),
  startCrawl: (payload) => ipcRenderer.invoke("start-crawl", payload),
  stopCrawl: () => ipcRenderer.invoke("stop-crawl"),
  clearResults: (scope) => ipcRenderer.invoke("clear-results", scope),
  deleteRows: (ids) => ipcRenderer.invoke("delete-rows", ids),
  updateRow: (id, patch) => ipcRenderer.invoke("update-row", id, patch),
  deleteCampaign: (id) => ipcRenderer.invoke("delete-campaign", id),
  renameCampaign: (id, name) => ipcRenderer.invoke("rename-campaign", id, name),
  exportFile: (options) => ipcRenderer.invoke("export", options),
  currentLocation: () => ipcRenderer.invoke("current-location"),
  previewLocation: (config) => ipcRenderer.invoke("preview-location", config),
  browserLeaksLocation: () => ipcRenderer.invoke("browserleaks-location"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  onState: (callback) => ipcRenderer.on("state", (_event, state) => callback(state))
});
