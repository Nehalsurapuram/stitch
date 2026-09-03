import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Diagnosis, FailureSignal } from '../../shared/types'
import { IpcError } from '../../shared/types'
import { patchDiff } from '../../shared/diff'
import { getSettings } from '../settings'
import { listAllFiles, tryRead } from '../workspace'

/**
 * Diagnosis stage: give Claude the failure output plus the files the stack
 * trace pointed at, and get back a root cause and a candidate patch.
 *
 * The model returns whole-file replacements, not a diff. Asking a model to
 * compute unified-diff line numbers is the classic way to get a patch that
 * looks right and refuses to apply; we take full contents and compute the diff
 * ourselves in shared/diff.ts.
 */

const PatchSchema = z.object({
  root_cause: z.string().describe('One sentence naming the actual defect, not the symptom.'),
  explanation: z
    .string()
    .describe('Two to four sentences: why this causes the observed failure, and why the fix is correct.'),
  confidence: z.number().min(0).max(1).describe('Confidence that this patch fixes the failure.'),
  files: z
    .array(
      z.object({
        path: z.string().describe('Workspace-relative path with forward slashes.'),
        action: z.enum(['modify', 'create', 'delete']),
        content: z
          .string()
          .describe('Complete new content of the file. Empty string when action is "delete".')
      })
    )
    .describe('Every file the fix touches, with its complete post-fix content.')
})

const SYSTEM = `You are the repair engine inside an IDE. You are given a software failure and the
source files involved. Produce the smallest correct patch that fixes the underlying defect.

Rules:
- Fix the root cause, not the symptom. Never silence an error with a try/catch, a type
  assertion, a skipped test, or a loosened check unless that genuinely is the correct fix.
- Return the COMPLETE new content of every file you change. Never abbreviate, never write
  placeholder comments like "... rest of file unchanged". Content is written to disk verbatim.
- Preserve the file's existing style, indentation, quoting and import conventions exactly.
- Only touch files you were shown, unless creating a new file is genuinely required.
- Change as little as possible. If a one-line fix is correct, make a one-line fix.
- If the provided context is not enough to identify the defect, say so in root_cause, set
  confidence below 0.3, and return an empty files array rather than guessing.`

function client(): Anthropic {
  const { apiKey } = getSettings()
  if (!apiKey.trim()) {
    throw new IpcError('No Anthropic API key configured. Add one in Settings.', 'NO_API_KEY')
  }
  return new Anthropic({ apiKey })
}

/**
 * Pick the files worth sending: everything the stack trace named, then any
 * file whose basename appears in the error text, up to the configured budget.
 */
async function gatherContext(signal: FailureSignal, limit: number): Promise<Map<string, string>> {
  const picked = new Map<string, string>()

  const add = async (path: string): Promise<void> => {
    if (picked.size >= limit || picked.has(path)) return
    const text = await tryRead(path)
    // Skip anything huge - a 500KB bundle crowds out the file that matters.
    if (text !== null && text.length < 120_000) picked.set(path, text)
  }

  for (const frame of signal.frames) await add(frame.file)

  if (picked.size < limit) {
    const all = await listAllFiles()
    const mentioned = all.filter((path) => {
      const name = path.split('/').pop()!
      return name.length > 3 && signal.raw.includes(name)
    })
    for (const path of mentioned) await add(path)
  }

  return picked
}

function fence(path: string, content: string): string {
  return `<file path="${path}">\n${content}\n</file>`
}

export async function diagnose(signal: FailureSignal): Promise<Diagnosis> {
  const settings = getSettings()
  const context = await gatherContext(signal, settings.maxContextFiles)

  if (context.size === 0) {
    throw new IpcError(
      'Could not find any workspace file referenced by this failure, so there is nothing to patch.',
      'NO_CONTEXT'
    )
  }

  const prompt = [
    `A failure was detected by the "${signal.detector}" detector.`,
    `Source: ${signal.source}`,
    signal.exitCode !== null && signal.exitCode !== undefined ? `Exit code: ${signal.exitCode}` : '',
    '',
    '<failure_output>',
    signal.raw,
    '</failure_output>',
    '',
    signal.frames.length
      ? `Referenced locations:\n${signal.frames
          .map((frame) => `- ${frame.file}${frame.line ? `:${frame.line}` : ''}`)
          .join('\n')}`
      : '',
    '',
    'Current contents of the relevant files:',
    ...[...context].map(([path, content]) => fence(path, content))
  ]
    .filter(Boolean)
    .join('\n')

  const response = await client().messages.parse({
    model: settings.model,
    max_tokens: 32_000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(PatchSchema) },
    messages: [{ role: 'user', content: prompt }]
  })

  if (response.stop_reason === 'refusal') {
    throw new IpcError('The model declined to produce a patch for this failure.', 'REFUSED')
  }

  const parsed = response.parsed_output
  if (!parsed) throw new IpcError('The model returned an unparseable patch.', 'BAD_PATCH')

  const edits = parsed.files.map((file) => ({
    path: file.path.replace(/\\/g, '/').replace(/^\.\//, ''),
    before: null as string | null,
    after: file.action === 'delete' ? null : file.content
  }))

  // Fill in `before` from disk rather than trusting the model's idea of it -
  // the diff and the rollback snapshot both depend on this being real.
  for (const edit of edits) {
    edit.before = await tryRead(edit.path)
  }

  const meaningful = edits.filter((edit) => edit.before !== edit.after)

  return {
    rootCause: parsed.root_cause,
    explanation: parsed.explanation,
    confidence: parsed.confidence,
    edits: meaningful,
    diff: patchDiff(meaningful),
    model: response.model,
    contextFiles: [...context.keys()],
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens
  }
}
