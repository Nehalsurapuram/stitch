import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { AutonexSettings } from '../shared/types'
import { toSafe, updateSettings } from './settings'
import {
  deleteWorkspaceFile,
  listDirectory,
  openWorkspace,
  readWorkspaceFile,
  stopWatching,
  watchWorkspace,
  writeWorkspaceFile
} from './workspace'
import { detectors } from './pipeline/detectors'
import { incidents } from './pipeline/incidents'
import { cancel, runApply, runDiagnose, runRollback, runValidate } from './pipeline/orchestrator'

/**
 * Every privileged operation the renderer can reach. Handlers stay thin: they
 * validate nothing beyond argument shape and delegate to the module that owns
 * the behaviour, so the security-relevant checks live in one place each.
 */

type Sender = (channel: string, payload: unknown) => void

function broadcast(): Sender {
  return (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(channel, payload)
    }
  }
}

export function registerIpc(): void {
  const send = broadcast()

  /* --- workspace ------------------------------------------------- */

  ipcMain.handle('workspace:pick', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    return openFolder(result.filePaths[0], send)
  })

  ipcMain.handle('workspace:open', (_event, path: string) => openFolder(path, send))
  ipcMain.handle('fs:list', (_event, path?: string) => listDirectory(path))
  ipcMain.handle('fs:read', (_event, path: string) => readWorkspaceFile(path))
  ipcMain.handle('fs:write', async (_event, path: string, text: string) => {
    const result = await writeWorkspaceFile(path, text)
    // A save is the natural moment to re-check the project for problems.
    detectors.scheduleDiagnostics()
    return result
  })
  ipcMain.handle('fs:delete', (_event, path: string) => deleteWorkspaceFile(path))

  /* --- settings -------------------------------------------------- */

  ipcMain.handle('settings:get', () => toSafe())
  ipcMain.handle('settings:update', async (_event, patch: Partial<AutonexSettings>) => {
    const next = updateSettings(patch)
    await detectors.startLogTail() // pick up a changed log path or pattern
    send('settings:changed', next)
    return next
  })

  /* --- processes ------------------------------------------------- */

  ipcMain.handle('process:start', (_event, channel: string, command: string) =>
    detectors.start(channel, command)
  )
  ipcMain.handle('process:stop', (_event, channel: string) => detectors.stop(channel))
  ipcMain.handle('process:states', () => detectors.snapshotStates())
  ipcMain.handle('process:diagnostics', () => detectors.runDiagnostics())

  /* --- pipeline -------------------------------------------------- */

  ipcMain.handle('incidents:list', () => incidents.list())
  ipcMain.handle('incidents:dismiss', (_event, id: string) => incidents.dismiss(id))
  ipcMain.handle('incidents:clear', () => incidents.clear())
  ipcMain.handle('incidents:diagnose', (_event, id: string) => runDiagnose(id))
  ipcMain.handle('incidents:validate', (_event, id: string) => runValidate(id))
  ipcMain.handle('incidents:apply', (_event, id: string) => runApply(id))
  ipcMain.handle('incidents:rollback', (_event, id: string) => runRollback(id))
  ipcMain.handle('incidents:cancel', (_event, id: string) => cancel(id))
  ipcMain.handle('incidents:simulate', (_event, output: string) => detectors.reportManual(output))

  /* --- push channels --------------------------------------------- */

  incidents.on('changed', (list) => send('incidents:changed', list))
  detectors.on('output', (chunk) => send('process:output', chunk))
  detectors.on('state', (states) => send('process:states', states))
}

async function openFolder(path: string, send: Sender): Promise<unknown> {
  await stopWatching()
  const workspace = await openWorkspace(path)
  await watchWorkspace((event) => send('fs:event', event))
  await detectors.startLogTail()
  send('workspace:changed', workspace)
  return workspace
}
