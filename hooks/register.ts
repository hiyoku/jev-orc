import type { Register } from 'claude-code'
import { buildProfiles, PROFILE_MATCHER } from '../src/agents/profiles'
import { loadConfig } from '../src/config'

export const register: Register = (on, options) => {
  const { config, warnings } = loadConfig(options)

  on('session.start', async ($, e, next) => {
    for (const warning of warnings) $.ui.toast(`JEV: ${warning}`)
    const specs = buildProfiles(config)
    const results = await Promise.allSettled(specs.map((spec) => $.agent.register(spec)))
    results.forEach((result, i) => {
      if (result.status === 'rejected') $.ui.toast(`JEV: perfil ${specs[i].name} não registrado: ${String(result.reason)}`)
    })
    return next(e)
  })

  on('agent.offer', { agent: PROFILE_MATCHER }, () => ({ isOffered: false }))
}
