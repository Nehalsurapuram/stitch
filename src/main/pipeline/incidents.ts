import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { FailureSignal, Incident, IncidentStage } from '../../shared/types'
import { IpcError } from '../../shared/types'

/**
 * In-memory incident store. One incident per distinct failure signature; a
 * repeat of a signature that is still open bumps its occurrence count instead
 * of opening a second one.
 */

const MAX_INCIDENTS = 100

/** Stages where a repeat detection should re-open rather than merge. */
const CLOSED: IncidentStage[] = ['applied', 'rolled-back', 'rejected', 'failed']

class IncidentStore extends EventEmitter {
  private incidents: Incident[] = []

  list(): Incident[] {
    return this.incidents
  }

  get(id: string): Incident {
    const incident = this.incidents.find((candidate) => candidate.id === id)
    if (!incident) throw new IpcError(`Unknown incident ${id}`, 'NO_INCIDENT')
    return incident
  }

  find(id: string): Incident | undefined {
    return this.incidents.find((candidate) => candidate.id === id)
  }

  /** Record a signal. Returns the incident and whether it is newly opened. */
  record(signal: FailureSignal): { incident: Incident; isNew: boolean } {
    const existing = this.incidents.find(
      (candidate) => candidate.signal.signature === signal.signature && !CLOSED.includes(candidate.stage)
    )
    if (existing) {
      existing.occurrences += 1
      existing.signal = signal
      existing.updatedAt = Date.now()
      this.append(existing.id, 'info', `Failure seen again (${existing.occurrences}x)`)
      return { incident: existing, isNew: false }
    }

    const incident: Incident = {
      id: randomUUID(),
      stage: 'detected',
      occurrences: 1,
      signal,
      log: [{ at: Date.now(), level: 'error', text: `Detected via ${signal.detector}: ${signal.message}` }],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    this.incidents.unshift(incident)
    // Drop the oldest closed incidents once the list gets long.
    if (this.incidents.length > MAX_INCIDENTS) {
      this.incidents = this.incidents.slice(0, MAX_INCIDENTS)
    }
    this.emit('changed', this.incidents)
    return { incident, isNew: true }
  }

  update(id: string, patch: Partial<Incident>): Incident {
    const incident = this.get(id)
    Object.assign(incident, patch, { updatedAt: Date.now() })
    this.emit('changed', this.incidents)
    return incident
  }

  setStage(id: string, stage: IncidentStage, note?: string): Incident {
    const incident = this.get(id)
    incident.stage = stage
    incident.updatedAt = Date.now()
    if (note) incident.log.push({ at: Date.now(), level: 'info', text: note })
    this.emit('changed', this.incidents)
    return incident
  }

  append(id: string, level: 'info' | 'warn' | 'error', text: string): void {
    const incident = this.find(id)
    if (!incident) return
    incident.log.push({ at: Date.now(), level, text })
    incident.updatedAt = Date.now()
    this.emit('changed', this.incidents)
  }

  dismiss(id: string): void {
    this.incidents = this.incidents.filter((candidate) => candidate.id !== id)
    this.emit('changed', this.incidents)
  }

  clear(): void {
    this.incidents = []
    this.emit('changed', this.incidents)
  }
}

export const incidents = new IncidentStore()
