// Lets plain node resolve the project's extensionless relative imports (`./config` -> `./config.ts`).
// Run the replay over the decision log with:
//   node --import ./scripts/ts-loader.mjs src/replay.ts [path/to/decisions.jsonl]
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (specifier.startsWith('.')) return next(`${specifier}.ts`, context)
      throw error
    }
  },
})
