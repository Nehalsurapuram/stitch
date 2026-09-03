/**
 * Types shared by main, preload and renderer.
 * This file is the contract for everything that crosses the IPC boundary.
 */

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

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
  /** True when the root is inside a git work tree (required for sandboxing). */
  isGitRepo: boolean
  /** Current branch name, or null when detached / not a repo. */
  branch: string | null
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

/* ------------------------------------------------------------------ */
/* Failure detection                                                   */
/* ------------------------------------------------------------------ */

/** Where a failure signal came from. */
export type DetectorKind =
  /** A configured run/test command exited non-zero or printed an error. */
  | 'process'
  /** Typecheck or lint run after a save. */
  | 'diagnostics'
  /** A tailed log file matched an error pattern. */
  | 'logfile'
  /** A long-running dev process died unexpectedly. */
  | 'crash'

/** A file/line reference recovered from a stack trace or compiler message. */
export interface StackFrame {
  /** Workspace-relative path, POSIX separators. */
  file: string
  line?: number
  column?: number
}

export interface FailureSignal {
  detector: DetectorKind
  /** Command line, log path, or process label the signal came from. */
  source: string
  /** Single-line headline, shown in the incident list. */
  message: string
  /** Captured output around the failure (bounded). */
  raw: string
  exitCode?: number | null
  frames: StackFrame[]
  /** Stable key used to collapse repeats of the same failure. */
  signature: string
  at: number
}

/* ------------------------------------------------------------------ */
/* Diagnosis and patch                                                 */
/* ------------------------------------------------------------------ */

/** One whole-file replacement. `after: null` means delete the file. */
export interface FileEdit {
  /** Workspace-relative path, POSIX separators. */
  path: string
  /** File content before the patch; null when the patch creates the file. */
  before: string | null
  /** File content after the patch; null when the patch deletes the file. */
  after: string | null
}

export interface Diagnosis {
  rootCause: string
  explanation: string
  /** Model 0-1 confidence in the fix. */
  confidence: number
  edits: FileEdit[]
  /** Unified diff computed locally from `edits`, for display only. */
  diff: string
  model: string
  /** Files the model was shown, for transparency in the UI. */
  contextFiles: string[]
  inputTokens?: number
  outputTokens?: number
}

/* ------------------------------------------------------------------ */
/* Isolated validation                                                 */
/* ------------------------------------------------------------------ */

export interface ValidationStep {
  name: string
  command: string
  exitCode: number | null
  output: string
  ok: boolean
  durationMs: number
}

export interface ValidationResult {
  ok: boolean
  steps: ValidationStep[]
  /** Temp git worktree the steps ran in; removed once validation finishes. */
  sandboxPath: string
  /** Commit the worktree was created at. */
  baseCommit: string
  durationMs: number
  /** Set when the sandbox itself could not be prepared. */
  error?: string
}

/* ------------------------------------------------------------------ */
/* Apply and rollback                                                  */
/* ------------------------------------------------------------------ */

/** Snapshot of every file a patch touched, taken immediately before writing. */
export interface AppliedRecord {
  at: number
  snapshot: { path: string; before: string | null }[]
}

/* ------------------------------------------------------------------ */
/* Incidents                                                           */
/* ------------------------------------------------------------------ */

export type IncidentStage =
  | 'detected'
  | 'diagnosing'
  | 'diagnosed'
  | 'validating'
  | 'validated'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'rolled-back'
  | 'failed'

export interface IncidentLogEntry {
  at: number
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface Incident {
  id: string
  stage: IncidentStage
  /** Bumped each time the same signature is detected again. */
  occurrences: number
  signal: FailureSignal
  diagnosis?: Diagnosis
  validation?: ValidationResult
  applied?: AppliedRecord
  /** Populated when the incident lands in `failed`. */
  error?: string
  log: IncidentLogEntry[]
  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface AutonexSettings {
  /** Anthropic API key. Stored in userData, never sent to the renderer in full. */
  apiKey: string
  model: string
  /** Commands the IDE can launch and watch. Empty string disables one. */
  commands: {
    run: string
    test: string
    typecheck: string
    lint: string
  }
  /** Commands re-run inside the sandbox to decide if a patch is good. */
  verifySteps: string[]
  /** Absolute path of a log file to tail, or "". */
  logFile: string
  /** Regex (source form) that marks a log line as a failure. */
  logPattern: string
  detectors: Record<DetectorKind, boolean>
  /** Run diagnose automatically as soon as a failure is detected. */
  autoDiagnose: boolean
  /** Run sandbox validation automatically once a patch exists. */
  autoValidate: boolean
  /** Apply automatically once validation passes. Off by default. */
  autoApply: boolean
  /** How many workspace files to send to the model as context. */
  maxContextFiles: number
}

/** What the renderer is allowed to see: the key is reduced to a boolean. */
export type SafeSettings = Omit<AutonexSettings, 'apiKey'> & { hasApiKey: boolean }

/* ------------------------------------------------------------------ */
/* Process output                                                      */
/* ------------------------------------------------------------------ */

export interface ProcessChunk {
  /** Which configured command produced this, e.g. "test". */
  channel: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: number
}

export interface ProcessState {
  channel: string
  command: string
  running: boolean
  pid: number | null
  exitCode: number | null
  startedAt: number | null
}

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
