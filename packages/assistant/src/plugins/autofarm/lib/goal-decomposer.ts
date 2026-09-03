// goal-decomposer: turn a free-form goal into a structured DAG of
// sub-tasks with explicit dependencies, so the orchestrator can
// execute them in the right order, parallelize where possible, and
// recover gracefully when a single step fails.
//
// Two modes:
//   1. heuristic: pattern-based decomposition (no LLM needed, instant)
//   2. llm:       use a model to think through the goal (slower, smarter)
//
// Output: a GoalDag with nodes (sub-tasks) and edges (deps).
// The orchestrator iterates: pickReady() → execute → markDone / markFailed.

export interface GoalNode {
  id: string
  title: string
  /** Detailed instruction for the agent. */
  prompt: string
  /** IDs of nodes that must complete first. */
  deps: string[]
  status: "pending" | "ready" | "running" | "done" | "failed" | "skipped"
  result?: unknown
  error?: string
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** Estimated cost/effort 1-10. Used for scheduling. */
  effort: number
  /** Optional: which agent/specialist should run this. */
  agent?: string
}

export interface GoalDag {
  id: string
  goal: string
  createdAt: number
  nodes: GoalNode[]
  /** Topological order. */
  order: string[]
  meta: {
    totalNodes: number
    maxDepth: number
    parallelizable: number
  }
}

let nodeCounter = 0
function newId(): string { nodeCounter++; return `n${nodeCounter}` }

// ── Heuristic decomposer (no LLM) ─────────────────────────
export function heuristicDecompose(goal: string): GoalDag {
  const lower = goal.toLowerCase()
  const nodes: GoalNode[] = []

  // Common patterns
  const patterns: Array<{ match: RegExp; plan: Array<{ title: string; prompt: string; effort: number; agent?: string }> }> = [
    {
      match: /\bbuild|create|make|scaffold|setup|start\b.*\b(app|project|tool|service|website)\b/,
      plan: [
        { title: "Analyze requirements", prompt: `Identify the key features and constraints of: ${goal}`, effort: 2, agent: "planner" },
        { title: "Scaffold project", prompt: `Scaffold the project structure for: ${goal}`, effort: 4, agent: "coder" },
        { title: "Implement core logic", prompt: `Implement the main feature(s) for: ${goal}`, effort: 7, agent: "coder" },
        { title: "Write tests", prompt: `Write unit + integration tests for: ${goal}`, effort: 4, agent: "tester" },
        { title: "Verify and document", prompt: `Run tests, fix failures, and write a README for: ${goal}`, effort: 3, agent: "reviewer" },
      ],
    },
    {
      match: /\bfix|debug|repair|resolve\b/,
      plan: [
        { title: "Reproduce the bug", prompt: `Reproduce: ${goal}`, effort: 3, agent: "debugger" },
        { title: "Diagnose root cause", prompt: `Find the root cause of: ${goal}`, effort: 4, agent: "debugger" },
        { title: "Apply fix", prompt: `Apply minimal fix for: ${goal}`, effort: 4, agent: "coder" },
        { title: "Regression test", prompt: `Re-run existing tests + add a regression test for: ${goal}`, effort: 3, agent: "tester" },
      ],
    },
    {
      match: /\bdeploy|ship|release|publish\b/,
      plan: [
        { title: "Pre-deploy checks", prompt: `Run lint, type-check, and tests before deploy: ${goal}`, effort: 3, agent: "qa" },
        { title: "Build artifacts", prompt: `Build production artifacts for: ${goal}`, effort: 4, agent: "builder" },
        { title: "Deploy", prompt: `Deploy: ${goal}`, effort: 5, agent: "deployer" },
        { title: "Smoke test production", prompt: `Run smoke tests on the deployed service for: ${goal}`, effort: 3, agent: "qa" },
      ],
    },
    {
      match: /\bresearch|investigate|explore|find out|learn about\b/,
      plan: [
        { title: "Identify sources", prompt: `Find authoritative sources on: ${goal}`, effort: 3, agent: "researcher" },
        { title: "Gather data", prompt: `Collect the key facts about: ${goal}`, effort: 5, agent: "researcher" },
        { title: "Synthesize", prompt: `Write a concise summary of: ${goal}`, effort: 4, agent: "writer" },
      ],
    },
  ]

  for (const p of patterns) {
    if (p.match.test(lower)) {
      p.plan.forEach((step, i) => {
        nodes.push({
          id: newId(),
          title: step.title,
          prompt: step.prompt,
          deps: i === 0 ? [] : [nodes[i - 1].id],
          status: "pending",
          effort: step.effort,
          ...(step.agent ? { agent: step.agent } : {}),
        })
      })
      break
    }
  }
  // Fallback: single-node plan
  if (nodes.length === 0) {
    nodes.push({
      id: newId(),
      title: "Execute goal",
      prompt: goal,
      deps: [],
      status: "pending",
      effort: 5,
    })
  }

  return finalize(goal, nodes)
}

