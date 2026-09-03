import type { AppliedRecord, FileEdit } from '../../shared/types'
import { IpcError } from '../../shared/types'
import { deleteWorkspaceFile, tryRead, writeWorkspaceFile } from '../workspace'

/**
 * Apply stage.
 *
 * Applying is only allowed to happen after a snapshot of every affected file
 * exists, and the snapshot is what rollback restores. If any write fails
 * partway through, the writes already made are undone before the error is
 * reported - a half-applied patch is worse than no patch.
 */

async function snapshot(edits: FileEdit[]): Promise<AppliedRecord['snapshot']> {
  const entries: AppliedRecord['snapshot'] = []
  for (const edit of edits) {
    entries.push({ path: edit.path, before: await tryRead(edit.path) })
  }
  return entries
}

async function restore(entries: AppliedRecord['snapshot']): Promise<void> {
  for (const entry of entries) {
    if (entry.before === null) await deleteWorkspaceFile(entry.path)
    else await writeWorkspaceFile(entry.path, entry.before)
  }
}

/**
 * Refuse to apply if a file changed on disk since the patch was generated.
 * The patch contains whole-file content, so writing it over an edit the user
 * made in the meantime would silently discard their work.
 */
async function assertUnchanged(edits: FileEdit[]): Promise<void> {
  for (const edit of edits) {
    const current = await tryRead(edit.path)
    if (current !== edit.before) {
      throw new IpcError(
        `${edit.path} changed on disk after this patch was generated. Re-diagnose before applying.`,
        'STALE_PATCH'
      )
    }
  }
}

export async function applyPatch(edits: FileEdit[]): Promise<AppliedRecord> {
  if (edits.length === 0) throw new IpcError('This patch has no changes to apply.', 'EMPTY_PATCH')
  await assertUnchanged(edits)

  const entries = await snapshot(edits)
  const written: FileEdit[] = []

  try {
    for (const edit of edits) {
      if (edit.after === null) await deleteWorkspaceFile(edit.path)
      else await writeWorkspaceFile(edit.path, edit.after)
      written.push(edit)
    }
  } catch (error) {
    // Undo the partial application before surfacing the failure.
    await restore(entries.filter((entry) => written.some((edit) => edit.path === entry.path)))
    throw new IpcError(
      `Applying the patch failed and the workspace was restored: ${(error as Error).message}`,
      'APPLY_FAILED'
    )
  }

  return { at: Date.now(), snapshot: entries }
}

export async function rollbackPatch(record: AppliedRecord): Promise<void> {
  await restore(record.snapshot)
}
