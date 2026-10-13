import { expect, test } from 'claude-code/testing'
import { loadConfig } from './config'
import { jevNumbers, type LogEntry } from './log'
import { replay } from './replay'

const answers = (complexity: number) => ({
  complexity: { score: complexity, confidence: 0.9 },
  deliberation: { noul: 0.1 },
  edits_files: { noul: 0 },
  runs_shell: { noul: 0 },
  web_research: { noul: 0 },
  library_docs: { noul: 0 },
  browser: { noul: 0 },
})

const line = (id: string, over: Partial<LogEntry>) =>
  JSON.stringify({ tool_use_id: id, description: 'd', outcome: 'routed', models: ['haiku'], effort: 'low', profile: 'jev-orchestrator:t-read', reasons: [], jev: jevNumbers(answers(0.1)), ...over })

test('counts routed lines with valid jev, reports changed decisions, ignores the rest', () => {
  const r = replay(
    [
      // logged as haiku, but complexity 1.5 is sonnet with today's cuts
      line('changed', { jev: jevNumbers(answers(1.5)) }),
      line('same', {}),
      line('skipped', { outcome: 'skip', jev: undefined }),
    ],
    loadConfig({}).config,
  )
  expect(r.routed).toBe(2)
  expect(r.models).toEqual({ haiku: 2 })
  expect(r.changes).toEqual([{ tool_use_id: 'changed', before: 'haiku·low·jev-orchestrator:t-read', after: 'sonnet·low·jev-orchestrator:t-read' }])
  expect(r.stats.complexity).toEqual({ min: 0.1, median: 0.8, max: 1.5 })
})
