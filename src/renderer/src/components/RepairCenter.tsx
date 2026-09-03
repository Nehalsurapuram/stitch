import { useState } from 'react'
import type { Incident, IncidentStage, ValidationStep } from '@shared/types'
import { diffStats } from '@shared/diff'
import { ipcMessage, useStore } from '../store'

/**
 * The repair center: one incident at a time, showing exactly where it is in
 * detect -> diagnose -> validate -> apply, what the patch does, and what the
 * sandbox said about it. Nothing here is decorative - every stage badge
 * reflects real state from the main process.
 */

const STAGE_LABEL: Record<IncidentStage, string> = {
  detected: 'Failure detected',
  diagnosing: 'Diagnosing',
  diagnosed: 'Patch proposed',
  validating: 'Validating in isolation',
  validated: 'Patch validated',
  rejected: 'Patch rejected',
  applying: 'Applying',
  applied: 'Patch applied',
  'rolled-back': 'Rolled back',
  failed: 'Pipeline failed'
}

const STEPS = ['Detect', 'Diagnose', 'Validate', 'Apply'] as const

/** How far through the four visible steps a stage is. */
function progress(stage: IncidentStage): number {
  switch (stage) {
    case 'detected':
      return 0
    case 'diagnosing':
      return 1
    case 'diagnosed':
    case 'validating':
      return 2
    case 'validated':
    case 'applying':
      return 3
    case 'applied':
      return 4
    default:
      return -1
  }
}

