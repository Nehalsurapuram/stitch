import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutonexSettings,
  DirEntry,
  FileContent,
  Incident,
  ProcessChunk,
  ProcessState,
  SafeSettings,
  SaveResult,
  WatchEvent,
  Workspace
} from '../shared/types'

/**
 * The renderer's entire view of the outside world. Nothing here exposes a
 * generic "run this" or "read that path" escape hatch: every entry maps to one
 * audited main-process handler.
 */

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  version: '0.1.0',

  workspace: {
    pick: (): Promise<Workspace | null> => ipcRenderer.invoke('workspace:pick'),
    open: (path: string): Promise<Workspace> => ipcRenderer.invoke('workspace:open', path),
    onChanged: (handler: (workspace: Workspace) => void) => subscribe('workspace:changed', handler)
  },

  fs: {
    list: (path?: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:list', path),
    read: (path: string): Promise<FileContent> => ipcRenderer.invoke('fs:read', path),
    write: (path: string, text: string): Promise<SaveResult> => ipcRenderer.invoke('fs:write', path, text),
    remove: (path: string): Promise<void> => ipcRenderer.invoke('fs:delete', path),
    onEvent: (handler: (event: WatchEvent) => void) => subscribe('fs:event', handler)
  },

  settings: {
    get: (): Promise<SafeSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AutonexSettings>): Promise<SafeSettings> =>
      ipcRenderer.invoke('settings:update', patch),
    onChanged: (handler: (settings: SafeSettings) => void) => subscribe('settings:changed', handler)
  },

  process: {
    start: (channel: string, command: string): Promise<ProcessState> =>
      ipcRenderer.invoke('process:start', channel, command),
    stop: (channel: string): Promise<void> => ipcRenderer.invoke('process:stop', channel),
    states: (): Promise<ProcessState[]> => ipcRenderer.invoke('process:states'),
    runDiagnostics: (): Promise<void> => ipcRenderer.invoke('process:diagnostics'),
    onOutput: (handler: (chunk: ProcessChunk) => void) => subscribe('process:output', handler),
    onStates: (handler: (states: ProcessState[]) => void) => subscribe('process:states', handler)
  },

  incidents: {
    list: (): Promise<Incident[]> => ipcRenderer.invoke('incidents:list'),
    diagnose: (id: string): Promise<Incident> => ipcRenderer.invoke('incidents:diagnose', id),
    validate: (id: string): Promise<Incident> => ipcRenderer.invoke('incidents:validate', id),
    apply: (id: string): Promise<Incident> => ipcRenderer.invoke('incidents:apply', id),
    rollback: (id: string): Promise<Incident> => ipcRenderer.invoke('incidents:rollback', id),
    cancel: (id: string): Promise<void> => ipcRenderer.invoke('incidents:cancel', id),
    dismiss: (id: string): Promise<void> => ipcRenderer.invoke('incidents:dismiss', id),
    clear: (): Promise<void> => ipcRenderer.invoke('incidents:clear'),
    simulate: (output: string): Promise<void> => ipcRenderer.invoke('incidents:simulate', output),
    onChanged: (handler: (incidents: Incident[]) => void) => subscribe('incidents:changed', handler)
  }
}

export type AutonexApi = typeof api

contextBridge.exposeInMainWorld('autonex', api)
