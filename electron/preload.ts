import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('studioBridgeReady', true);

contextBridge.exposeInMainWorld('studioWindow', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  action: (action: 'minimize' | 'maximize' | 'close') => ipcRenderer.invoke(`window:${action}`)
});

contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:getSettings'),
  setSettings: (s: any) => ipcRenderer.invoke('studio:setSettings', s),
  listProjects: () => ipcRenderer.invoke('studio:listProjects'),
  createProject: (p: any) => ipcRenderer.invoke('studio:createProject', p),
  importFolder: () => ipcRenderer.invoke('studio:importFolder'),
  importArchive: () => ipcRenderer.invoke('studio:importArchive'),
  getTree: (projectId: string) => ipcRenderer.invoke('studio:getTree', projectId),
  readFile: (projectId: string, rel: string) => ipcRenderer.invoke('studio:readFile', projectId, rel),
  writeFile: (projectId: string, rel: string, content: string) => ipcRenderer.invoke('studio:writeFile', projectId, rel, content),
  createEntry: (projectId: string, rel: string, type: 'file'|'directory') => ipcRenderer.invoke('studio:createEntry', projectId, rel, type),
  renameEntry: (projectId: string, rel: string, nextRel: string) => ipcRenderer.invoke('studio:renameEntry', projectId, rel, nextRel),
  deleteEntry: (projectId: string, rel: string) => ipcRenderer.invoke('studio:deleteEntry', projectId, rel),
  openPath: (p: string) => ipcRenderer.invoke('studio:openPath', p),
  ensureSdk: (projectId: string) => ipcRenderer.invoke('studio:ensureSdk', projectId),
  fixSsl: (projectId: string) => ipcRenderer.invoke('studio:fixSsl', projectId),
  runCommand: (projectId: string, preset: string, extra?: any) => ipcRenderer.invoke('studio:runCommand', projectId, preset, extra),
  packageInfo: (projectId: string) => ipcRenderer.invoke('studio:packageInfo', projectId),
  getManifest: (projectId: string) => ipcRenderer.invoke('studio:getManifest', projectId),
  saveManifest: (projectId: string, manifest: any) => ipcRenderer.invoke('studio:saveManifest', projectId, manifest),
  getSessionReports: (projectId: string) => ipcRenderer.invoke('studio:getSessionReports', projectId),
  openSessionFolder: (projectId: string) => ipcRenderer.invoke('studio:openSessionFolder', projectId),
  publishPackage: (projectId: string, payload: any) => ipcRenderer.invoke('studio:publishPackage', projectId, payload),
  authGetState: () => ipcRenderer.invoke('auth:getState'),
  authTelegramInit: () => ipcRenderer.invoke('auth:telegramInit'),
  authTelegramPoll: (code: string) => ipcRenderer.invoke('auth:telegramPoll', code),
  authGetProfile: () => ipcRenderer.invoke('auth:getProfile'),
  authGetAuthorProfile: () => ipcRenderer.invoke('auth:getAuthorProfile'),
  authSaveAuthorProfile: (payload: any) => ipcRenderer.invoke('auth:saveAuthorProfile', payload),
  authOpenTelegram: (payload: any) => ipcRenderer.invoke('auth:openTelegram', payload),
  authOpenAuthorProfile: () => ipcRenderer.invoke('auth:openAuthorProfile'),
  marketplaceGetStats: () => ipcRenderer.invoke('marketplace:getStats'),
  developerTokenCreate: (payload: any) => ipcRenderer.invoke('developerTokens:create', payload),
  developerTokenRevoke: (publicId: string) => ipcRenderer.invoke('developerTokens:revoke', publicId),
  securityScan: (projectId: string) => ipcRenderer.invoke('studio:securityScan', projectId),
  packageGuard: (projectId: string) => ipcRenderer.invoke('studio:packageGuard', projectId),
  openExternal: (url: string) => ipcRenderer.invoke('studio:openExternal', url),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  updaterGetInfo: () => ipcRenderer.invoke('updater:getInfo'),
  updaterSetManifestUrl: (url: string) => ipcRenderer.invoke('updater:setManifestUrl', url),
  updaterCheckInno: (manifestUrl?: string) => ipcRenderer.invoke('updater:checkInno', manifestUrl),
  updaterDownloadInno: (manifest: any) => ipcRenderer.invoke('updater:downloadInno', manifest),
  updaterInstallInno: (installerPath?: string) => ipcRenderer.invoke('updater:installInno', installerPath),
  updaterOnEvent: (callback: any) => {
    const listener = (_event: any, payload: any) => callback(payload);
    ipcRenderer.on('updater:event', listener);
    return () => ipcRenderer.removeListener('updater:event', listener);
  }
});
