export const SPECIALIST_ROLE_CONFIGS = {
  planner: {
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "ask",
    task: "deny",
    edit: "deny",
  },
  coder: {
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    edit: "allow",
    bash: "ask",
    task: "deny",
    todowrite: "deny",
  },
  reviewer: {
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    webfetch: "allow",
    websearch: "allow",
    bash: "ask",
    task: "deny",
    edit: "deny",
    todowrite: "deny",
  },
  tester: {
    "*": "deny",
    read: "allow",
    grep: "allow",
    glob: "allow",
    list: "allow",
    bash: "ask",
    task: "deny",
    edit: "deny",
    todowrite: "deny",
  },
} as const

export const SPECIALIST_ROLE_DETAILS = {
  planner: {
    description: "Plans a bounded approach and hand-off summary. It cannot edit project files.",
    prompt:
      "Produce a concise, bounded implementation plan and hand-off. Do not edit files or perform remote mutations.",
  },
  coder: {
    description: "Implements a scoped change after a plan. Report a concise hand-off for review and testing.",
    prompt:
      "Implement only the requested scoped change. Finish with a concise hand-off identifying changed files and validation run.",
  },
  reviewer: {
    description:
      "Reviews code and reports findings only. It cannot edit project files or silently run shell mutations.",
    prompt:
      "Review only. Do not edit files, delegate tasks, or perform remote mutations. Report concrete findings with file references.",
  },
  tester: {
    description:
      "Runs or proposes tests within explicit approvals. It cannot edit project files or silently mutate remote state.",
    prompt:
      "Test only. Do not edit files, delegate tasks, or perform remote mutations. Report commands, observed results, and remaining risk.",
  },
} as const
