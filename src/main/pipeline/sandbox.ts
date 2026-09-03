import { mkdtemp, writeFile, mkdir, rm, cp, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import type { FileEdit, ValidationResult, ValidationStep } from '../../shared/types'
import { addWorktree, dirtyFiles, headCommit, removeWorktree } from '../git'
import { getRoot, tryRead } from '../workspace'
import { runCommand } from '../shell'
import { getSettings } from '../settings'

/**
 * Validation stage.
 *
 * A candidate patch is never run against the user's working tree. Instead we
 * create a detached git worktree at HEAD in the system temp directory, replay
 * the user's uncommitted changes into it so the sandbox matches what they are
 * actually looking at, apply the patch on top, and run the configured verify
 * steps there. Whatever happens, the worktree is removed afterwards.
 */

const STEP_TIMEOUT_MS = 10 * 60_000

/** Reject a path the model produced that would write outside the sandbox. */
function safeJoin(base: string, relativePath: string): string {
  const target = resolve(base, relativePath)
  const rel = relative(base, target)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Patch tried to write outside the sandbox: ${relativePath}`)
  }
  return target
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Dependencies are not in git, so a fresh worktree has no node_modules and
 * every verify step would fail on "command not found". Link the real one in.
 */
async function linkDependencies(root: string, sandbox: string): Promise<string | null> {
  const source = join(root, 'node_modules')
  if (!(await exists(source))) return null
  const target = join(sandbox, 'node_modules')
  try {
    // A junction is instant and needs no elevation on Windows; symlink dir
    // is the equivalent elsewhere.
    const { symlink } = await import('node:fs/promises')
    await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    return 'linked node_modules from the workspace'
  } catch {
    try {
      await cp(source, target, { recursive: true })
      return 'copied node_modules into the sandbox'
    } catch (error) {
      return `could not provide node_modules (${(error as Error).message})`
    }
  }
}

/** Copy the user's uncommitted changes into the sandbox, minus the patched files. */
async function replayWorkingTree(root: string, sandbox: string, skip: Set<string>): Promise<number> {
  const dirty = await dirtyFiles(root)
  let copied = 0
  for (const path of dirty) {
    if (skip.has(path)) continue
    if (path.split('/').some((segment) => segment === 'node_modules' || segment === '.git')) continue
    const content = await tryRead(path)
    if (content === null) continue // deleted locally; leave the committed version
    const target = safeJoin(sandbox, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    copied++
  }
  return copied
}

async function applyEdits(sandbox: string, edits: FileEdit[]): Promise<void> {
  for (const edit of edits) {
    const target = safeJoin(sandbox, edit.path)
    if (edit.after === null) {
      await rm(target, { force: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, edit.after, 'utf8')
  }
}

export interface ValidateOptions {
  onLog?: (text: string) => void
  signal?: AbortSignal
}

export async function validatePatch(
  edits: FileEdit[],
  options: ValidateOptions = {}
): Promise<ValidationResult> {
  const root = getRoot()
  const settings = getSettings()
  const startedAt = Date.now()
  const steps: ValidationStep[] = []
  const log = options.onLog ?? ((): void => {})

  const base = await headCommit(root)
  if (!base) {
    return {
      ok: false,
      steps,
      sandboxPath: '',
      baseCommit: '',
      durationMs: Date.now() - startedAt,
      error:
        'Isolated validation needs a git repository with at least one commit. Commit the workspace, then retry.'
    }
  }

  const verifySteps = settings.verifySteps.map((command) => command.trim()).filter(Boolean)
  if (verifySteps.length === 0) {
    return {
      ok: false,
      steps,
      sandboxPath: '',
      baseCommit: base,
      durationMs: Date.now() - startedAt,
      error: 'No verify steps are configured, so a patch cannot be proven safe. Add one in Settings.'
    }
  }

  const sandbox = await mkdtemp(join(tmpdir(), 'autonex-sandbox-'))
  // mkdtemp creates the directory; git worktree add insists on creating it.
  await rm(sandbox, { recursive: true, force: true })

  try {
    log(`Creating sandbox worktree at ${base.slice(0, 8)}`)
    const failure = await addWorktree(root, sandbox, base)
    if (failure) {
      return {
        ok: false,
        steps,
        sandboxPath: sandbox,
        baseCommit: base,
        durationMs: Date.now() - startedAt,
        error: failure
      }
    }

    const patched = new Set(edits.map((edit) => edit.path))
    const replayed = await replayWorkingTree(root, sandbox, patched)
    if (replayed) log(`Replayed ${replayed} uncommitted file(s) into the sandbox`)

    const deps = await linkDependencies(root, sandbox)
    if (deps) log(deps)

    await applyEdits(sandbox, edits)
    log(`Applied ${edits.length} file change(s) to the sandbox`)

    let ok = true
    for (const command of verifySteps) {
      if (options.signal?.aborted) {
        ok = false
        break
      }
      log(`$ ${command}`)
      const result = await runCommand(command, {
        cwd: sandbox,
        timeoutMs: STEP_TIMEOUT_MS,
        signal: options.signal
      })
      const stepOk = result.exitCode === 0 && !result.timedOut
      steps.push({
        name: command.split(/\s+/).slice(0, 3).join(' '),
        command,
        exitCode: result.exitCode,
        output: result.output.slice(-8_000),
        ok: stepOk,
        durationMs: result.durationMs
      })
      log(stepOk ? `PASS ${command}` : `FAIL ${command} (exit ${result.exitCode})`)
      if (!stepOk) {
        ok = false
        break // no point running the rest once one step has failed
      }
    }

    return { ok, steps, sandboxPath: sandbox, baseCommit: base, durationMs: Date.now() - startedAt }
  } finally {
    // The sandbox is disposable by design; never leave one behind.
    await removeWorktree(root, sandbox)
    await rm(sandbox, { recursive: true, force: true }).catch(() => {})
  }
}
