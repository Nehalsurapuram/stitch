import type { IncidentStage } from '@shared/types'
import { useStore } from '../store'

/** Short badge text per stage, kept narrow enough for the sidebar. */
const BADGE: Record<IncidentStage, string> = {
  detected: 'new',
  diagnosing: 'diagnosing',
  diagnosed: 'patch',
  validating: 'validating',
  validated: 'ready',
  rejected: 'rejected',
  applying: 'applying',
  applied: 'applied',
  'rolled-back': 'rolled back',
  failed: 'failed'
}

export function IncidentList(): React.JSX.Element {
  const incidents = useStore((state) => state.incidents)
  const selected = useStore((state) => state.selectedIncident)
  const selectIncident = useStore((state) => state.selectIncident)

  if (incidents.length === 0) {
    return (
      <div className="tool-empty">
        <strong>No incidents</strong>
        <p>
          Failures from your run and test commands, typecheck, watched logs and dev-process crashes appear
          here.
        </p>
      </div>
    )
  }

  return (
    <div className="incident-list">
      {incidents.map((incident) => (
        <button
          key={incident.id}
          className={`incident-row ${incident.id === selected ? 'selected' : ''}`}
          onClick={() => selectIncident(incident.id)}
        >
          <span className="incident-top">
            <span className={`status-orb ${incident.stage}`} />
            <span className={`incident-badge ${incident.stage}`}>{BADGE[incident.stage]}</span>
            <span className="incident-time">{new Date(incident.signal.at).toLocaleTimeString()}</span>
          </span>
          <span className="incident-message">{incident.signal.message}</span>
          <span className="incident-meta">
            {incident.signal.detector}
            {incident.signal.frames[0] ? ` · ${incident.signal.frames[0].file}` : ''}
            {incident.occurrences > 1 ? ` · ${incident.occurrences}×` : ''}
          </span>
        </button>
      ))}
      <button className="link-button clear-all" onClick={() => void window.autonex.incidents.clear()}>
        Clear all
      </button>
    </div>
  )
}
