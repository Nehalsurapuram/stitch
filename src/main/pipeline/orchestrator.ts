import type { FailureSignal, Incident } from '../../shared/types'
import { IpcError } from '../../shared/types'
import { getSettings } from '../settings'
import { incidents } from './incidents'
import { detectors } from './detectors'
import { diagnose } from './diagnose'
import { validatePatch } from './sandbox'
import { applyPatch, rollbackPatch } from './apply'

/**
 * Drives an incident through detect -> diagnose -> validate -> apply, honouring
 * the automation level in settings. Every transition is explicit and every
 * stage is individually re-runnable from the UI, because the interesting case
 * is the one where the automatic path stops and a human takes over.
 */

/** In-flight work per incident, so a stage cannot be started twice. */
const running = new Map<string, AbortController>()

function busy(id: string): boolean {
  return running.has(id)
}

export function onFailure(signal: FailureSignal): void {
  const { incident, isNew } = incidents.record(signal)
  if (!isNew) return

  const settings = getSettings()
  if (settings.autoDiagnose && settings.apiKey.trim()) {
    void runDiagnose(incident.id).catch(() => {
      /* stage records its own failure */
    })
  }
}

export async function runDiagnose(id: string): Promise<Incident> {
  const incident = incidents.get(id)
  if (busy(id)) throw new IpcError('This incident is already being worked on.', 'BUSY')

  const controller = new AbortController()
  running.set(id, controller)
  incidents.setStage(id, 'diagnosing', 'Diagnosing failure')

  try {
    const diagnosis = await diagnose(incident.signal)
    if (diagnosis.edits.length === 0) {
      incidents.update(id, { diagnosis })
      incidents.setStage(
        id,
        'rejected',
        `No patch proposed (confidence ${(diagnosis.confidence * 100).toFixed(0)}%): ${diagnosis.rootCause}`
      )
      return incidents.get(id)
    }

    incidents.update(id, { diagnosis })
    incidents.setStage(
      id,
      'diagnosed',
      `Patch ready: ${diagnosis.edits.length} file(s), confidence ${(diagnosis.confidence * 100).toFixed(0)}%`
    )

    if (getSettings().autoValidate) {
      running.delete(id)
      return await runValidate(id)
    }
    return incidents.get(id)
  } catch (error) {
    const message = (error as Error).message
    incidents.append(id, 'error', `Diagnosis failed: ${message}`)
    incidents.update(id, { error: message })
    incidents.setStage(id, 'failed')
    throw error
  } finally {
    running.delete(id)
  }
}

export async function runValidate(id: string): Promise<Incident> {
  const incident = incidents.get(id)
  if (!incident.diagnosis) throw new IpcError('Diagnose the failure first.', 'NO_DIAGNOSIS')
  if (busy(id)) throw new IpcError('This incident is already being worked on.', 'BUSY')

  const controller = new AbortController()
  running.set(id, controller)
  incidents.setStage(id, 'validating', 'Validating patch in an isolated worktree')

  try {
    const validation = await validatePatch(incident.diagnosis.edits, {
      signal: controller.signal,
      onLog: (text) => incidents.append(id, 'info', text)
    })
    incidents.update(id, { validation })

    if (!validation.ok) {
      incidents.setStage(
        id,
        'rejected',
        validation.error ?? `Validation failed: ${validation.steps.find((step) => !step.ok)?.command}`
      )
      return incidents.get(id)
    }

    incidents.setStage(id, 'validated', `Validation passed in ${(validation.durationMs / 1000).toFixed(1)}s`)

    if (getSettings().autoApply) {
      running.delete(id)
      return await runApply(id)
    }
    return incidents.get(id)
  } catch (error) {
    const message = (error as Error).message
    incidents.append(id, 'error', `Validation error: ${message}`)
    incidents.update(id, { error: message })
    incidents.setStage(id, 'failed')
    throw error
  } finally {
    running.delete(id)
  }
}

export async function runApply(id: string): Promise<Incident> {
  const incident = incidents.get(id)
  if (!incident.diagnosis) throw new IpcError('Nothing to apply.', 'NO_DIAGNOSIS')
  if (!incident.validation?.ok) {
    throw new IpcError('This patch has not passed isolated validation.', 'NOT_VALIDATED')
  }
  if (busy(id)) throw new IpcError('This incident is already being worked on.', 'BUSY')

  running.set(id, new AbortController())
  incidents.setStage(id, 'applying', 'Applying patch to the workspace')

  try {
    const applied = await applyPatch(incident.diagnosis.edits)
    incidents.update(id, { applied })
    incidents.setStage(id, 'applied', `Applied to ${applied.snapshot.length} file(s); rollback available`)
    return incidents.get(id)
  } catch (error) {
    const message = (error as Error).message
    incidents.append(id, 'error', `Apply failed: ${message}`)
    incidents.update(id, { error: message })
    // The workspace is intact either way - applyPatch restores on failure.
    incidents.setStage(id, incident.validation.ok ? 'validated' : 'failed')
    throw error
  } finally {
    running.delete(id)
  }
}

export async function runRollback(id: string): Promise<Incident> {
  const incident = incidents.get(id)
  if (!incident.applied) throw new IpcError('This patch was never applied.', 'NOT_APPLIED')

  await rollbackPatch(incident.applied)
  incidents.update(id, { applied: undefined })
  incidents.setStage(id, 'rolled-back', 'Workspace restored from the pre-apply snapshot')
  return incidents.get(id)
}

export function cancel(id: string): void {
  running.get(id)?.abort()
}

/** Wire the detectors into the pipeline. Called once at startup. */
export function startPipeline(): void {
  detectors.on('failure', onFailure)
}
