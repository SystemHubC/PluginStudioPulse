/// <reference types="vite/client" />

declare global {
  interface Window {
    studioWindow: {
      minimize(): Promise<boolean>;
      maximizeToggle(): Promise<boolean>;
      close(): Promise<boolean>;
      isMaximized(): Promise<boolean>;
    };
    studio: {
      getSettings(): Promise<any>;
      setSettings(s: any): Promise<boolean>;
      listProjects(): Promise<any[]>;
      createProject(p: any): Promise<any>;
      importFolder(): Promise<any>;
      importArchive(): Promise<any>;
      getTree(projectId: string): Promise<{root: string; tree: FileNode[]}>;
      readFile(projectId: string, rel: string): Promise<string>;
      writeFile(projectId: string, rel: string, content: string): Promise<boolean>;
      createEntry(projectId: string, rel: string, type: 'file'|'directory'): Promise<boolean>;
      renameEntry(projectId: string, rel: string, nextRel: string): Promise<boolean>;
      deleteEntry(projectId: string, rel: string): Promise<boolean>;
      openPath(p: string): Promise<boolean>;
      ensureSdk(projectId: string): Promise<any>;
      fixSsl(projectId: string): Promise<any>;
      runCommand(projectId: string, preset: string, extra?: any): Promise<any>;
      packageInfo(projectId: string): Promise<any[]>;
      getManifest(projectId: string): Promise<any>;
      saveManifest(projectId: string, manifest: any): Promise<boolean>;
      getSessionReports(projectId: string): Promise<any[]>;
      openSessionFolder(projectId: string): Promise<boolean>;
      publishPackage(projectId: string, payload: any): Promise<any>;
      authGetState(): Promise<any>;
      authTelegramInit(): Promise<any>;
      authTelegramPoll(code: string): Promise<any>;
      authGetProfile(): Promise<any>;
      authGetAuthorProfile(): Promise<any>;
      authSaveAuthorProfile(payload: any): Promise<any>;
      authOpenTelegram(payload: any): Promise<any>;
      authOpenAuthorProfile(): Promise<any>;
      marketplaceGetStats(): Promise<any>;
      developerTokenCreate(payload: any): Promise<any>;
      developerTokenRevoke(publicId: string): Promise<any>;
      securityScan(projectId: string): Promise<any>;
      packageGuard(projectId: string): Promise<any>;
      openExternal(url: string): Promise<any>;
      authLogout(): Promise<any>;
      updaterGetInfo(): Promise<any>;
      updaterSetManifestUrl(url: string): Promise<any>;
      updaterCheckInno(manifestUrl?: string): Promise<any>;
      updaterDownloadInno(manifest: any): Promise<any>;
      updaterInstallInno(installerPath?: string): Promise<any>;
      updaterOnEvent(callback: (payload: any) => void): () => void;
    }
  }
}

export type FileNode = {
  name: string;
  path: string;
  type: 'file'|'directory';
  children?: FileNode[];
};
