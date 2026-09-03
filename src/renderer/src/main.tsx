import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type FileItem = { name: string; type: 'file' | 'folder'; language?: string }
type RepairStage = 'detected' | 'diagnosed' | 'validating' | 'validated' | 'applied' | 'rolled-back'

const files: FileItem[] = [
  { name: 'src', type: 'folder' },
  { name: 'components', type: 'folder' },
  { name: 'App.tsx', type: 'file', language: 'TSX' },
  { name: 'main.tsx', type: 'file', language: 'TSX' },
  { name: 'styles.css', type: 'file', language: 'CSS' },
  { name: 'package.json', type: 'file', language: 'JSON' },
  { name: 'README.md', type: 'file', language: 'MD' }
]

const starterCode = `import { useState } from 'react'

export function App() {
  const [ready, setReady] = useState(true)

  return (
    <main className="workspace">
      <header className="workspace__header">
        <span className="eyebrow">STITCH_ / EDITOR</span>
        <h1>Build something clear.</h1>
        <p>Small tools, sharp edges, zero ceremony.</p>
      </header>

      <button onClick={() => setReady(!ready)}>
        {ready ? 'Workspace ready' : 'Wake workspace'}
      </button>
    </main>
  )
}`

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>
}

function App() {
  const [activeFile, setActiveFile] = useState('App.tsx')
  const [code, setCode] = useState(starterCode)
  const [panelOpen, setPanelOpen] = useState(true)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [activeTool, setActiveTool] = useState('Explorer')
  const [expanded, setExpanded] = useState<string[]>(['src'])
  const [repairOpen, setRepairOpen] = useState(true)
  const [repairStage, setRepairStage] = useState<RepairStage>('detected')
  const [repairLog, setRepairLog] = useState('Runtime error detected in App.tsx:12')

  function diagnoseFailure() {
    setRepairStage('diagnosed')
    setRepairLog('Diagnosis complete: state update is reading a stale closure.')
  }

  function validatePatch() {
    setRepairStage('validating')
    setRepairLog('Running isolated validation in a temporary workspace...')
    window.setTimeout(() => {
      setRepairStage('validated')
      setRepairLog('Validation passed: 14 checks green, no filesystem changes made.')
    }, 900)
  }

  function applyPatch() {
    setCode(code.replace('const [ready, setReady] = useState(true)', 'const [ready, setReady] = useState(true)\n  // patched: event reads current state'))
    setRepairStage('applied')
    setRepairLog('Patch applied safely. Snapshot saved for instant rollback.')
    setSaved(false)
  }

  function rollbackPatch() {
    setCode(starterCode)
    setRepairStage('rolled-back')
    setRepairLog('Rollback complete. Original workspace restored.')
    setSaved(false)
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        setSaved(true)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setPanelOpen((open) => !open)
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setPaletteOpen(true)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function selectFile(name: string) {
    setActiveFile(name)
    if (name === 'App.tsx') setCode(starterCode)
    else setCode(`// ${name}\n\nexport default function ${name.replace(/\\W/g, '')}() {\n  return null\n}`)
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">S</span><span>stitch_</span></div>
        <div className="breadcrumbs"><span>stitch_</span><span>/</span><strong>{activeFile}</strong></div>
        <div className="title-actions"><button title="Command palette" onClick={() => setPaletteOpen(true)}><Icon>⌘</Icon></button><button title="More actions"><Icon>•••</Icon></button><span className="avatar">N</span></div>
      </header>

      <div className="body-grid">
        <aside className="activitybar">
          <button className={`activity ${activeTool === 'Explorer' ? 'active' : ''}`} title="Explorer" onClick={() => setActiveTool('Explorer')}><Icon>▤</Icon></button>
          <button className={`activity ${activeTool === 'Search' ? 'active' : ''}`} title="Search" onClick={() => setActiveTool('Search')}><Icon>⌕</Icon></button>
          <button className={`activity ${activeTool === 'Source Control' ? 'active' : ''}`} title="Source control" onClick={() => setActiveTool('Source Control')}><Icon>⑂</Icon><span className="badge">2</span></button>
          <button className={`activity ${activeTool === 'Extensions' ? 'active' : ''}`} title="Extensions" onClick={() => setActiveTool('Extensions')}><Icon>⊞</Icon></button>
          <div className="activity-spacer" />
          <button className={`activity ${activeTool === 'Settings' ? 'active' : ''}`} title="Settings" onClick={() => setActiveTool('Settings')}><Icon>⚙</Icon></button>
        </aside>

        <aside className="explorer">
          <div className="pane-heading"><span>{activeTool.toUpperCase()}</span><button title="New file"><Icon>＋</Icon></button></div>
          {activeTool === 'Explorer' ? <><button className="workspace-name" onClick={() => setExpanded((items) => items.includes('root') ? items.filter((item) => item !== 'root') : [...items, 'root'])}><Icon>{expanded.includes('root') ? '⌄' : '›'}</Icon> STITCH_</button>
          {expanded.includes('root') && <div className="tree">
            {files.map((file) => <button key={file.name} className={`tree-row ${activeFile === file.name ? 'selected' : ''} ${file.type}`} onClick={() => file.type === 'file' ? selectFile(file.name) : setExpanded((items) => items.includes(file.name) ? items.filter((item) => item !== file.name) : [...items, file.name])}><Icon>{file.type === 'folder' ? expanded.includes(file.name) ? '▾' : '▸' : file.language === 'TSX' ? '◈' : file.language === 'CSS' ? '#' : file.language === 'JSON' ? '{}' : 'M'}</Icon><span>{file.name}</span>{file.name === 'App.tsx' && <span className="dot" />}</button>)}
          </div>}</> : <div className="tool-empty"><strong>{activeTool}</strong><p>{activeTool === 'Search' ? 'Search across your workspace' : 'Nothing to show yet'}</p></div>}
          {activeTool === 'Explorer' && <div className="outline"><div className="pane-heading"><span>OUTLINE</span><Icon>⌄</Icon></div><p>App</p><p>starterCode</p><p>selectFile</p></div>}
        </aside>

        <main className="editor-area">
          <div className="tabs"><button className="tab active"><span className="file-icon">◈</span>{activeFile}<span className="unsaved">{saved ? '' : '●'}</span><span className="close">×</span></button><button className="tab-add">＋</button><div className="editor-actions"><span className="branch">⑂ main</span><button onClick={() => setRepairOpen(!repairOpen)} className="repair-button"><Icon>✦</Icon>Repair</button><button onClick={() => setSaved(true)} className={saved ? 'saved' : ''}><Icon>⇩</Icon>{saved ? 'Saved' : 'Save'}</button></div></div>
          <div className="editor-toolbar"><span>src</span><span className="chevron">›</span><strong>{activeFile}</strong><div className="toolbar-right"><span>Spaces: 2</span><span>UTF-8</span><span>TSX</span></div></div>
          {repairOpen && <aside className="repair-center">
            <div className="repair-header"><div><span className="repair-eyebrow"><span className="pulse-dot" /> FAILURE RESPONSE</span><h2>Repair center</h2></div><button onClick={() => setRepairOpen(false)} title="Close repair center">×</button></div>
            <div className="repair-status"><span className={`status-orb ${repairStage}`} /> <div><strong>{repairStage === 'detected' ? 'Failure detected' : repairStage === 'diagnosed' ? 'Diagnosis ready' : repairStage === 'validating' ? 'Validating patch' : repairStage === 'validated' ? 'Patch validated' : repairStage === 'applied' ? 'Patch applied' : 'Workspace restored'}</strong><p>{repairLog}</p></div></div>
            <div className="repair-steps"><span className={repairStage !== 'detected' ? 'complete' : 'current'}>01 <b>Detect</b></span><span className={repairStage === 'diagnosed' || repairStage === 'validating' || repairStage === 'validated' || repairStage === 'applied' ? 'complete' : ''}>02 <b>Diagnose</b></span><span className={repairStage === 'validated' || repairStage === 'applied' ? 'complete' : ''}>03 <b>Validate</b></span><span className={repairStage === 'applied' || repairStage === 'rolled-back' ? 'complete' : ''}>04 <b>Apply</b></span></div>
            <div className="repair-section"><div className="section-label">ROOT CAUSE <span>confidence 96%</span></div><p className="cause">A stale closure inside the click handler reads the previous value of <code>ready</code>.</p></div>
            <div className="repair-section"><div className="section-label">PROPOSED PATCH <span>1 change</span></div><div className="patch-diff"><div className="diff-line removed">−  const handleReady = () =&gt; setReady(!ready)</div><div className="diff-line added">+  const handleReady = () =&gt; setReady((value) =&gt; !value)</div></div></div>
            <div className="repair-section"><div className="section-label">ISOLATED VALIDATION</div><div className="checks"><span className={repairStage === 'validated' || repairStage === 'applied' ? 'pass' : ''}>✓ Unit tests <b>14 / 14</b></span><span className={repairStage === 'validated' || repairStage === 'applied' ? 'pass' : ''}>✓ Type check <b>clean</b></span><span className={repairStage === 'validated' || repairStage === 'applied' ? 'pass' : ''}>✓ Snapshot <b>unchanged</b></span></div></div>
            <div className="repair-actions">{repairStage === 'detected' && <button className="primary-action" onClick={diagnoseFailure}>Diagnose failure <span>→</span></button>}{repairStage === 'diagnosed' && <button className="primary-action" onClick={validatePatch}>Validate in isolation <span>→</span></button>}{repairStage === 'validating' && <button className="primary-action" disabled>Validating <span className="spinner">◌</span></button>}{repairStage === 'validated' && <><button className="primary-action" onClick={applyPatch}>Apply patch <span>→</span></button><button className="secondary-action" onClick={rollbackPatch}>Rollback</button></>}{repairStage === 'applied' && <button className="secondary-action" onClick={rollbackPatch}>Rollback applied patch</button>}{repairStage === 'rolled-back' && <button className="primary-action" onClick={diagnoseFailure}>Reopen diagnosis <span>→</span></button>}</div>
          </aside>}
          <section className="code-wrap">
            <div className="line-numbers">{code.split('\\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div>
            <textarea aria-label="Code editor" spellCheck={false} value={code} onChange={(event) => { setCode(event.target.value); setSaved(false) }} />
            <div className="minimap">{code.split('\\n').slice(0, 22).map((line, index) => <i key={index} style={{ width: `${Math.max(12, Math.min(92, line.length * 2.1))}%` }} />)}</div>
          </section>
          <div className={`bottom-panel ${panelOpen ? 'open' : 'closed'}`}><div className="panel-tabs"><button className="active">PROBLEMS <span>0</span></button><button>OUTPUT</button><button>TERMINAL</button><button>DEBUG CONSOLE</button><div className="panel-controls"><span>zsh</span><button onClick={() => setPanelOpen(!panelOpen)} title="Toggle panel">{panelOpen ? '⌄' : '⌃'}</button></div></div>{panelOpen && <div className="terminal-content"><span className="prompt">~/stitch_</span><span className="command">$ npm run dev</span><p>ready - local editor session active</p></div>}</div>
        </main>
      </div>
      <footer className="statusbar"><span>⑂ main*</span><span>↻ 0</span><span className="status-spacer" /><span>Ln {code.split('\\n').length}, Col 1</span><span>Spaces: 2</span><span>UTF-8</span><span>TSX</span><span className="live">● Ready</span></footer>
      {paletteOpen && <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}><div className="palette" onClick={(event) => event.stopPropagation()}><div className="palette-input"><Icon>⌕</Icon><input autoFocus placeholder="Type a command..." /><kbd>esc</kbd></div><button onClick={() => { setPaletteOpen(false); setPanelOpen(!panelOpen) }}><span>Toggle Panel</span><kbd>⌘ J</kbd></button><button onClick={() => { setPaletteOpen(false); setSaved(true) }}><span>Save File</span><kbd>⌘ S</kbd></button><button onClick={() => setPaletteOpen(false)}><span>Close Command Palette</span><kbd>esc</kbd></button></div></div>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
