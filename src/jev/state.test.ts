import { expect, test } from 'claude-code/testing'
import { agentState, cut, LAST_REPLY_CHARS, mainState, MAX_TASK_CHARS } from './state'

const ORIGIN = 'the user typing to the coding agent in the main session'

test('cut keeps the head and the tail of a long text, within the limit', () => {
  const out = cut(`${'a'.repeat(3000)}${'b'.repeat(2000)}`, MAX_TASK_CHARS)
  expect(out).toHaveLength(MAX_TASK_CHARS)
  expect(out.startsWith('a'.repeat(2993))).toBe(true)
  expect(out.endsWith('b'.repeat(1000))).toBe(true)
  expect(out).toContain('\n[...]\n')
  expect(cut('short', MAX_TASK_CHARS)).toBe('short')
})

test('agentState names each field, flags a cut task and leaves out an empty hint', () => {
  expect(agentState('rename x', 'Plan', 'plans, never edits', 'rename')).toEqual({
    tarefa: 'rename x', agente: { tipo: 'Plan', dica: 'plans, never edits' }, descricao: 'rename',
  })
  const long = agentState('x'.repeat(MAX_TASK_CHARS + 1), 'general-purpose', '', 'read')
  expect(long.tarefa_cortada).toBe(true)
  expect(long.agente).toEqual({ tipo: 'general-purpose' })
})

test('mainState says where the prompt comes from, and carries the last reply when there is one', () => {
  expect(mainState('commit this')).toEqual({ tarefa: 'commit this', origem: ORIGIN })
  expect(mainState('yes', 'Should I open the PR?')).toEqual({ tarefa: 'yes', origem: ORIGIN, ultima_resposta_do_agente: 'Should I open the PR?' })
  expect(mainState('yes', 'z'.repeat(LAST_REPLY_CHARS + 1)).ultima_resposta_do_agente).toHaveLength(LAST_REPLY_CHARS)
})
