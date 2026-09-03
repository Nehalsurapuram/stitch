import { readdir, readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep, basename, isAbsolute } from 'node:path'
import type { FSWatcher } from 'chokidar'
import type { DirEntry, FileContent, SaveResult, WatchEvent, Workspace } from '../shared/types'
import { IpcError } from '../shared/types'
import { currentBranch, isGitRepo } from './git'

/** Directories never listed, watched, or offered to the model as context. */
export const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.venv',
  '__pycache__',
  '.autonex'
])

let root: string | null = null
let watcher: FSWatcher | null = null

export function getRoot(): string {
  if (!root) throw new IpcError('No workspace is open', 'NO_WORKSPACE')
  return root
}

export function hasWorkspace(): boolean {
  return root !== null
}

/**
 * Resolve a path that came from the renderer or from the model, and refuse
 * anything that escapes the workspace. Every write in this app goes through
 * here - it is the only thing standing between a hallucinated "../../.." and
 * the user's home directory.
 */
export function safeResolve(pathish: string): string {
  const base = getRoot()
  const absolute = resolve(base, pathish)
  const rel = relative(base, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new IpcError(`Path escapes the workspace: ${pathish}`, 'PATH_ESCAPE')
  }
  return absolute
}

/** Workspace-relative path with POSIX separators, the form used everywhere. */
export function toRelative(absolute: string): string {
  return relative(getRoot(), absolute).split(sep).join('/')
}

export async function openWorkspace(path: string): Promise<Workspace> {
  const info = await stat(path)
  if (!info.isDirectory()) throw new IpcError('Not a directory', 'NOT_A_DIRECTORY')
  root = resolve(path)
  return {
    root,
    name: basename(root),
    isGitRepo: await isGitRepo(root),
    branch: await currentBranch(root)
  }
}

export async function listDirectory(path?: string): Promise<DirEntry[]> {
  const target = path ? safeResolve(path) : getRoot()
  const entries = await readdir(target, { withFileTypes: true })
  return entries
    .filter((entry) => !IGNORED.has(entry.name))
    .map((entry) => ({
      path: join(target, entry.name),
      name: entry.name,
      isDirectory: entry.isDirectory()
    }))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

export async function readWorkspaceFile(path: string): Promise<FileContent> {
  const target = safeResolve(path)
  const [text, info] = await Promise.all([readFile(target, 'utf8'), stat(target)])
  return { path: target, text, mtimeMs: info.mtimeMs }
}

export async function writeWorkspaceFile(path: string, text: string): Promise<SaveResult> {
  const target = safeResolve(path)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, text, 'utf8')
  const info = await stat(target)
  return { path: target, mtimeMs: info.mtimeMs }
}

export async function deleteWorkspaceFile(path: string): Promise<void> {
  await rm(safeResolve(path), { force: true })
}

/** Read a file if it exists, returning null instead of throwing. */
export async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(safeResolve(path), 'utf8')
  } catch {
    return null
  }
}

/** Every source file under the workspace, relative and POSIX-separated. */
export async function listAllFiles(limit = 4000): Promise<string[]> {
  const found: string[] = []
  const queue: string[] = [getRoot()]
  while (queue.length && found.length < limit) {
    const dir = queue.shift()!
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else found.push(toRelative(full))
    }
  }
  return found
}

export async function watchWorkspace(onEvent: (event: WatchEvent) => void): Promise<void> {
  await stopWatching()
  // chokidar 5 is ESM-only, so it cannot be required from the CJS main bundle.
  const { watch: chokidarWatch } = await import('chokidar')
  watcher = chokidarWatch(getRoot(), {
    ignoreInitial: true,
    ignored: (path: string) => path.split(sep).some((segment) => IGNORED.has(segment))
  })
  watcher
    .on('add', (path) => onEvent({ type: 'add', path }))
    .on('addDir', (path) => onEvent({ type: 'addDir', path }))
    .on('unlink', (path) => onEvent({ type: 'unlink', path }))
    .on('unlinkDir', (path) => onEvent({ type: 'unlinkDir', path }))
    .on('change', (path, info) => onEvent({ type: 'change', path, mtimeMs: info?.mtimeMs ?? Date.now() }))
}

export async function stopWatching(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
  }
}
