import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * Monaco, wired to the workspace. Each open file gets its own model so the
 * undo stack and view state survive tab switches.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(self as any).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

monaco.editor.defineTheme('autonex', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#10131a',
    'editorGutter.background': '#10131a',
    'editorLineNumber.foreground': '#485161',
    'editorLineNumber.activeForeground': '#ffb454',
    'editor.lineHighlightBackground': '#161b24',
    'editorIndentGuide.background1': '#1e2430'
  }
})

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini'
}

export function languageOf(path: string): string {
  return LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
}

interface Props {
  path: string | null
  value: string
  onChange: (text: string) => void
  onSave: () => void
  /** Line to reveal and highlight, e.g. from a stack frame. */
  revealLine?: number
}

export function CodeEditor({ path, value, onChange, onSave, revealLine }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const states = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>())
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!host.current) return
    const instance = monaco.editor.create(host.current, {
      theme: 'autonex',
      automaticLayout: true,
      fontFamily: "'DM Mono', monospace",
      fontSize: 12.5,
      lineHeight: 21,
      minimap: { enabled: true, maxColumn: 70 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      smoothScrolling: true,
      padding: { top: 14 },
      tabSize: 2
    })
    instance.onDidChangeModelContent(() => onChangeRef.current(instance.getValue()))
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current())
    editor.current = instance
    return () => {
      instance.dispose()
      editor.current = null
    }
  }, [])

  // Swap models on tab change, preserving each file's scroll and cursor.
  useEffect(() => {
    const instance = editor.current
    if (!instance) return

    const previous = instance.getModel()
    if (previous) states.current.set(previous.uri.toString(), instance.saveViewState())

    if (!path) {
      instance.setModel(null)
      return
    }

    const uri = monaco.Uri.file(path)
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(value, languageOf(path), uri)
    if (model.getValue() !== value) model.setValue(value)
    instance.setModel(model)
    const saved = states.current.get(uri.toString())
    if (saved) instance.restoreViewState(saved)
    instance.focus()
    // `value` is intentionally not a dependency: typing must not reset the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Keep the model in sync when the file is reloaded from disk elsewhere.
  useEffect(() => {
    const model = editor.current?.getModel()
    if (model && model.getValue() !== value) model.setValue(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    if (!revealLine || !editor.current) return
    editor.current.revealLineInCenter(revealLine)
    editor.current.setPosition({ lineNumber: revealLine, column: 1 })
  }, [revealLine, path])

  return <div className="monaco-host" ref={host} />
}

/** Dispose the model backing a closed tab so memory does not grow forever. */
export function disposeModel(path: string): void {
  monaco.editor.getModel(monaco.Uri.file(path))?.dispose()
}
