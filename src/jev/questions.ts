export const questions = {
  complexity: {
    type: 'score',
    instructions: 'How hard is it for a coding agent to complete `tarefa` correctly, given `contexto`?',
    criteria: [
      'Mechanical: run a command, read or locate something, rename, or tweak a constant or text; the exact change is already stated.',
      'Localized change in one or two files that follows an existing pattern, with clear acceptance criteria.',
      'Multi-file feature or bug fix that requires understanding how several components interact, but the design is already decided.',
      'Open design, architecture or ambiguous requirements; or subtle correctness at stake (concurrency, money or ledger invariants, security, data migrations); or a bug whose cause is unknown.',
    ],
  },
  deliberation: {
    type: 'score',
    instructions: 'How much step-by-step reasoning does the agent need before acting on `tarefa`?',
    // One level per effort, low to max.
    criteria: [
      'The task states the exact change or command; the agent only carries it out.',
      'The agent follows a pattern already in the code and makes a few obvious choices.',
      'The agent compares a few approaches or traces how several files work together before choosing one.',
      'The agent must find the cause of a problem nobody has identified yet, or design something whose requirements are open.',
      'A mistake would break subtle invariants such as concurrency, money or ledger balances, security or data migrations, so every step must be checked.',
    ],
  },
  edits_files: {
    type: 'noul',
    instructions: 'Does completing `tarefa` require creating, modifying or deleting files?',
  },
  runs_shell: {
    type: 'noul',
    instructions: 'Does completing `tarefa` require running shell commands such as tests, builds, git, package managers or scripts?',
  },
  web_research: {
    type: 'noul',
    instructions: 'Does completing `tarefa` require information from the internet (web search or online pages) that is not in the local repository?',
  },
  library_docs: {
    type: 'noul',
    instructions: 'Does completing `tarefa` require current documentation of a specific third-party library, framework, SDK, API or CLI tool?',
  },
  browser: {
    type: 'noul',
    instructions: 'Does completing `tarefa` require interacting with a running web application in a browser (navigating, clicking, taking screenshots, checking the UI)?',
  },
} as const satisfies Record<string, { type: 'score' | 'noul'; instructions: string; criteria?: readonly string[] }>
