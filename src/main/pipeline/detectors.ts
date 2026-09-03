import { spawn, type ChildProcess } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import type { DetectorKind, FailureSignal, ProcessChunk, ProcessState } from '../../shared/types'
import { getSettings } from '../settings'
import { getRoot, hasWorkspace } from '../workspace'
import { runCommand } from '../shell'
import { buildSignal } from './signals'

/**
 * Detection stage. Four sources feed one event:
 *
 *  process     - a configured run/test command exits non-zero
 *  crash       - a long-running process dies without being asked to
 *  diagnostics - typecheck/lint run after a save comes back dirty
 *  logfile     - a tailed log file emits a line matching the error pattern
 */

class Detectors extends EventEmitter {
  private processes = new Map<string, { child: ChildProcess; command: string; startedAt: number; stopping: boolean }>()
  private states = new Map<string, ProcessState>()
  private buffers = new Map<string, string>()
  private logWatcher: FSWatcher | null = null
  private logOffset = 0
  private diagnosticsTimer: NodeJS.Timeout | null = null

  /* ---------------------------------------------------------------- */
  /* Process + crash detectors                                         */
  /* ---------------------------------------------------------------- */

  states_(): ProcessState[] {
    return [...this.states.values()]
  }

  isRunning(channel: string): boolean {
    return this.processes.has(channel)
  }

  /** Start one of the configured commands and watch how it ends. */
  start(channel: string, command: string): ProcessState {
    if (!command.trim()) throw new Error(`No command configured for "${channel}"`)
    this.stop(channel)

    const child = spawn(command, {
      cwd: getRoot(),
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      windowsHide: true
    })
    const startedAt = Date.now()
    this.processes.set(channel, { child, command, startedAt, stopping: false })
    this.buffers.set(channel, '')

    const state: ProcessState = {
      channel,
      command,
      running: true,
      pid: child.pid ?? null,
      exitCode: null,
      startedAt
    }
    this.states.set(channel, state)
    this.emitChunk(channel, 'system', `$ ${command}\n`)
    this.emit('state', this.states_())

    const capture = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString()
      // Keep a bounded tail per channel - enough to diagnose, not enough to leak.
      const next = (this.buffers.get(channel) ?? '') + text
      this.buffers.set(channel, next.length > 60_000 ? next.slice(-60_000) : next)
      this.emitChunk(channel, stream, text)
    }
    child.stdout?.on('data', capture('stdout'))
    child.stderr?.on('data', capture('stderr'))

    child.on('error', (error) => this.emitChunk(channel, 'system', `${error.message}\n`))

    child.on('close', (code) => {
      const entry = this.processes.get(channel)
      const wasStopping = entry?.stopping ?? false
      const lifetime = Date.now() - startedAt
      this.processes.delete(channel)
      this.states.set(channel, { ...state, running: false, pid: null, exitCode: code })
      this.emitChunk(channel, 'system', `\nProcess exited with code ${code}\n`)
      this.emit('state', this.states_())

      if (wasStopping) return
      const settings = getSettings()

      // A dev server that dies on its own is a crash; a task that exits
      // non-zero is an ordinary failure. The line between them is whether it
      // was meant to keep running.
      const isLongRunning = channel === 'run' && lifetime > 3_000
      const kind: DetectorKind = isLongRunning ? 'crash' : 'process'
      if (code === 0 || !settings.detectors[kind]) return

      this.report({
        detector: kind,
        source: command,
        output: this.buffers.get(channel) ?? '',
        exitCode: code,
        fallbackMessage: isLongRunning
          ? `${command} crashed after ${Math.round(lifetime / 1000)}s`
          : `${command} exited with code ${code}`
      })
    })

