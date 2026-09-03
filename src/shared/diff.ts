import type { FileEdit } from './types'

/**
 * Minimal unified-diff generator.
 *
 * The model returns whole-file replacements rather than a diff, because a diff
 * with hand-computed line numbers is the single most fragile thing an LLM can
 * emit. We reconstruct the diff here so the UI has something to show and the
 * user has something to review before anything is written to disk.
 */

type Op = { kind: 'equal' | 'insert' | 'delete'; line: string }

/** Classic LCS table. Files we patch are small enough that O(n*m) is fine. */
function lcs(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length

  // Trim the common prefix/suffix first so the table stays small on big files.
  let start = 0
  while (start < n && start < m && a[start] === b[start]) start++
  let endA = n
  let endB = m
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const rows = midA.length
  const cols = midB.length

  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const ops: Op[] = []
  for (let k = 0; k < start; k++) ops.push({ kind: 'equal', line: a[k] })

  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (midA[i] === midB[j]) {
      ops.push({ kind: 'equal', line: midA[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'delete', line: midA[i] })
      i++
    } else {
      ops.push({ kind: 'insert', line: midB[j] })
      j++
    }
  }
  while (i < rows) ops.push({ kind: 'delete', line: midA[i++] })
  while (j < cols) ops.push({ kind: 'insert', line: midB[j++] })

  for (let k = endA; k < n; k++) ops.push({ kind: 'equal', line: a[k] })
  return ops
}

function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  // A trailing newline yields a final empty element we do not want as a line.
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Unified diff for one file, with `context` lines of surrounding context. */
export function unifiedDiff(
  path: string,
  before: string | null,
  after: string | null,
  context = 3
): string {
  if (before === after) return ''

  const a = splitLines(before ?? '')
  const b = splitLines(after ?? '')
  const ops = lcs(a, b)

  // Group changes into hunks, merging any that overlap within 2*context lines.
  const changed = ops
    .map((op, index) => (op.kind === 'equal' ? -1 : index))
    .filter((index) => index >= 0)
  if (changed.length === 0) return ''

  const hunks: { start: number; end: number }[] = []
  for (const index of changed) {
    const last = hunks[hunks.length - 1]
    if (last && index - last.end <= context * 2) last.end = index
    else hunks.push({ start: index, end: index })
  }

  const header =
    `--- ${before === null ? '/dev/null' : `a/${path}`}\n` +
    `+++ ${after === null ? '/dev/null' : `b/${path}`}\n`

  let lineA = 0
  let lineB = 0
  // Running line numbers per op index, needed for the @@ headers.
  const positions: { a: number; b: number }[] = ops.map((op) => {
    const at = { a: lineA, b: lineB }
    if (op.kind !== 'insert') lineA++
    if (op.kind !== 'delete') lineB++
    return at
  })

  let out = header
  for (const hunk of hunks) {
    const from = Math.max(0, hunk.start - context)
    const to = Math.min(ops.length - 1, hunk.end + context)

    let countA = 0
    let countB = 0
    for (let i = from; i <= to; i++) {
      if (ops[i].kind !== 'insert') countA++
      if (ops[i].kind !== 'delete') countB++
    }

    const startA = countA === 0 ? positions[from].a : positions[from].a + 1
    const startB = countB === 0 ? positions[from].b : positions[from].b + 1
    out += `@@ -${startA},${countA} +${startB},${countB} @@\n`
    for (let i = from; i <= to; i++) {
      const op = ops[i]
      const marker = op.kind === 'equal' ? ' ' : op.kind === 'insert' ? '+' : '-'
      out += `${marker}${op.line}\n`
    }
  }
  return out
}

/** Concatenated unified diff for a whole patch. */
export function patchDiff(edits: FileEdit[]): string {
  return edits
    .map((edit) => unifiedDiff(edit.path, edit.before, edit.after))
    .filter(Boolean)
    .join('\n')
}

/** Line counts for the "+N -M" summary in the UI. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}
