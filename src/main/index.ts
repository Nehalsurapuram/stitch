import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { startPipeline } from './pipeline/orchestrator'
import { detectors } from './pipeline/detectors'
import { stopWatching } from './workspace'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0e1117',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  startPipeline()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Child processes are spawned detached from the renderer's lifetime, so they
// have to be reaped explicitly or a killed window leaves a dev server running.
app.on('before-quit', () => {
  detectors.stopAll()
  detectors.stopLogTail()
  void stopWatching()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
