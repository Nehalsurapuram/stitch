import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('autonex', {
  version: '0.1.0'
})
