import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * The package is `"type": "module"`, but Electron's main process here does not
 * expose named ESM exports (`import { BrowserWindow } from 'electron'` fails at
 * load). Main and preload are therefore emitted as CommonJS with an explicit
 * .cjs extension, which opts them out of the package-level module type.
 *
 * Dependencies that are ESM-only (chokidar) are loaded with a dynamic import,
 * which Rollup preserves in CJS output.
 */
const commonjsOutput = {
  format: 'cjs' as const,
  entryFileNames: 'index.cjs'
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        output: commonjsOutput
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: commonjsOutput
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
