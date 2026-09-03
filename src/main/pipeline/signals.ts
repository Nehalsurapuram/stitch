import { createHash } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import type { DetectorKind, FailureSignal, StackFrame } from '../../shared/types'

/**
 * Turns raw process output into a structured failure signal: a one-line
 * headline, the file/line references worth showing the model, and a signature
 * that stays stable across reruns so the same failure does not open a new
 * incident every time a watcher fires.
 */

/** Patterns that carry a file reference, in rough order of specificity. */
const FRAME_PATTERNS: RegExp[] = [
  // Node stack frame: "at fn (/abs/path/file.ts:12:3)" or "at /abs/file.js:1:2"
  /at (?:[^\s(]+ )?\(?([A-Za-z]:[\\/][^\s():]+|\/[^\s():]+|[.\w][^\s():]*\.[a-zA-Z]{1,4}):(\d+):(\d+)\)?/g,
  // tsc / eslint / rustc / gcc: "src/a.ts(12,3):" and "src/a.ts:12:3"
  /([A-Za-z]:[\\/][^\s():]+|[\w./\\-]+\.[a-zA-Z]{1,4})\((\d+),(\d+)\)/g,
  /([A-Za-z]:[\\/][^\s():]+|[\w./\\-]+\.[a-zA-Z]{1,4}):(\d+):(\d+)/g,
  // Python traceback: 'File "/abs/path.py", line 12'
  /File "([^"]+)", line (\d+)/g
]

/** Lines that read like the actual error, used to pick a headline. */
const HEADLINE_PATTERNS = [
  /^\s*(?:[A-Z]\w*Error|Error|error TS\d+|error:|ERROR|FATAL|Uncaught|Unhandled)\b.*$/m,
  /^.*\berror\b.*$/im,
  /^.*\b(?:failed|failing|FAIL)\b.*$/im
]

const NOISE = /^\s*(?:npm ERR!|at Object\.|at Module\.|at node:internal)/

function normalizeFile(file: string, root: string): string | null {
  const cleaned = file.replace(/^file:\/\/\/?/, '').replace(/^\(+/, '')
  const absolute = isAbsolute(cleaned) ? cleaned : null
  if (absolute) {
    const rel = relative(root, absolute)
    if (rel.startsWith('..') || isAbsolute(rel)) return null // outside the workspace
    return rel.split(sep).join('/')
  }
  // Already relative - keep it if it does not climb out.
  if (cleaned.startsWith('..')) return null
  return cleaned.split(/[\\/]/).join('/').replace(/^\.\//, '')
}

/** Distinct in-workspace file references, most relevant first. */
export function extractFrames(output: string, root: string, limit = 6): StackFrame[] {
  const seen = new Map<string, StackFrame>()
  for (const pattern of FRAME_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(output)) !== null) {
      const file = normalizeFile(match[1], root)
      if (!file) continue
      // Never point the model at its own dependencies.
      if (file.includes('node_modules/') || file.startsWith('out/') || file.startsWith('dist/')) continue
      const key = `${file}:${match[2] ?? ''}`
      if (seen.has(key)) continue
      seen.set(key, {
        file,
        line: match[2] ? Number(match[2]) : undefined,
        column: match[3] ? Number(match[3]) : undefined
      })
      if (seen.size >= limit) return [...seen.values()]
    }
  }
  return [...seen.values()]
}

export function extractHeadline(output: string, fallback: string): string {
  const lines = output.split('\n').filter((line) => line.trim() && !NOISE.test(line))
  const haystack = lines.join('\n')
  for (const pattern of HEADLINE_PATTERNS) {
    const match = pattern.exec(haystack)
    if (match) return match[0].trim().slice(0, 300)
  }
  return (lines[lines.length - 1] ?? fallback).trim().slice(0, 300)
}

/**
 * A signature that ignores the volatile parts of an error (timestamps, pids,
 * absolute paths, memory addresses) so reruns collapse onto one incident.
 */
export function signatureOf(detector: DetectorKind, headline: string, frames: StackFrame[]): string {
  const stable = headline
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<time>')
    .replace(/0x[0-9a-f]+/gi, '<addr>')
    // Volatile numbers (durations, ports, pids) but not identifier suffixes -
    // "TS2322" must stay distinct from "TS2345", while "1234ms" must not.
    .replace(/(?<![A-Za-z0-9])\d{3,}/g, '<n>')
    .replace(/[A-Za-z]:[\\/][^\s:]+/g, '<path>')
    .toLowerCase()
  const location = frames[0] ? `${frames[0].file}:${frames[0].line ?? ''}` : ''
  return createHash('sha1').update(`${detector}|${stable}|${location}`).digest('hex').slice(0, 16)
}

/** Keep the tail of the output - the error is almost always at the bottom. */
export function trimOutput(output: string, maxChars = 12_000): string {
  return output.length <= maxChars ? output : `... [truncated]\n${output.slice(-maxChars)}`
}

export function buildSignal(input: {
  detector: DetectorKind
  source: string
  output: string
  root: string
  exitCode?: number | null
  fallbackMessage?: string
}): FailureSignal {
  const raw = trimOutput(input.output)
  const message = extractHeadline(raw, input.fallbackMessage ?? `${input.source} failed`)
  const frames = extractFrames(raw, input.root)
  return {
    detector: input.detector,
    source: input.source,
    message,
    raw,
    exitCode: input.exitCode ?? null,
    frames,
    signature: signatureOf(input.detector, message, frames),
    at: Date.now()
  }
}
