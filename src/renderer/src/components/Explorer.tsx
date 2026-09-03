import { useEffect } from 'react'
import type { DirEntry } from '@shared/types'
import { useStore } from '../store'

interface Props {
  onOpenFile: (path: string) => void
}

const FILE_GLYPHS: Record<string, string> = {
  ts: '◈',
  tsx: '◈',
  js: '◈',
  jsx: '◈',
  json: '{}',
  css: '#',
  md: 'M',
  html: '<>'
}

function glyph(name: string): string {
  return FILE_GLYPHS[name.split('.').pop()?.toLowerCase() ?? ''] ?? '·'
}

function Row({ entry, depth, onOpenFile }: { entry: DirEntry; depth: number; onOpenFile: Props['onOpenFile'] }): React.JSX.Element {
  const expanded = useStore((state) => state.expanded.has(entry.path))
  const children = useStore((state) => state.tree[entry.path])
  const activePath = useStore((state) => state.activePath)
  const dirty = useStore((state) =>
    state.tabs.some((tab) => tab.path === entry.path && tab.text !== tab.saved)
  )
  const toggleExpanded = useStore((state) => state.toggleExpanded)
  const setChildren = useStore((state) => state.setChildren)

  // Directory contents are fetched the first time a folder is opened.
  useEffect(() => {
    if (!entry.isDirectory || !expanded || children) return
    void window.autonex.fs.list(entry.path).then((entries) => setChildren(entry.path, entries))
  }, [entry.isDirectory, entry.path, expanded, children, setChildren])

  return (
    <>
      <button
        className={`tree-row ${entry.isDirectory ? 'folder' : 'file'} ${activePath === entry.path ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => (entry.isDirectory ? toggleExpanded(entry.path) : onOpenFile(entry.path))}
        title={entry.path}
      >
        <span className="icon">{entry.isDirectory ? (expanded ? '▾' : '▸') : glyph(entry.name)}</span>
        <span className="tree-name">{entry.name}</span>
        {dirty && <span className="dot" />}
      </button>
      {entry.isDirectory &&
        expanded &&
        children?.map((child) => (
          <Row key={child.path} entry={child} depth={depth + 1} onOpenFile={onOpenFile} />
        ))}
    </>
  )
}

export function Explorer({ onOpenFile }: Props): React.JSX.Element {
  const workspace = useStore((state) => state.workspace)
  const roots = useStore((state) => (state.workspace ? state.tree[state.workspace.root] : undefined))

  if (!workspace) {
    return (
      <div className="tool-empty">
        <strong>No folder open</strong>
        <p>Open a folder to start detecting failures in it.</p>
        <button className="primary-action" onClick={() => void window.autonex.workspace.pick()}>
          Open folder
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="workspace-name">
        {workspace.name.toUpperCase()}
        {!workspace.isGitRepo && (
          <span className="warn-chip" title="Isolated validation needs a git repository">
            no git
          </span>
        )}
      </div>
      <div className="tree">
        {roots?.map((entry) => <Row key={entry.path} entry={entry} depth={0} onOpenFile={onOpenFile} />)}
      </div>
    </>
  )
}
