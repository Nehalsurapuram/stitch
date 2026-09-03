import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type FileItem = { name: string; type: 'file' | 'folder'; language?: string }

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
        <span className="eyebrow">AUTONEX / EDITOR</span>
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

  function selectFile(name: string) {
    setActiveFile(name)
    if (name === 'App.tsx') setCode(starterCode)
    else setCode(`// ${name}\n\nexport default function ${name.replace(/\\W/g, '')}() {\n  return null\n}`)
  }

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark">A</span><span>Autonex</span></div>
        <div className="breadcrumbs"><span>autonex</span><span>/</span><strong>{activeFile}</strong></div>
        <div className="title-actions"><button title="Command palette" onClick={() => setPaletteOpen(true)}><Icon>⌘</Icon></button><button title="More actions"><Icon>•••</Icon></button><span className="avatar">N</span></div>
      </header>

      <div className="body-grid">
        <aside className="activitybar">
          <button className="activity active" title="Explorer"><Icon>▤</Icon></button>
          <button className="activity" title="Search"><Icon>⌕</Icon></button>
          <button className="activity" title="Source control"><Icon>⑂</Icon><span className="badge">2</span></button>
          <button className="activity" title="Extensions"><Icon>⊞</Icon></button>
          <div className="activity-spacer" />
          <button className="activity" title="Settings"><Icon>⚙</Icon></button>
        </aside>

        <aside className="explorer">
          <div className="pane-heading"><span>EXPLORER</span><button title="New file"><Icon>＋</Icon></button></div>
          <div className="workspace-name"><Icon>⌄</Icon> AUTONEX</div>
          <div className="tree">
            {files.map((file) => <button key={file.name} className={`tree-row ${activeFile === file.name ? 'selected' : ''} ${file.type}`} onClick={() => file.type === 'file' && selectFile(file.name)}><Icon>{file.type === 'folder' ? '▸' : file.language === 'TSX' ? '◈' : file.language === 'CSS' ? '#' : file.language === 'JSON' ? '{}' : 'M'}</Icon><span>{file.name}</span>{file.name === 'App.tsx' && <span className="dot" />}</button>)}
          </div>
          <div className="outline"><div className="pane-heading"><span>OUTLINE</span><Icon>⌄</Icon></div><p>App</p><p>starterCode</p><p>selectFile</p></div>
        </aside>

        <main className="editor-area">
          <div className="tabs"><button className="tab active"><span className="file-icon">◈</span>{activeFile}<span className="unsaved">{saved ? '' : '●'}</span><span className="close">×</span></button><button className="tab-add">＋</button><div className="editor-actions"><span className="branch">⑂ main</span><button onClick={() => setSaved(true)} className={saved ? 'saved' : ''}><Icon>⇩</Icon>{saved ? 'Saved' : 'Save'}</button></div></div>
          <div className="editor-toolbar"><span>src</span><span className="chevron">›</span><strong>{activeFile}</strong><div className="toolbar-right"><span>Spaces: 2</span><span>UTF-8</span><span>TSX</span></div></div>
          <section className="code-wrap">
            <div className="line-numbers">{code.split('\\n').map((_, index) => <span key={index}>{index + 1}</span>)}</div>
            <textarea aria-label="Code editor" spellCheck={false} value={code} onChange={(event) => { setCode(event.target.value); setSaved(false) }} />
            <div className="minimap">{code.split('\\n').slice(0, 22).map((line, index) => <i key={index} style={{ width: `${Math.max(12, Math.min(92, line.length * 2.1))}%` }} />)}</div>
          </section>
          <div className={`bottom-panel ${panelOpen ? 'open' : 'closed'}`}><div className="panel-tabs"><button className="active">PROBLEMS <span>0</span></button><button>OUTPUT</button><button>TERMINAL</button><button>DEBUG CONSOLE</button><div className="panel-controls"><span>zsh</span><button onClick={() => setPanelOpen(!panelOpen)} title="Toggle panel">{panelOpen ? '⌄' : '⌃'}</button></div></div>{panelOpen && <div className="terminal-content"><span className="prompt">~/autonex</span><span className="command">$ npm run dev</span><p>ready - local editor session active</p></div>}</div>
        </main>
      </div>
      <footer className="statusbar"><span>⑂ main*</span><span>↻ 0</span><span className="status-spacer" /><span>Ln {code.split('\\n').length}, Col 1</span><span>Spaces: 2</span><span>UTF-8</span><span>TSX</span><span className="live">● Ready</span></footer>
      {paletteOpen && <div className="palette-backdrop" onClick={() => setPaletteOpen(false)}><div className="palette" onClick={(event) => event.stopPropagation()}><div className="palette-input"><Icon>⌕</Icon><input autoFocus placeholder="Type a command..." /><kbd>esc</kbd></div><button onClick={() => { setPaletteOpen(false); setPanelOpen(!panelOpen) }}><span>Toggle Panel</span><kbd>⌘ J</kbd></button><button onClick={() => { setPaletteOpen(false); setSaved(true) }}><span>Save File</span><kbd>⌘ S</kbd></button><button onClick={() => setPaletteOpen(false)}><span>Close Command Palette</span><kbd>esc</kbd></button></div></div>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
