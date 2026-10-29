import { expect, test } from 'claude-code/testing'
import { loadConfig } from './config'
import { jevNumbers, type LogEntry } from './log'
import { replay } from './replay'

// complexity as the chance of each level: 0 mechanical, 1 localized, 2 multi-file, 3 open design.
const answers = (probabilities: number[]) => ({
  complexity: { score: probabilities.reduce((sum, p, level) => sum + p * level, 0), confidence: 0.9, probabilities },
  deliberation: { score: 0, confidence: 1, probabilities: [1, 0, 0, 0, 0] },
  edits_files: { noul: 0 },
  runs_shell: { noul: 0 },
  web_research: { noul: 0 },
  library_docs: { noul: 0 },
  browser: { noul: 0 },
})

const line = (id: string, over: Partial<LogEntry>) =>
  JSON.stringify({ tool_use_id: id, description: 'd', outcome: 'routed', models: ['haiku'], effort: 'low', profile: 'jev-orchestrator:t-read', reasons: [], jev: jevNumbers(answers([1, 0, 0, 0])), ...over })

test('counts routed lines with valid jev, reports changed decisions, ignores the rest', () => {
  const r = replay(
    [
      // logged as haiku, but sure of the localized level is sonnet with today's cuts
      line('changed', { jev: jevNumbers(answers([0, 1, 0, 0])) }),
      line('same', {}),
      line('skipped', { outcome: 'skip', jev: undefined }),
      // logged before the level chances: no complexity_p<level>, skipped
      line('old', { jev: { complexity: 0.1, complexity_confidence: 0.9, deliberation: 0.1, edits_files: 0, runs_shell: 0, web_research: 0, library_docs: 0, browser: 0 } }),
    ],
    loadConfig({}).config,
  )
  expect(r.routed).toBe(2)
  expect(r.models).toEqual({ haiku: 2 })
  expect(r.changes).toEqual([{ tool_use_id: 'changed', before: 'haiku·low·jev-orchestrator:t-read', after: 'sonnet·low·jev-orchestrator:t-read' }])
  expect(r.stats.complexity).toEqual({ min: 0, median: 0.5, max: 1 })
})
