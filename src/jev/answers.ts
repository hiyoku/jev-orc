import type { questions } from './questions'

export type ScoreAnswer = { score: number; confidence: number }
export type NoulAnswer = { noul: number }

export type JevAnswers = {
  [K in keyof typeof questions]: (typeof questions)[K]['type'] extends 'score' ? ScoreAnswer : NoulAnswer
}
