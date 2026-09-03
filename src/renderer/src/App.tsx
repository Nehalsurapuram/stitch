import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ipcMessage, useStore } from './store'
import { CodeEditor, disposeModel, languageOf } from './components/CodeEditor'
import { Explorer } from './components/Explorer'
import { IncidentList } from './components/IncidentList'
import { RepairCenter } from './components/RepairCenter'
import { SettingsPane } from './components/SettingsPane'

const PANEL_CHANNELS = ['terminal', 'test', 'diagnostics', 'logfile'] as const

/** The terminal tab a given process channel writes into. */
const CHANNEL_TAB: Record<string, string> = {
  run: 'terminal',
  test: 'test',
  diagnostics: 'diagnostics',
  logfile: 'logfile'
}

export function App(): React.JSX.Element {
  const store = useStore()
  const {
    workspace,
    settings,
    tabs,
    activePath,
    incidents,
    selectedIncident,
    processes,
    output,
    panel,
    view,
    notice
  } = store

  const [repairOpen, setRepairOpen] = useState(true)
  const [revealLine, setRevealLine] = useState<number | undefined>(undefined)
  const outputRef = useRef<HTMLPreElement>(null)

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null
  const incident = incidents.find((candidate) => candidate.id === selectedIncident) ?? null
  const openCount = incidents.filter(
    (candidate) => !['applied', 'rolled-back', 'failed'].includes(candidate.stage)
  ).length

  /* --- open a file ------------------------------------------------ */

  const openFile = useCallback(
    async (pathish: string, line?: number) => {
      try {
        // Always read through main: it normalises the path, so a tab opened
        // from the explorer and one opened from a stack frame are the same tab.
        const file = await window.autonex.fs.read(pathish)
        const existing = useStore.getState().tabs.find((tab) => tab.path === file.path)
        if (existing) store.setActive(file.path)
        else
          store.openTab({
            path: file.path,
            name: file.path.split(/[\\/]/).pop()!,
            text: file.text,
            saved: file.text,
            mtimeMs: file.mtimeMs
          })
        setRevealLine(line)
      } catch (error) {
        store.notify(ipcMessage(error))
      }
    },
    [store]
  )

  /** Stack frames carry workspace-relative paths; main resolves them safely. */
  const openFrame = useCallback((file: string, line?: number) => void openFile(file, line), [openFile])

  const saveActive = useCallback(async () => {
    const tab = useStore.getState().tabs.find((candidate) => candidate.path === useStore.getState().activePath)
    if (!tab || tab.text === tab.saved) return
    try {
      const result = await window.autonex.fs.write(tab.path, tab.text)
      store.markSaved(tab.path, result.mtimeMs)
    } catch (error) {
      store.notify(ipcMessage(error))
    }
  }, [store])

  /* --- subscriptions ---------------------------------------------- */

  useEffect(() => {
    void window.autonex.settings.get().then(store.setSettings)
    void window.autonex.incidents.list().then(store.setIncidents)
    void window.autonex.process.states().then(store.setProcesses)

    const unsubscribe = [
      window.autonex.workspace.onChanged((next) => {
        store.setWorkspace(next)
        void window.autonex.fs.list().then((entries) => store.setChildren(next.root, entries))
      }),
      window.autonex.settings.onChanged(store.setSettings),
      window.autonex.incidents.onChanged(store.setIncidents),
      window.autonex.process.onStates(store.setProcesses),
      window.autonex.process.onOutput(store.appendOutput),
      window.autonex.fs.onEvent((event) => {
        const current = useStore.getState()
        if (!current.workspace) return
        // Refresh the directory the change happened in.
        const parent = event.path.replace(/[\\/][^\\/]+$/, '')
        if (current.tree[parent]) {
          void window.autonex.fs.list(parent).then((entries) => store.setChildren(parent, entries))
        }
        // Pull in external edits to any open file that has no local changes,
        // which is what makes an applied patch or a rollback show up live.
        if (event.type === 'change' && current.tabs.some((tab) => tab.path === event.path)) {
          void window.autonex.fs
            .read(event.path)
            .then((file) => store.refreshTab(file.path, file.text, file.mtimeMs))
            .catch(() => {})
        }
      })
    ]
    return () => unsubscribe.forEach((off) => off())
    // Subscriptions are set up once; store setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* --- shortcuts --------------------------------------------------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveActive()
      }
      if (mod && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        store.setPanel({ open: !useStore.getState().panel.open })
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        setRepairOpen((open) => !open)
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void window.autonex.workspace.pick()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveActive, store])

  /* --- terminal autoscroll ---------------------------------------- */

  useEffect(() => {
    const element = outputRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output, panel.tab])

  const runState = useMemo(
    () => processes.find((state) => state.channel === 'run'),
    [processes]
  )
  const testState = useMemo(
    () => processes.find((state) => state.channel === 'test'),
    [processes]
  )

  async function toggleProcess(channel: 'run' | 'test'): Promise<void> {
    const state = processes.find((candidate) => candidate.channel === channel)
    const command = settings?.commands[channel] ?? ''
    try {
      if (state?.running) await window.autonex.process.stop(channel)
      else {
        store.setPanel({ open: true, tab: CHANNEL_TAB[channel] })
        await window.autonex.process.start(channel, command)
      }
    } catch (error) {
      store.notify(ipcMessage(error))
    }
  }

  const panelText = output[panel.tab === 'terminal' ? 'run' : panel.tab] ?? ''

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <span>autonex</span>
        </div>
        <div className="breadcrumbs">
          <span>{workspace?.name ?? 'no folder'}</span>
          <span>/</span>
          <strong>{activeTab?.name ?? '—'}</strong>
        </div>
        <div className="title-actions">
          <button
            className={runState?.running ? 'running' : ''}
            onClick={() => void toggleProcess('run')}
            disabled={!workspace || !settings?.commands.run}
            title={settings?.commands.run || 'No run command configured'}
          >
            {runState?.running ? '■ Stop' : '▶ Run'}
          </button>
          <button
            className={testState?.running ? 'running' : ''}
            onClick={() => void toggleProcess('test')}
            disabled={!workspace || !settings?.commands.test}
            title={settings?.commands.test || 'No test command configured'}
          >
            {testState?.running ? '■ Stop tests' : '⏵ Test'}
          </button>
          <button
            onClick={() => void window.autonex.process.runDiagnostics()}
            disabled={!workspace}
            title="Run typecheck and lint now"
          >
            ✓ Check
          </button>
        </div>
      </header>

      {notice && (
        <div className="notice">
          <span>{notice}</span>
          <button onClick={() => store.notify(null)}>×</button>
        </div>
      )}

      <div className="body-grid">
        <aside className="activitybar">
          <button
            className={`activity ${view === 'explorer' ? 'active' : ''}`}
            title="Explorer"
            onClick={() => store.setView('explorer')}
          >
            <span className="icon">▤</span>
          </button>
          <button
            className={`activity ${view === 'incidents' ? 'active' : ''}`}
            title="Incidents"
            onClick={() => store.setView('incidents')}
          >
            <span className="icon">✦</span>
            {openCount > 0 && <span className="badge">{openCount}</span>}
          </button>
          <div className="activity-spacer" />
          <button
            className={`activity ${view === 'settings' ? 'active' : ''}`}
            title="Settings"
            onClick={() => store.setView('settings')}
          >
            <span className="icon">⚙</span>
          </button>
        </aside>

        <aside className={`explorer ${view === 'settings' ? 'wide' : ''}`}>
          <div className="pane-heading">
            <span>{view.toUpperCase()}</span>
            {view === 'explorer' && (
              <button title="Open folder" onClick={() => void window.autonex.workspace.pick()}>
                <span className="icon">＋</span>
              </button>
            )}
          </div>
          {view === 'explorer' && <Explorer onOpenFile={(path) => void openFile(path)} />}
          {view === 'incidents' && <IncidentList />}
          {view === 'settings' && <SettingsPane />}
        </aside>

        <main className="editor-area">
          <div className="tabs">
            {tabs.map((tab) => (
              <button
                key={tab.path}
                className={`tab ${tab.path === activePath ? 'active' : ''}`}
                onClick={() => store.setActive(tab.path)}
              >
                <span className="file-icon">◈</span>
                {tab.name}
                {tab.text !== tab.saved && <span className="unsaved">●</span>}
                <span
                  className="close"
                  onClick={(event) => {
                    event.stopPropagation()
                    disposeModel(tab.path)
                    store.closeTab(tab.path)
                  }}
                >
                  ×
                </span>
              </button>
            ))}
            <div className="editor-actions">
              <span className="branch">⑂ {workspace?.branch ?? '—'}</span>
              <button
                className={`repair-button ${openCount ? 'alert' : ''}`}
                onClick={() => setRepairOpen(!repairOpen)}
              >
                <span className="icon">✦</span> Repair {openCount > 0 && `(${openCount})`}
              </button>
              <button
                onClick={() => void saveActive()}
                className={activeTab && activeTab.text === activeTab.saved ? 'saved' : ''}
              >
                <span className="icon">⇩</span>
                {activeTab && activeTab.text === activeTab.saved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          <div className="editor-toolbar">
            <span>{workspace?.name ?? '—'}</span>
            <span className="chevron">›</span>
            <strong>{activeTab?.name ?? 'no file open'}</strong>
            <div className="toolbar-right">
              <span>{activeTab ? languageOf(activeTab.path) : '—'}</span>
              <span>UTF-8</span>
            </div>
          </div>

          {repairOpen && incident && (
            <RepairCenter
              incident={incident}
              onClose={() => setRepairOpen(false)}
              onOpenFrame={openFrame}
            />
          )}

          <section className="code-wrap">
            {activeTab ? (
              <CodeEditor
                path={activeTab.path}
                value={activeTab.text}
                revealLine={revealLine}
                onChange={(text) => store.editTab(activeTab.path, text)}
                onSave={() => void saveActive()}
              />
            ) : (
              <div className="editor-empty">
                <h2>Autonex</h2>
                <p>
                  Open a folder, then start your run or test command. When something fails, the repair
                  center diagnoses it, builds a patch, and proves it in a throwaway git worktree before
                  anything touches your files.
                </p>
                <button className="primary-action" onClick={() => void window.autonex.workspace.pick()}>
                  Open folder <span>→</span>
                </button>
              </div>
            )}
          </section>

          <div className={`bottom-panel ${panel.open ? 'open' : 'closed'}`}>
            <div className="panel-tabs">
              {PANEL_CHANNELS.map((channel) => (
                <button
                  key={channel}
                  className={panel.tab === channel ? 'active' : ''}
                  onClick={() => store.setPanel({ open: true, tab: channel })}
                >
                  {channel.toUpperCase()}
                </button>
              ))}
              <div className="panel-controls">
                <button
                  onClick={() => store.clearOutput(panel.tab === 'terminal' ? 'run' : panel.tab)}
                  title="Clear"
                >
                  ⌫
                </button>
                <button onClick={() => store.setPanel({ open: !panel.open })} title="Toggle panel">
                  {panel.open ? '⌄' : '⌃'}
                </button>
              </div>
            </div>
            {panel.open && (
              <pre className="terminal-content" ref={outputRef}>
                {panelText || 'No output yet.'}
              </pre>
            )}
          </div>
        </main>
      </div>

      <footer className="statusbar">
        <span>⑂ {workspace?.branch ?? 'no repo'}</span>
        <span className={openCount ? 'alert' : ''}>✦ {openCount} open incident(s)</span>
        <span className="status-spacer" />
        {store.busy && <span className="live">{store.busy}…</span>}
        <span>{settings?.hasApiKey ? 'model ready' : 'no api key'}</span>
        <span>{settings?.autoApply ? 'auto-apply ON' : 'manual apply'}</span>
        <span className="live">● {workspace ? 'watching' : 'idle'}</span>
      </footer>
    </div>
  )
}