// ── LLM-based decomposer (placeholder, requires provider) ──
export async function llmDecompose(
  goal: string,
  agent: (prompt: string) => Promise<string>,
): Promise<GoalDag> {
  const prompt = `Break down this goal into 3-8 ordered sub-tasks. Output JSON only:
{"nodes": [{"title": "...", "prompt": "...", "effort": 1-10, "agent": "coder|tester|..."}]}

Goal: ${goal}`
  try {
    const raw = await agent(prompt)
    const json = JSON.parse(extractJson(raw))
    const nodes: GoalNode[] = (json.nodes as Array<{ title: string; prompt: string; effort: number; agent?: string }>).map((n, i) => ({
      id: newId(),
      title: n.title,
      prompt: n.prompt,
      deps: i === 0 ? [] : [nodes && nodes[i - 1]?.id].filter(Boolean) as string[],
      status: "pending",
      effort: n.effort,
      ...(n.agent ? { agent: n.agent } : {}),
    }))
    return finalize(goal, nodes)
  } catch (e) {
    log.warn("dag", `llm decompose failed, falling back to heuristic: ${(e as Error).message}`)
    return heuristicDecompose(goal)
  }
}

function finalize(goal: string, nodes: GoalNode[]): GoalDag {
  // Compute topological order (Kahn's algorithm)
  const inDeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    inDeg.set(n.id, n.deps.length)
    if (!adj.has(n.id)) adj.set(n.id, [])
    for (const d of n.deps) {
      const a = adj.get(d) ?? []
      a.push(n.id)
      adj.set(d, a)
    }
  }
  const order: string[] = []
  const queue = nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0).map((n) => n.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    order.push(id)
    for (const m of adj.get(id) ?? []) {
      const d = (inDeg.get(m) ?? 0) - 1
      inDeg.set(m, d)
      if (d === 0) queue.push(m)
    }
  }
  // Mark all nodes as ready initially (those with 0 deps)
  for (const n of nodes) {
    if (n.deps.length === 0) n.status = "ready"
  }
  // Compute max depth
  const depth = new Map<string, number>()
  for (const id of order) {
    const n = nodes.find((x) => x.id === id)!
    depth.set(id, n.deps.length === 0 ? 0 : Math.max(...n.deps.map((d) => (depth.get(d) ?? 0) + 1)))
  }
  const maxDepth = Math.max(0, ...depth.values())
  // Nodes that can run in parallel (no deps and same depth group)
  const parallelizable = nodes.filter((n) => n.deps.length === 0).length
  return {
    id: "dag-" + Date.now().toString(36),
    goal,
    createdAt: Date.now(),
    nodes,
    order,
    meta: { totalNodes: nodes.length, maxDepth, parallelizable },
  }
}

function extractJson(s: string): string {
  const m = s.match(/\{[\s\S]*\}/)
  return m ? m[0] : "{}"
}

// ── Execution helpers ─────────────────────────────────────
/** Mark deps of `id` as satisfied and find newly-ready nodes. */
export function pickReady(dag: GoalDag, finishedId: string, status: "done" | "failed" | "skipped"): GoalNode[] {
  const finished = dag.nodes.find((n) => n.id === finishedId)
  if (!finished) return []
  finished.status = status
  finished.finishedAt = Date.now()
  finished.durationMs = finished.startedAt ? finished.finishedAt - finished.startedAt : 0
  const ready: GoalNode[] = []
  for (const n of dag.nodes) {
    if (n.status !== "pending") continue
    if (n.deps.every((d) => dag.nodes.find((x) => x.id === d)?.status === "done" || dag.nodes.find((x) => x.id === d)?.status === "skipped")) {
      n.status = "ready"
      ready.push(n)
    }
  }
  return ready
}

export function markRunning(dag: GoalDag, id: string): GoalNode | null {
  const n = dag.nodes.find((x) => x.id === id)
  if (!n) return null
  n.status = "running"
  n.startedAt = Date.now()
  return n
}

export function dagStats(dag: GoalDag): { done: number; running: number; pending: number; failed: number } {
  let done = 0, running = 0, pending = 0, failed = 0
  for (const n of dag.nodes) {
    if (n.status === "done" || n.status === "skipped") done++
    else if (n.status === "running") running++
    else if (n.status === "failed") failed++
    else pending++
  }
  return { done, running, pending, failed }
}

export function formatDag(dag: GoalDag): string {
  const s = dagStats(dag)
  const total = dag.nodes.length
  const pct = total > 0 ? Math.round((s.done / total) * 100) : 0
  return `DAG: ${total} nodes, depth=${dag.meta.maxDepth}, ${pct}% done (${s.done}ok ${s.running}.. ${s.failed}x ${s.pending}.)`
}

// Stub for missing log import
import { log } from "./logger.ts"
