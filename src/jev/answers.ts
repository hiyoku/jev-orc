export type ScoreAnswer = { score: number; confidence: number }
export type NoulAnswer = { noul: number }

export type JevAnswers = {
  complexity: ScoreAnswer
  deliberation: NoulAnswer
  edits_files: NoulAnswer
  runs_shell: NoulAnswer
  web_research: NoulAnswer
  library_docs: NoulAnswer
  browser: NoulAnswer
}
