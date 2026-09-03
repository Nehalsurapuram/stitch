import { spawn } from 'node:child_process'

export interface RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  /** stdout and stderr interleaved in arrival order, which is what humans read. */
  output: string
  timedOut: boolean
  durationMs: number
}

export interface RunOptions {
  cwd: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  /** Called with each chunk as it arrives, for live terminal output. */
  onChunk?: (stream: 'stdout' | 'stderr', text: string) => void
  signal?: AbortSignal
}

/** Cap on retained output, so a runaway process cannot exhaust memory. */
const MAX_CAPTURE = 200_000

function clamp(text: string): string {
  if (text.length <= MAX_CAPTURE) return text
  const head = text.slice(0, MAX_CAPTURE / 2)
  const tail = text.slice(-MAX_CAPTURE / 2)
  return `${head}\n... [${text.length - MAX_CAPTURE} characters elided] ...\n${tail}`
}

/**
 * Run a shell command to completion and capture everything it printed.
 *
 * Commands are user-configured strings ("npm test"), so they go through the
 * platform shell rather than being tokenized here.
 */
export function runCommand(command: string, options: RunOptions): Promise<RunResult> {
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      env: { ...process.env, ...options.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let output = ''
    let timedOut = false
    let settled = false

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill()
        }, options.timeoutMs)
      : null

    const onAbort = (): void => {
      child.kill()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      output += text
      options.onChunk?.('stdout', text)
    })
    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      stderr += text
      output += text
      options.onChunk?.('stderr', text)
    })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode,
        stdout: clamp(stdout),
        stderr: clamp(stderr),
        output: clamp(output),
        timedOut,
        durationMs: Date.now() - startedAt
      })
    }

    child.on('error', (error) => {
      const text = `${error.message}\n`
      stderr += text
      output += text
      options.onChunk?.('stderr', text)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}
