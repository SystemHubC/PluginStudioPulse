import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("studioBridgeReady", true);
contextBridge.exposeInMainWorld("studioWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximizeToggle: () => ipcRenderer.invoke("window:maximizeToggle"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  action: (action) => ipcRenderer.invoke(`window:${action}`)
});
contextBridge.exposeInMainWorld("studio", {
  getSettings: () => ipcRenderer.invoke("studio:getSettings"),
  setSettings: (s) => ipcRenderer.invoke("studio:setSettings", s),
  listProjects: () => ipcRenderer.invoke("studio:listProjects"),
  createProject: (p) => ipcRenderer.invoke("studio:createProject", p),
  importFolder: () => ipcRenderer.invoke("studio:importFolder"),
  importArchive: () => ipcRenderer.invoke("studio:importArchive"),
  getTree: (projectId) => ipcRenderer.invoke("studio:getTree", projectId),
  readFile: (projectId, rel) => ipcRenderer.invoke("studio:readFile", projectId, rel),
  writeFile: (projectId, rel, content) => ipcRenderer.invoke("studio:writeFile", projectId, rel, content),
  createEntry: (projectId, rel, type) => ipcRenderer.invoke("studio:createEntry", projectId, rel, type),
  renameEntry: (projectId, rel, nextRel) => ipcRenderer.invoke("studio:renameEntry", projectId, rel, nextRel),
  deleteEntry: (projectId, rel) => ipcRenderer.invoke("studio:deleteEntry", projectId, rel),
  openPath: (p) => ipcRenderer.invoke("studio:openPath", p),
  ensureSdk: (projectId) => ipcRenderer.invoke("studio:ensureSdk", projectId),
  fixSsl: (projectId) => ipcRenderer.invoke("studio:fixSsl", projectId),
  runCommand: (projectId, preset, extra) => ipcRenderer.invoke("studio:runCommand", projectId, preset, extra),
  packageInfo: (projectId) => ipcRenderer.invoke("studio:packageInfo", projectId),
  getManifest: (projectId) => ipcRenderer.invoke("studio:getManifest", projectId),
  saveManifest: (projectId, manifest) => ipcRenderer.invoke("studio:saveManifest", projectId, manifest),
  getSessionReports: (projectId) => ipcRenderer.invoke("studio:getSessionReports", projectId),
  openSessionFolder: (projectId) => ipcRenderer.invoke("studio:openSessionFolder", projectId),
  publishPackage: (projectId, payload) => ipcRenderer.invoke("studio:publishPackage", projectId, payload),
  authGetState: () => ipcRenderer.invoke("auth:getState"),
  authTelegramInit: () => ipcRenderer.invoke("auth:telegramInit"),
  authTelegramPoll: (code) => ipcRenderer.invoke("auth:telegramPoll", code),
  authGetProfile: () => ipcRenderer.invoke("auth:getProfile"),
  authGetAuthorProfile: () => ipcRenderer.invoke("auth:getAuthorProfile"),
  authSaveAuthorProfile: (payload) => ipcRenderer.invoke("auth:saveAuthorProfile", payload),
  authOpenTelegram: (payload) => ipcRenderer.invoke("auth:openTelegram", payload),
  authOpenAuthorProfile: () => ipcRenderer.invoke("auth:openAuthorProfile"),
  marketplaceGetStats: () => ipcRenderer.invoke("marketplace:getStats"),
  developerTokenCreate: (payload) => ipcRenderer.invoke("developerTokens:create", payload),
  developerTokenRevoke: (publicId) => ipcRenderer.invoke("developerTokens:revoke", publicId),
  securityScan: (projectId) => ipcRenderer.invoke("studio:securityScan", projectId),
  packageGuard: (projectId) => ipcRenderer.invoke("studio:packageGuard", projectId),
  openExternal: (url) => ipcRenderer.invoke("studio:openExternal", url),
  authLogout: () => ipcRenderer.invoke("auth:logout"),
  updaterGetInfo: () => ipcRenderer.invoke("updater:getInfo"),
  updaterSetManifestUrl: (url) => ipcRenderer.invoke("updater:setManifestUrl", url),
  updaterCheckInno: (manifestUrl) => ipcRenderer.invoke("updater:checkInno", manifestUrl),
  updaterDownloadInno: (manifest) => ipcRenderer.invoke("updater:downloadInno", manifest),
  updaterInstallInno: (installerPath) => ipcRenderer.invoke("updater:installInno", installerPath),
  updaterOnEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updater:event", listener);
    return () => ipcRenderer.removeListener("updater:event", listener);
  }
});
