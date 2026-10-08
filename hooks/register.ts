import type { Register } from 'claude-code'
import { buildProfiles } from '../src/agents/profiles'
import { loadConfig } from '../src/config'
import { routeAgentSpawns } from '../src/hooks/spawn'

export const register: Register = (on, options) => {
  const { config, warnings } = loadConfig(options)
  const registered = new Set<string>()

  on('session.start', async ($, e, next) => {
    for (const warning of warnings) $.ui.toast(`JEV: ${warning}`)
    const specs = buildProfiles(config)
    const results = await Promise.allSettled(specs.map((spec) => $.agent.register(spec)))
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') registered.add(result.value.agent)
      else $.ui.toast(`JEV: perfil ${specs[i].name} não registrado: ${String(result.reason)}`)
    })
    return next(e)
  })

  routeAgentSpawns(on, config, registered)
}
