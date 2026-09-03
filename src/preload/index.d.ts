import type { AutonexApi } from './index'

declare global {
  interface Window {
    autonex: AutonexApi
  }
}

export {}