function DiffView({ diff }: { diff: string }): React.JSX.Element {
  return (
    <div className="patch-diff">
      {diff.split('\n').map((line, index) => {
        const kind = line.startsWith('+++') || line.startsWith('---')
          ? 'file'
          : line.startsWith('@@')
            ? 'hunk'
            : line.startsWith('+')
              ? 'added'
              : line.startsWith('-')
                ? 'removed'
                : 'context'
        return (
          <div key={index} className={`diff-line ${kind}`}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

function StepResult({ step }: { step: ValidationStep }): React.JSX.Element {
  const [open, setOpen] = useState(!step.ok)
  return (
    <div className={`check ${step.ok ? 'pass' : 'fail'}`}>
      <button onClick={() => setOpen(!open)}>
        <span>{step.ok ? '✓' : '✕'}</span>
        <code>{step.command}</code>
        <b>{step.ok ? `${(step.durationMs / 1000).toFixed(1)}s` : `exit ${step.exitCode}`}</b>
      </button>
      {open && step.output && <pre className="check-output">{step.output.slice(-3000)}</pre>}
    </div>
  )
}

interface Props {
  incident: Incident
  onClose: () => void
  onOpenFrame: (file: string, line?: number) => void
}

export function RepairCenter({ incident, onClose, onOpenFrame }: Props): React.JSX.Element {
  const notify = useStore((state) => state.notify)
  const busy = useStore((state) => state.busy)
  const setBusy = useStore((state) => state.setBusy)
  const [showLog, setShowLog] = useState(false)

  const stage = incident.stage
  const done = progress(stage)
  const inFlight = ['diagnosing', 'validating', 'applying'].includes(stage)

  async function act(label: string, run: () => Promise<unknown>): Promise<void> {
    setBusy(label)
    notify(null)
    try {
      await run()
    } catch (error) {
      notify(ipcMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const diagnosis = incident.diagnosis
  const stats = diagnosis ? diffStats(diagnosis.diff) : null

  return (
    <aside className="repair-center">
      <div className="repair-header">
        <div>
          <span className="repair-eyebrow">
            <span className={`pulse-dot ${stage}`} /> FAILURE RESPONSE
          </span>
          <h2>Repair center</h2>
        </div>
        <button onClick={onClose} title="Close repair center">
          ×
        </button>
      </div>

      <div className="repair-status">
        <span className={`status-orb ${stage}`} />
        <div>
          <strong>{STAGE_LABEL[stage]}</strong>
          <p>{incident.signal.message}</p>
          <p className="dim">
            {incident.signal.detector} · {incident.signal.source}
            {incident.occurrences > 1 && ` · seen ${incident.occurrences}×`}
          </p>
        </div>
      </div>

      <div className="repair-steps">
        {STEPS.map((label, index) => (
          <span
            key={label}
            className={done > index ? 'complete' : done === index ? 'current' : done === -1 ? 'halted' : ''}
          >
            0{index + 1} <b>{label}</b>
          </span>
        ))}
      </div>

      {incident.signal.frames.length > 0 && (
        <div className="repair-section">
          <div className="section-label">
            LOCATIONS <span>{incident.signal.frames.length}</span>
          </div>
          <div className="frames">
            {incident.signal.frames.map((frame, index) => (
              <button key={index} onClick={() => onOpenFrame(frame.file, frame.line)}>
                {frame.file}
                {frame.line ? `:${frame.line}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {diagnosis && (
        <>
          <div className="repair-section">
            <div className="section-label">
              ROOT CAUSE <span>confidence {(diagnosis.confidence * 100).toFixed(0)}%</span>
            </div>
            <p className="cause">{diagnosis.rootCause}</p>
            <p className="cause dim">{diagnosis.explanation}</p>
          </div>

          {diagnosis.diff ? (
            <div className="repair-section">
              <div className="section-label">
                PROPOSED PATCH
                <span>
                  {diagnosis.edits.length} file(s) · +{stats?.added} −{stats?.removed}
                </span>
              </div>
              <DiffView diff={diagnosis.diff} />
            </div>
          ) : (
            <div className="repair-section">
              <div className="section-label">PROPOSED PATCH</div>
              <p className="cause dim">No changes were proposed for this failure.</p>
            </div>
          )}
        </>
      )}

      {incident.validation && (
        <div className="repair-section">
          <div className="section-label">
            ISOLATED VALIDATION
            <span>
              {incident.validation.error
                ? 'sandbox error'
                : `${incident.validation.baseCommit.slice(0, 7)} · ${(incident.validation.durationMs / 1000).toFixed(1)}s`}
            </span>
          </div>
          {incident.validation.error && <p className="cause warn">{incident.validation.error}</p>}
          <div className="checks">
            {incident.validation.steps.map((step) => (
              <StepResult key={step.command} step={step} />
            ))}
          </div>
        </div>
      )}

      {incident.error && (
        <div className="repair-section">
          <div className="section-label">ERROR</div>
          <p className="cause warn">{incident.error}</p>
        </div>
      )}

      <div className="repair-section">
        <button className="link-button" onClick={() => setShowLog(!showLog)}>
          {showLog ? 'Hide' : 'Show'} pipeline log ({incident.log.length})
        </button>
        {showLog && (
          <pre className="pipeline-log">
            {incident.log
              .map(
                (entry) =>
                  `${new Date(entry.at).toLocaleTimeString()}  ${entry.level.toUpperCase().padEnd(5)} ${entry.text}`
              )
              .join('\n')}
          </pre>
        )}
      </div>

      <div className="repair-actions">
        {inFlight ? (
          <>
            <button className="primary-action" disabled>
              {STAGE_LABEL[stage]} <span className="spinner">◌</span>
            </button>
            <button
              className="secondary-action"
              onClick={() => void window.autonex.incidents.cancel(incident.id)}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {(stage === 'detected' || stage === 'failed' || stage === 'rejected') && (
              <button
                className="primary-action"
                disabled={!!busy}
                onClick={() => void act('diagnose', () => window.autonex.incidents.diagnose(incident.id))}
              >
                {stage === 'detected' ? 'Diagnose failure' : 'Re-diagnose'} <span>→</span>
              </button>
            )}
            {stage === 'diagnosed' && (
              <button
                className="primary-action"
                disabled={!!busy}
                onClick={() => void act('validate', () => window.autonex.incidents.validate(incident.id))}
              >
                Validate in isolation <span>→</span>
              </button>
            )}
            {stage === 'validated' && (
              <button
                className="primary-action"
                disabled={!!busy}
                onClick={() => void act('apply', () => window.autonex.incidents.apply(incident.id))}
              >
                Apply patch <span>→</span>
              </button>
            )}
            {stage === 'applied' && (
              <button
                className="secondary-action"
                disabled={!!busy}
                onClick={() => void act('rollback', () => window.autonex.incidents.rollback(incident.id))}
              >
                Roll back
              </button>
            )}
            {stage === 'rolled-back' && (
              <button
                className="primary-action"
                disabled={!!busy}
                onClick={() => void act('diagnose', () => window.autonex.incidents.diagnose(incident.id))}
              >
                Try again <span>→</span>
              </button>
            )}
            <button
              className="secondary-action"
              onClick={() => void window.autonex.incidents.dismiss(incident.id)}
            >
              Dismiss
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
