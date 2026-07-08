/**
 * Global type declarations for the Electron preload API.
 * Exposed via contextBridge.exposeInMainWorld('electronAPI', ...) in electron/preload.ts.
 */

interface ClaudeInstallDetection {
  path: string;
  version: string | null;
  type: 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown';
}

interface ElectronInstallAPI {
  checkPrerequisites: () => Promise<{
    hasClaude: boolean;
    claudeVersion?: string;
    claudePath?: string;
    claudeInstallType?: 'native' | 'homebrew' | 'npm' | 'bun' | 'unknown';
    otherInstalls?: ClaudeInstallDetection[];
    hasGit?: boolean;
    platform?: string;
  }>;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  getLogs: () => Promise<string[]>;
  installGit: () => Promise<{ success: boolean; output?: string; error?: string }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onProgress: (callback: (data: any) => void) => () => void;
}

interface UpdateStatusEvent {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: {
    version: string;
    releaseNotes?: string | { version: string; note: string }[] | null;
    releaseName?: string | null;
    releaseDate?: string;
  };
  progress?: {
    percent: number;
    bytesPerSecond: number;
    transferred: number;
    total: number;
  };
  error?: string;
}

interface ElectronUpdaterAPI {
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => Promise<void>;
  onStatus: (callback: (data: UpdateStatusEvent) => void) => () => void;
}

interface ElectronTerminalAPI {
  create: (opts: { id: string; cwd: string; cols: number; rows: number }) => Promise<void>;
  write: (id: string, data: string) => void;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (data: { id: string; data: string }) => void) => () => void;
  onExit: (callback: (data: { id: string; code: number }) => void) => () => void;
}

interface ElectronAPI {
  versions: {
    electron: string;
    node: string;
    chrome: string;
    platform: string;
  };
  shell: {
    openPath: (path: string) => Promise<string>;
  };
  app?: {
    /** Resolve the persistent log directory used by main process logging.
     *  Returns null when Electron can't surface a path (e.g. permission
     *  error). Renderer must guard for absence in non-Electron / web contexts. */
    getLogPath: () => Promise<string | null>;
  };
  fs: {
    /** Resolve a File's absolute filesystem path (via Electron webUtils). Empty string if unavailable. */
    getPathForFile: (file: File) => string;
  };
  dialog: {
    openFolder: (options?: {
      defaultPath?: string;
      title?: string;
    }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  install: ElectronInstallAPI;
  updater?: ElectronUpdaterAPI;
  bridge?: {
    isActive: () => Promise<boolean>;
  };
  proxy?: {
    resolve: (url: string) => Promise<string>;
  };
  terminal?: ElectronTerminalAPI;
  notification?: {
    /**
     * Phase 3 Step 3: payload extended with task / session / event IDs
     * so the OS notification's click handler can route to
     * `/settings/tasks?focus=…` (or the chat session). Returns the
     * underlying `ipcRenderer.invoke` result — `true` if the native
     * notification was created, `false` on Electron error.
     */
    show: (options: {
      title: string;
      body?: string;
      onClick?: { type: string; payload: string } | string;
      taskId?: string;
      sessionId?: string;
      event_id?: string;
    }) => Promise<boolean>;
    /**
     * Phase 3 Step 3: action payload now carries the task/session/event
     * tuple so `useNotificationClickRoute` can `router.push` to the
     * right page. Legacy string / `{type, payload}` shape kept for
     * non-task notifications.
     */
    onClick: (
      listener: (
        action:
          | string
          | { type: string; payload: string }
          | { taskId?: string; sessionId?: string; event_id?: string },
      ) => void,
    ) => () => void;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
