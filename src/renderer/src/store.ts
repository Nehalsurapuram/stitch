import { create } from 'zustand'
import type {
  DirEntry,
  Incident,
  ProcessChunk,
  ProcessState,
  SafeSettings,
  Workspace
} from '@shared/types'

export interface Tab {
  /** Absolute path, which is also the tab identity. */
  path: string
  name: string
  text: string
  /** Content as last read from or written to disk, for the dirty check. */
  saved: string
  mtimeMs: number
}

interface State {
  workspace: Workspace | null
  settings: SafeSettings | null

  /** Directory listings by absolute path, filled in lazily as folders open. */
  tree: Record<string, DirEntry[]>
  expanded: Set<string>

  tabs: Tab[]
  activePath: string | null

  incidents: Incident[]
  selectedIncident: string | null

  processes: ProcessState[]
  output: Record<string, string>

  panel: { open: boolean; tab: string }
  view: 'explorer' | 'incidents' | 'settings'
  /** Transient error banner text. */
  notice: string | null
  busy: string | null
}

interface Actions {
  setWorkspace: (workspace: Workspace | null) => void
  setSettings: (settings: SafeSettings) => void

  setChildren: (path: string, entries: DirEntry[]) => void
  toggleExpanded: (path: string) => void

  openTab: (tab: Tab) => void
  closeTab: (path: string) => void
  setActive: (path: string | null) => void
  editTab: (path: string, text: string) => void
  markSaved: (path: string, mtimeMs: number) => void
  /** Reload a tab whose file changed underneath us, when it has no local edits. */
  refreshTab: (path: string, text: string, mtimeMs: number) => void

  setIncidents: (incidents: Incident[]) => void
  selectIncident: (id: string | null) => void

  setProcesses: (states: ProcessState[]) => void
  appendOutput: (chunk: ProcessChunk) => void
  clearOutput: (channel: string) => void

  setPanel: (patch: Partial<State['panel']>) => void
  setView: (view: State['view']) => void
  notify: (text: string | null) => void
  setBusy: (label: string | null) => void
}

/** Cap per-channel terminal scrollback so a chatty dev server cannot grow forever. */
const MAX_OUTPUT = 120_000

export const useStore = create<State & Actions>((set) => ({
  workspace: null,
  settings: null,
  tree: {},
  expanded: new Set<string>(),
  tabs: [],
  activePath: null,
  incidents: [],
  selectedIncident: null,
  processes: [],
  output: {},
  panel: { open: true, tab: 'terminal' },
  view: 'explorer',
  notice: null,
  busy: null,

  setWorkspace: (workspace) => set({ workspace, tree: {}, expanded: new Set(), tabs: [], activePath: null }),
  setSettings: (settings) => set({ settings }),

  setChildren: (path, entries) => set((state) => ({ tree: { ...state.tree, [path]: entries } })),
  toggleExpanded: (path) =>
    set((state) => {
      const next = new Set(state.expanded)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { expanded: next }
    }),

  openTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((candidate) => candidate.path === tab.path)
      if (existing) return { activePath: tab.path }
      return { tabs: [...state.tabs, tab], activePath: tab.path }
    }),

  closeTab: (path) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.path !== path)
      const activePath =
        state.activePath === path ? (tabs[tabs.length - 1]?.path ?? null) : state.activePath
      return { tabs, activePath }
    }),

  setActive: (activePath) => set({ activePath }),

  editTab: (path, text) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, text } : tab))
    })),

  markSaved: (path, mtimeMs) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.path === path ? { ...tab, saved: tab.text, mtimeMs } : tab))
    })),

  refreshTab: (path, text, mtimeMs) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.path === path && tab.text === tab.saved ? { ...tab, text, saved: text, mtimeMs } : tab
      )
    })),

  setIncidents: (incidents) =>
    set((state) => ({
      incidents,
      // Keep a selection pointing at something that still exists.
      selectedIncident:
        state.selectedIncident && incidents.some((incident) => incident.id === state.selectedIncident)
          ? state.selectedIncident
          : (incidents[0]?.id ?? null)
    })),

  selectIncident: (selectedIncident) => set({ selectedIncident }),

  setProcesses: (processes) => set({ processes }),

  appendOutput: (chunk) =>
    set((state) => {
      const previous = state.output[chunk.channel] ?? ''
      const next = previous + chunk.text
      return {
        output: {
          ...state.output,
          [chunk.channel]: next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next
        }
      }
    }),

  clearOutput: (channel) => set((state) => ({ output: { ...state.output, [channel]: '' } })),

  setPanel: (patch) => set((state) => ({ panel: { ...state.panel, ...patch } })),
  setView: (view) => set({ view }),
  notify: (notice) => set({ notice }),
  setBusy: (busy) => set({ busy })
}))

/** Unwrap the "Error invoking remote method ..." wrapper Electron adds. */
export function ipcMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const match = /Error:\s(.*)$/.exec(raw)
  return (match?.[1] ?? raw).trim()
}
