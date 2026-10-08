import type { Register } from 'claude-code'
import { loadConfig } from '../src/config'

export const register: Register = (on, options) => {
  const { warnings } = loadConfig(options)

  on('session.start', ($, e, next) => {
    for (const warning of warnings) $.ui.toast(`JEV: ${warning}`)
    return next(e)
  })
}