    return state
  }

  stop(channel: string): void {
    const entry = this.processes.get(channel)
    if (!entry) return
    entry.stopping = true
    entry.child.kill()
    this.processes.delete(channel)
  }

  stopAll(): void {
    for (const channel of [...this.processes.keys()]) this.stop(channel)
  }

  private emitChunk(channel: string, stream: ProcessChunk['stream'], text: string): void {
    this.emit('output', { channel, stream, text, at: Date.now() } satisfies ProcessChunk)
  }

  /* ---------------------------------------------------------------- */
  /* Diagnostics detector                                              */
  /* ---------------------------------------------------------------- */

  /** Debounced: a burst of saves should produce one typecheck, not ten. */
  scheduleDiagnostics(delayMs = 1200): void {
    if (!hasWorkspace()) return
    const settings = getSettings()
    if (!settings.detectors.diagnostics) return
    if (this.diagnosticsTimer) clearTimeout(this.diagnosticsTimer)
    this.diagnosticsTimer = setTimeout(() => void this.runDiagnostics(), delayMs)
  }

  async runDiagnostics(): Promise<void> {
    const settings = getSettings()
    const commands = [settings.commands.typecheck, settings.commands.lint].filter((command) =>
      command.trim()
    )
    for (const command of commands) {
      const result = await runCommand(command, { cwd: getRoot(), timeoutMs: 5 * 60_000 })
      this.emitChunk('diagnostics', 'system', `$ ${command}\n${result.output}`)
      if (result.exitCode === 0) continue
      this.report({
        detector: 'diagnostics',
        source: command,
        output: result.output,
        exitCode: result.exitCode,
        fallbackMessage: `${command} reported problems`
      })
      return // one diagnostics incident at a time is enough
    }
  }

  /* ---------------------------------------------------------------- */
  /* Log file detector                                                 */
  /* ---------------------------------------------------------------- */

  async startLogTail(): Promise<void> {
    this.stopLogTail()
    const settings = getSettings()
    if (!settings.detectors.logfile || !settings.logFile.trim()) return

    const path = settings.logFile
    try {
      this.logOffset = (await stat(path)).size // only react to new lines
    } catch {
      this.logOffset = 0
    }

    let pattern: RegExp
    try {
      pattern = new RegExp(settings.logPattern, 'i')
    } catch {
      pattern = /error/i
    }

    const read = async (): Promise<void> => {
      let handle
      try {
        const info = await stat(path)
        // A truncated/rotated file starts over rather than reading garbage.
        if (info.size < this.logOffset) this.logOffset = 0
        if (info.size === this.logOffset) return
        handle = await open(path, 'r')
        const length = info.size - this.logOffset
        const buffer = Buffer.alloc(Math.min(length, 200_000))
        await handle.read(buffer, 0, buffer.length, this.logOffset)
        this.logOffset = info.size
        const text = buffer.toString('utf8')
        this.emitChunk('logfile', 'stdout', text)

        const lines = text.split('\n')
        const hitIndex = lines.findIndex((line) => pattern.test(line))
        if (hitIndex === -1) return
        this.report({
          detector: 'logfile',
          source: path,
          // Surrounding lines usually carry the stack trace.
          output: lines.slice(Math.max(0, hitIndex - 5), hitIndex + 40).join('\n'),
          fallbackMessage: lines[hitIndex].trim()
        })
      } catch {
        /* the file may not exist yet; the watcher will fire again */
      } finally {
        await handle?.close()
      }
    }

    try {
      this.logWatcher = watch(path, () => void read())
    } catch {
      this.emitChunk('logfile', 'system', `Could not watch ${path}\n`)
    }
  }

  stopLogTail(): void {
    this.logWatcher?.close()
    this.logWatcher = null
  }

  /* ---------------------------------------------------------------- */

  private report(input: {
    detector: DetectorKind
    source: string
    output: string
    exitCode?: number | null
    fallbackMessage?: string
  }): void {
    const signal: FailureSignal = buildSignal({ ...input, root: getRoot() })
    this.emit('failure', signal)
  }

  /** Used by the "simulate" action so the pipeline can be exercised on demand. */
  reportManual(output: string, source = 'manual'): void {
    this.report({ detector: 'process', source, output, exitCode: 1 })
  }
}

export const detectors = new Detectors()
