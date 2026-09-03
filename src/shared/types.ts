/**
 * Types shared by main, preload and renderer.
 * This file is the contract for everything that crosses the IPC boundary.
 */

export interface DirEntry {
  /** Absolute path on disk. */
  path: string
  /** Basename, e.g. "index.ts". */
  name: string
  isDirectory: boolean
}

export interface Workspace {
  /** Absolute path of the opened folder. */
  root: string
  /** Basename of the root, shown in the explorer header. */
  name: string
}

export interface FileContent {
  path: string
  text: string
  /** Milliseconds since epoch, used to detect edits made outside the editor. */
  mtimeMs: number
}

export interface SaveResult {
  path: string
  mtimeMs: number
}

/** Emitted by the main-process watcher when the workspace changes on disk. */
export type WatchEvent =
  | { type: 'add' | 'addDir' | 'unlink' | 'unlinkDir'; path: string }
  | { type: 'change'; path: string; mtimeMs: number }

/** Anything that can go wrong in a privileged operation, surfaced to the UI. */
export class IpcError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message)
    this.name = 'IpcError'
  }
}
