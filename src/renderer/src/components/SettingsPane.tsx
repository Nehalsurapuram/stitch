import { useEffect, useState } from 'react'
import type { AutonexSettings, DetectorKind, SafeSettings } from '@shared/types'
import { ipcMessage, useStore } from '../store'

/**
 * Settings drive the whole pipeline: which detectors are live, which commands
 * count as verification, and how much of detect -> apply runs unattended.
 */

const DETECTOR_LABEL: Record<DetectorKind, string> = {
  process: 'Run/test process exits non-zero',
  diagnostics: 'Typecheck / lint after save',
  logfile: 'Watched log file',
  crash: 'Dev process crashes'
}

export function SettingsPane(): React.JSX.Element {
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const notify = useStore((state) => state.notify)
  const [draft, setDraft] = useState<SafeSettings | null>(settings)
  const [apiKey, setApiKey] = useState('')

  useEffect(() => setDraft(settings), [settings])

  if (!draft) return <div className="tool-empty">Loading settings…</div>

  async function save(patch: Partial<AutonexSettings>): Promise<void> {
    try {
      const next = await window.autonex.settings.update(patch)
      setSettings(next)
    } catch (error) {
      notify(ipcMessage(error))
    }
  }

  /** Update local draft immediately, persist on blur, so typing stays smooth. */
  function edit(patch: Partial<SafeSettings>): void {
    setDraft({ ...draft!, ...patch })
  }

  return (
    <div className="settings-pane">
      <section>
        <h3>Model</h3>
        <label>
          <span>Anthropic API key</span>
          <input
            type="password"
            placeholder={draft.hasApiKey ? '•••••••• (saved)' : 'sk-ant-...'}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onBlur={() => {
              if (!apiKey.trim()) return
              void save({ apiKey: apiKey.trim() })
              setApiKey('')
            }}
          />
        </label>
        <label>
          <span>Model</span>
          <input
            value={draft.model}
            onChange={(event) => edit({ model: event.target.value })}
            onBlur={() => void save({ model: draft.model })}
          />
        </label>
        <label>
          <span>Context files sent per diagnosis</span>
          <input
            type="number"
            min={1}
            max={30}
            value={draft.maxContextFiles}
            onChange={(event) => edit({ maxContextFiles: Number(event.target.value) })}
            onBlur={() => void save({ maxContextFiles: draft.maxContextFiles })}
          />
        </label>
      </section>

      <section>
        <h3>Commands</h3>
        {(['run', 'test', 'typecheck', 'lint'] as const).map((key) => (
          <label key={key}>
            <span>{key}</span>
            <input
              value={draft.commands[key]}
              placeholder="disabled"
              onChange={(event) => edit({ commands: { ...draft.commands, [key]: event.target.value } })}
              onBlur={() => void save({ commands: draft.commands })}
            />
          </label>
        ))}
      </section>

      <section>
        <h3>Verification</h3>
        <p className="hint">
          Run inside a throwaway git worktree to decide whether a patch is safe. One command per line; all
          must pass.
        </p>
        <textarea
          rows={4}
          value={draft.verifySteps.join('\n')}
          onChange={(event) => edit({ verifySteps: event.target.value.split('\n') })}
          onBlur={() => void save({ verifySteps: draft.verifySteps.filter((step) => step.trim()) })}
        />
      </section>

      <section>
        <h3>Detectors</h3>
        {(Object.keys(DETECTOR_LABEL) as DetectorKind[]).map((kind) => (
          <label key={kind} className="check-row">
            <input
              type="checkbox"
              checked={draft.detectors[kind]}
              onChange={(event) =>
                void save({ detectors: { ...draft.detectors, [kind]: event.target.checked } })
              }
            />
            <span>{DETECTOR_LABEL[kind]}</span>
          </label>
        ))}
        <label>
          <span>Log file to tail</span>
          <input
            value={draft.logFile}
            placeholder="C:\path\to\app.log"
            onChange={(event) => edit({ logFile: event.target.value })}
            onBlur={() => void save({ logFile: draft.logFile })}
          />
        </label>
        <label>
          <span>Log error pattern (regex)</span>
          <input
            value={draft.logPattern}
            onChange={(event) => edit({ logPattern: event.target.value })}
            onBlur={() => void save({ logPattern: draft.logPattern })}
          />
        </label>
      </section>

      <section>
        <h3>Automation</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.autoDiagnose}
            onChange={(event) => void save({ autoDiagnose: event.target.checked })}
          />
          <span>Diagnose automatically when a failure is detected</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.autoValidate}
            onChange={(event) => void save({ autoValidate: event.target.checked })}
          />
          <span>Validate automatically once a patch exists</span>
        </label>
        <label className="check-row danger">
          <input
            type="checkbox"
            checked={draft.autoApply}
            onChange={(event) => void save({ autoApply: event.target.checked })}
          />
          <span>Apply automatically once validation passes</span>
        </label>
        <p className="hint">
          Auto-apply writes to your working tree without asking. Every apply still snapshots the files it
          touches, so a one-click rollback is always available.
        </p>
      </section>
    </div>
  )
}
