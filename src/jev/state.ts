// What JEV reads about a task: named fields its questions can point to, `tarefa` first.
export type JevState = {
  tarefa: string
  // Present only when `tarefa` lost its middle to the cut.
  tarefa_cortada?: true
  agente?: { tipo: string; dica?: string }
  descricao?: string
  origem?: string
  ultima_resposta_do_agente?: string
}

export const MAX_TASK_CHARS = 4000
export const LAST_REPLY_CHARS = 1500
const GAP = '\n[...]\n'
// What JEV reads as the origin of a main-loop prompt.
const MAIN_ORIGIN = 'the user typing to the coding agent in the main session'

// Head and tail: the end of a long prompt often says what to run or commit.
export function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.75) - GAP.length
  return `${text.slice(0, head)}${GAP}${text.slice(-(max - head - GAP.length))}`
}

function task(text: string): Pick<JevState, 'tarefa' | 'tarefa_cortada'> {
  const tarefa = cut(text, MAX_TASK_CHARS)
  return tarefa === text ? { tarefa } : { tarefa, tarefa_cortada: true }
}

// An Agent call: its prompt, the agent's type with its hint (agentHints or the host's listing line), and its description.
export const agentState = (prompt: string, type: string, hint: string, description: string): JevState => ({
  ...task(prompt),
  agente: hint ? { tipo: type, dica: hint } : { tipo: type },
  descricao: description,
})

// A prompt typed in the main session. The agent's last reply says what a short follow-up ("yes", "explain more") refers to.
export const mainState = (text: string, lastReply?: string): JevState => ({
  ...task(text),
  origem: MAIN_ORIGIN,
  ...(lastReply ? { ultima_resposta_do_agente: cut(lastReply, LAST_REPLY_CHARS) } : {}),
})
