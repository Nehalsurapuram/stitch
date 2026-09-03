import { runCommand } from './shell'

/**
 * Thin wrapper over the git CLI. Only the operations the repair pipeline needs:
 * enough to know whether sandboxing is possible, and to create/destroy the
 * throwaway worktree a candidate patch is validated in.
 */

async function git(root: string, args: string, timeoutMs = 30_000): Promise<{ ok: boolean; out: string }> {
  const result = await runCommand(`git ${args}`, { cwd: root, timeoutMs })
  return { ok: result.exitCode === 0, out: result.output.trim() }
}

export async function isGitRepo(root: string): Promise<boolean> {
  const { ok, out } = await git(root, 'rev-parse --is-inside-work-tree')
  return ok && out === 'true'
}

export async function currentBranch(root: string): Promise<string | null> {
  const { ok, out } = await git(root, 'rev-parse --abbrev-ref HEAD')
  return ok && out && out !== 'HEAD' ? out : null
}

export async function headCommit(root: string): Promise<string | null> {
  const { ok, out } = await git(root, 'rev-parse HEAD')
  return ok ? out : null
}

/** Files with uncommitted changes, workspace-relative with POSIX separators. */
export async function dirtyFiles(root: string): Promise<string[]> {
  const { ok, out } = await git(root, 'status --porcelain')
  if (!ok || !out) return []
  return out
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

export async function addWorktree(root: string, path: string, commit: string): Promise<string | null> {
  // --detach keeps the sandbox off any branch, so it can never be checked out
  // or pushed by accident, and never blocks a branch the user is working on.
  const { ok, out } = await git(root, `worktree add --detach "${path}" ${commit}`, 120_000)
  return ok ? null : out || 'git worktree add failed'
}

export async function removeWorktree(root: string, path: string): Promise<void> {
  await git(root, `worktree remove --force "${path}"`, 60_000)
  await git(root, 'worktree prune')
}
