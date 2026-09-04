/**
 * Seed content for the browser demo's virtual workspace.
 *
 * The project is deliberately tiny and deliberately broken: `summarize` reads
 * `note.tags.join` on an optional field, which is what the simulated test run
 * trips over and what the canned diagnosis fixes. Keeping the bug real means
 * the demo exercises the same explorer -> incident -> diff -> apply path the
 * desktop app does, instead of replaying a screenshot.
 */

export const DEMO_ROOT = '/demo/notes-api'

/** Absolute path -> file text. Directories are implied by the path segments. */
export const DEMO_FILES: Record<string, string> = {
  [DEMO_ROOT + '/README.md']: [
    '# notes-api',
    '',
    'A very small notes service, used here as the sample workspace for the',
    'stitch_ browser demo.',
    '',
    'Press **Test** in the title bar to run the suite. It fails, which opens an',
    'incident in the repair center on the left.',
    ''
  ].join('\n'),

  [DEMO_ROOT + '/package.json']: [
    '{',
    '  "name": "notes-api",',
    '  "version": "1.0.0",',
    '  "type": "module",',
    '  "scripts": {',
    '    "dev": "node src/index.ts",',
    '    "test": "vitest run",',
    '    "typecheck": "tsc --noEmit"',
    '  }',
    '}',
    ''
  ].join('\n'),

  [DEMO_ROOT + '/src/index.ts']: [
    "import { add, all, summarize } from './notes'",
    "import { averageLength } from './stats'",
    '',
    "add({ id: '1', title: 'Buy milk', body: '2%, not skim', tags: ['errands'] })",
    "add({ id: '2', title: 'Ship the demo', body: 'vercel, then tell abhay' })",
    '',
    'for (const note of all()) {',
    '  console.log(summarize(note))',
    '}',
    '',
    "console.log('average body length', averageLength(all()))",
    ''
  ].join('
'),

  [DEMO_ROOT + '/src/notes.ts']: [
    'export interface Note {',
    '  id: string',
    '  title: string',
    '  body: string',
    '  tags?: string[]',
    '}',
    '',
    'const notes: Note[] = []',
    '',
    'export function add(note: Note): Note {',
    '  notes.push(note)',
    '  return note',
    '}',
    '',
    'export function all(): Note[] {',
    '  return notes.slice()',
    '}',
    '',
    '/** One-line summary used by the list endpoint. */',
    'export function summarize(note: Note): string {',
    "  const tags = note.tags.join(', ')",
    "  return note.title + ' [' + tags + ']'",
    '}',
    ''
  ].join('\n'),

  [DEMO_ROOT + '/src/stats.ts']: [
    "import type { Note } from './notes'",
    '',
    '/** Mean body length across the collection, 0 when there is nothing to average. */',
    'export function averageLength(notes: Note[]): number {',
    '  if (notes.length === 0) return 0',
    '  const total = notes.reduce((sum, note) => sum + note.body.length, 0)',
    '  return Math.round(total / notes.length)',
    '}',
    ''
  ].join('\n'),

  [DEMO_ROOT + '/test/notes.test.ts']: [
    "import { describe, expect, it } from 'vitest'",
    "import { summarize } from '../src/notes'",
    '',
    "describe('summarize', () => {",
    "  it('renders tags when present', () => {",
    "    const line = summarize({ id: '1', title: 'Buy milk', body: '2%', tags: ['errands'] })",
    "    expect(line).toBe('Buy milk [errands]')",
    '  })',
    '',
    "  it('tolerates a note without tags', () => {",
    "    const line = summarize({ id: '2', title: 'Ship the demo', body: 'vercel' })",
    "    expect(line).toBe('Ship the demo []')",
    '  })',
    '})',
    ''
  ].join('\n')
}

/** The buggy line, and the patched version the demo diagnosis proposes. */
export const NOTES_BUG = "  const tags = note.tags.join(', ')"
export const NOTES_FIX = "  const tags = (note.tags ?? []).join(', ')"

/** Simulated `vitest run` output, ending in the failure that opens an incident. */
export const TEST_OUTPUT: string[] = [
  '> notes-api@1.0.0 test',
  '> vitest run',
  '',
  ' RUN  v3.2.4 ' + DEMO_ROOT,
  '',
  ' \u2713 test/notes.test.ts > summarize > renders tags when present  3ms',
  ' \u2717 test/notes.test.ts > summarize > tolerates a note without tags',
  '',
  '\u23AF\u23AF\u23AF Failed Tests 1 \u23AF\u23AF\u23AF',
  '',
  ' FAIL  test/notes.test.ts > summarize > tolerates a note without tags',
  "TypeError: Cannot read properties of undefined (reading 'join')",
  ' \u276F src/notes.ts:21:22',
  '     19| /** One-line summary used by the list endpoint. */',
  '     20| export function summarize(note: Note): string {',
  "     21|   const tags = note.tags.join(', ')",
  '       |                          ^',
  '     22|   return note.title + \' [\' + tags + \']\'',
  ' \u276F test/notes.test.ts:11:18',
  '',
  ' Test Files  1 failed (1)',
  '      Tests  1 failed | 1 passed (2)',
  '',
  'exit code 1',
  ''
]

/** Simulated `npm run dev` output for the run channel. */
export const RUN_OUTPUT: string[] = [
  '> notes-api@1.0.0 dev',
  '> node src/index.ts',
  '',
  'Buy milk [errands]',
  'notes-api listening on http://localhost:3000',
  'ready in 412ms',
  ''
]

/** Simulated typecheck output for the diagnostics channel. */
export const DIAGNOSTICS_OUTPUT: string[] = [
  '> notes-api@1.0.0 typecheck',
  '> tsc --noEmit',
  '',
  'No errors found.',
  ''
]
