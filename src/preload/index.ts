import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('stitch_', {
  version: '0.1.0'
})
