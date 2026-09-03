import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { AutonexSettings, SafeSettings } from '../shared/types'

const DEFAULTS: AutonexSettings = {
  apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  model: 'claude-opus-5',
  commands: {
    run: 'npm run dev',
    test: 'npm test',
    typecheck: 'npm run typecheck',
    lint: ''
  },
  verifySteps: ['npm run typecheck', 'npm test'],
  logFile: '',
  logPattern: '(ERROR|FATAL|Unhandled|Exception|Traceback)',
  detectors: { process: true, diagnostics: true, logfile: false, crash: true },
  autoDiagnose: true,
  autoValidate: true,
  autoApply: false,
  maxContextFiles: 8
}

let cached: AutonexSettings | null = null

function file(): string {
  return join(app.getPath('userData'), 'autonex-settings.json')
}

export function getSettings(): AutonexSettings {
  if (cached) return cached
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<AutonexSettings>
    cached = {
      ...DEFAULTS,
      ...raw,
      commands: { ...DEFAULTS.commands, ...(raw.commands ?? {}) },
      detectors: { ...DEFAULTS.detectors, ...(raw.detectors ?? {}) },
      // An env key still wins when nothing was saved, so a fresh install works.
      apiKey: raw.apiKey || DEFAULTS.apiKey
    }
  } catch {
    cached = { ...DEFAULTS }
  }
  return cached
}

export function updateSettings(patch: Partial<AutonexSettings>): SafeSettings {
  const next: AutonexSettings = {
    ...getSettings(),
    ...patch,
    commands: { ...getSettings().commands, ...(patch.commands ?? {}) },
    detectors: { ...getSettings().detectors, ...(patch.detectors ?? {}) }
  }
  cached = next
  const target = file()
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(next, null, 2), 'utf8')
  return toSafe(next)
}

/** Strip the API key before anything crosses into the renderer. */
export function toSafe(settings: AutonexSettings = getSettings()): SafeSettings {
  const { apiKey, ...rest } = settings
  return { ...rest, hasApiKey: apiKey.trim().length > 0 }
}
