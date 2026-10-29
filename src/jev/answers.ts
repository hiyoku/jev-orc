import type { questions } from './questions'

// probabilities: the chance of each level, in the order of the question's criteria.
export type ScoreAnswer = { score: number; confidence: number; probabilities: number[] }
export type NoulAnswer = { noul: number }

export type JevAnswers = {
  [K in keyof typeof questions]: (typeof questions)[K]['type'] extends 'score' ? ScoreAnswer : NoulAnswer
}
