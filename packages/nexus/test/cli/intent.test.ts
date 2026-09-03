import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { executeLocalIntent, formatIntentExecution, formatIntentInspection, inspectIntent } from "../../src/cli/cmd/intent"
import { addLocalMemory, memoryStatus } from "../../src/cli/cmd/memory"
import { readWorkspaceSelection, writeWorkspaceSelection } from "../../src/cli/cmd/workspace"

describe("local intent inspection", () => {
  test("classifies bounded Hinglish and English requests deterministically without execution", () => {
    expect(inspectIntent("workspace ke project list dikhao")).toEqual({
      category: "workspace",
      plugin: "workspace",
      command: "list",
      confidence: "high",
      execution: "not-run",
    })
    expect(inspectIntent("current selected workspace dikhao")).toMatchObject({
      category: "workspace",
      plugin: "workspace",
      command: "selected",
      execution: "not-run",
    })
    expect(inspectIntent("project ki details dikhao")).toMatchObject({
      category: "workspace",
      plugin: "workspace",
      command: "show",
      execution: "not-run",
    })
    expect(inspectIntent("please check env variables")).toMatchObject({
      category: "diagnostics",
      plugin: "devtools",
      command: "env:scan",
      execution: "not-run",
    })
    expect(inspectIntent("awaaz se command suno")).toMatchObject({
      category: "voice",
      plugin: "voice",
      execution: "not-run",
    })
    expect(inspectIntent("bash permission denied kyu hai")).toEqual({
      category: "permission",
      plugin: "permission",
      command: "explain",
      confidence: "high",
      execution: "not-run",
    })
    expect(inspectIntent("reviewer agent role policy dikhao")).toMatchObject({
      category: "agent-role",
      plugin: "agent",
      command: "role show",
      execution: "not-run",
    })
    expect(inspectIntent("reviewer plan preview children 2 parallel 2 standard budget dikhao")).toMatchObject({
      category: "agent-plan-preview",
      plugin: "agent",
      command: "plan preview",
      execution: "not-run",
    })
    expect(inspectIntent("agent ke saare roles list dikhao")).toMatchObject({
      category: "agent-role",
      plugin: "agent",
      command: "role list",
      execution: "not-run",
    })
    expect(inspectIntent("meri total API keys aur tokens usage dikhao")).toMatchObject({
      category: "api-status",
      plugin: "api",
      command: "list",
      execution: "not-run",
    })
    expect(inspectIntent("API token budget aur daily limit batao")).toMatchObject({
      category: "api-status",
      plugin: "api",
      command: "budget",
      execution: "not-run",
    })
    expect(inspectIntent("local memory entries list dikhao")).toMatchObject({
      category: "memory",
      plugin: "memory",
      command: "list",
      execution: "not-run",
    })
    expect(inspectIntent("memory show 7 dikhao")).toMatchObject({
      category: "memory",
      plugin: "memory",
      command: "show",
      execution: "not-run",
    })
  })

  test("blocks sensitive or oversized input without echoing it or proposing a route", () => {
    const sensitive = inspectIntent("workspace ka password: correct-horse-battery-staple")
    const output = formatIntentInspection(sensitive, "table")
    const oversized = inspectIntent("a".repeat(1_001))

    expect(sensitive).toEqual({ category: "sensitive-input", confidence: "none", execution: "not-run" })
    expect(output).toContain("Sensitive-looking input was not classified or echoed")
    expect(output).not.toContain("correct-horse")
    expect(oversized).toEqual({ category: "input-too-long", confidence: "none", execution: "not-run" })
  })

  test("keeps unknown input local and side-effect-free", () => {
    const result = inspectIntent("kuch bilkul alag karna hai")
    expect(result).toEqual({ category: "unknown", confidence: "none", execution: "not-run" })
    expect(formatIntentInspection(result, "json")).not.toContain("query")
  })

  test("does not suggest a mutation route for workspace selection requests", () => {
    expect(inspectIntent("mera project select kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("requires a separate confirmation before clearing only the local workspace selection bookmark", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nexus-intent-confirm-"))
    try {
      await writeWorkspaceSelection({ configDirectory: directory, projectID: "local-project", selectedAt: 1 })
      const request = "workspace selection bookmark clear kar do"
      const inspection = inspectIntent(request)
      const withoutConfirmation = await executeLocalIntent(request, { workspaceSelectionDirectory: directory })

      expect(inspection).toMatchObject({ category: "workspace-mutation", execution: "not-run" })
      expect(withoutConfirmation).toMatchObject({ execution: "blocked" })
      expect(withoutConfirmation.reason).toContain("--confirm-local")
      expect((await readWorkspaceSelection(directory))?.projectID).toBe("local-project")

      const confirmed = await executeLocalIntent(request, { confirmLocal: true, workspaceSelectionDirectory: directory })
      expect(confirmed).toMatchObject({ execution: "executed" })
      expect(confirmed.result).toContain("Cleared the local workspace selection bookmark")
      expect(await readWorkspaceSelection(directory)).toBeUndefined()
      expect(formatIntentExecution(confirmed, "table")).toContain("completed locally (confirmed mutation)")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("does not suggest agent creation or selection for an inspection-only role request", () => {
    expect(inspectIntent("planner ko active select kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("does not suggest adding or checking an API key from inspection-only wording", () => {
    expect(inspectIntent("nayi API key add kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
    expect(inspectIntent("API key active check kar do")).toEqual({
      category: "unknown",
      confidence: "none",
      execution: "not-run",
    })
  })

  test("executes only bounded local-memory inspection and preserves the no-storage/no-mutation boundary", async () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "nexus-intent-memory-"))
    const absentStateDirectory = mkdtempSync(join(tmpdir(), "nexus-intent-memory-absent-"))
    try {
      const entry = addLocalMemory({ stateDirectory, title: "preference", value: "Keep local work bounded", createdAt: 1 })
      const status = await executeLocalIntent("local memory status dikhao", { memoryStateDirectory: stateDirectory })
      const listed = await executeLocalIntent("memory entries list dikhao", { memoryStateDirectory: stateDirectory })
      const shown = await executeLocalIntent(`memory show ${entry.id} dikhao`, { memoryStateDirectory: stateDirectory })
      const missing = await executeLocalIntent("memory show 99 dikhao", { memoryStateDirectory: stateDirectory })
      const zero = await executeLocalIntent("memory show 0 dikhao", { memoryStateDirectory: stateDirectory })
      const absent = await executeLocalIntent("local memory entries list dikhao", { memoryStateDirectory: absentStateDirectory })
      const sensitive = await executeLocalIntent("memory show 1 password=not-for-memory")

      expect(status).toMatchObject({ category: "memory", command: "status", execution: "executed" })
      expect(status.result).toContain("Local memory database: initialized")
      expect(listed).toMatchObject({ category: "memory", command: "list", execution: "executed" })
      expect(listed.result).toContain("Keep local work bounded")
      expect(shown).toMatchObject({ category: "memory", command: "show", execution: "executed" })
      expect(shown.result).toContain("preference")
      expect(missing).toMatchObject({ execution: "blocked" })
      expect(missing.reason).toContain("no storage was created or changed")
      expect(zero).toMatchObject({ execution: "blocked" })
      expect(zero.reason).toContain("positive local memory ID")
      expect(absent).toMatchObject({ execution: "executed" })
      expect(memoryStatus(absentStateDirectory)).toMatchObject({ initialized: false, entries: 0 })
      expect(sensitive).toMatchObject({ category: "sensitive-input", execution: "blocked" })
      expect(JSON.stringify(sensitive)).not.toContain("not-for-memory")
      for (const request of ["memory add a note", "memory remove 1", "memory clear all", "memory export data"]) {
        expect(inspectIntent(request)).toEqual({ category: "unknown", confidence: "none", execution: "not-run" })
      }
    } finally {
      rmSync(stateDirectory, { recursive: true, force: true })
      rmSync(absentStateDirectory, { recursive: true, force: true })
    }
  })

  test("executes only high-confidence API local inspection through the explicit allowlist", async () => {
    const result = await executeLocalIntent("API key readiness dikhao")

    expect(result.execution).toBe("executed")
    expect(result.result).toContain("API readiness (local observations only)")
    expect(result.result).toContain("No provider contacted, key checked, vault changed, route selected, or task started")
    expect(formatIntentExecution(result, "table")).toContain("completed locally (read-only)")
  })

  test("executes named specialist-role inspection but blocks an unnamed role detail", async () => {
    const reviewer = await executeLocalIntent("reviewer agent role policy dikhao")
    const unnamed = await executeLocalIntent("agent role details dikhao")

    expect(reviewer.execution).toBe("executed")
    expect(reviewer.result).toContain("Role: reviewer")
    expect(unnamed.execution).toBe("blocked")
    expect(unnamed.reason).toContain("Name one supported role")
  })

  test("executes only explicit read-only agent capability status and blocks ambiguous or runtime wording", async () => {
    let reads = 0
    const capabilityStatus = {
      learning: { proposals: { proposed: 1, approved: 0, rejected: 0, superseded: 0 }, approvedSkillRevisions: 0, explicitApprovalRequired: true },
      scheduler: { definitions: 1, enabledDefinitions: 0, disabledDefinitions: 1, workerStartedByInspection: false, executionStartedByInspection: false },
      subagents: {
        roles: [],
        durablePlans: 0,
        policyBounds: { maxChildren: "0-12", maxParallel: "1-12", maxParallelRule: "lead-plus-children" },
        observedDevice: { platform: "desktop", architecture: "x64", cpuCores: 4, totalMemoryBytes: 8, freeMemoryBytes: 4, observedOnly: true },
        agentStartedByInspection: false,
      },
      gateway: { registeredConnections: 0, enabledConnections: 0, localProfiles: 0, hostedProfiles: 0, foregroundState: "not-recorded", listenerStartedByInspection: false, remoteConnectionStartedByInspection: false },
    } as any
    const options = { agentCapabilityStatus: async () => { reads += 1; return capabilityStatus } }
    const overall = await executeLocalIntent("agent status dikhao", options)
    const scheduler = await executeLocalIntent("scheduler status dikhao", options)
    const ambiguous = await executeLocalIntent("agent learning scheduler status dikhao", options)
    const runtime = await executeLocalIntent("agent gateway start status dikhao", options)

    expect(overall).toMatchObject({ category: "agent-status", command: "status", execution: "executed" })
    expect(overall.result).toContain("Learning records")
    expect(overall.result).toContain("Gateway readiness")
    expect(scheduler).toMatchObject({ category: "agent-status", execution: "executed" })
    expect(scheduler.result).toContain("Scheduler capability")
    expect(scheduler.result).not.toContain("Learning records")
    expect(ambiguous).toMatchObject({ category: "agent-status", execution: "blocked" })
    expect(ambiguous.reason).toContain("at most one capability area")
    expect(runtime).toMatchObject({ execution: "blocked" })
    expect(reads).toBe(2)
  })

  test("executes only a bounded non-persistent agent plan preview and blocks runtime or invalid policy wording", async () => {
    const previews: Array<{ role: string; children: number; parallel: number; budget: string }> = []
    const options = {
      agentPlanPreview: async (request: { role: "planner" | "coder" | "reviewer" | "tester"; children: number; parallel: number; budget: "low" | "standard" | "high" }) => {
        previews.push(request)
        return {
          role: { name: request.role, basePolicy: "read-only" },
          policy: { maxChildren: request.children, maxParallel: request.parallel, budgetClass: request.budget },
          observedDevice: { platform: "desktop", architecture: "x64", cpuCores: 4, totalMemoryBytes: 8, freeMemoryBytes: 4, observedOnly: true },
          guidance: "Observed local memory is compatible with the requested bounded plan; this is not a performance guarantee.",
          persistentRunCreated: false,
          agentStarted: false,
          taskDelegated: false,
        } as any
      },
    }
    const safe = await executeLocalIntent("reviewer plan preview children 2 parallel 2 standard budget dikhao", options)
    const unsafe = await executeLocalIntent("reviewer plan preview start agent", options)
    const invalid = await executeLocalIntent("reviewer plan preview children 13 parallel 1", options)
    const ambiguous = await executeLocalIntent("reviewer coder plan preview", options)

    expect(safe).toMatchObject({ category: "agent-plan-preview", command: "plan preview", execution: "executed" })
    expect(safe.result).toContain("Role: reviewer")
    expect(safe.result).toContain("No agent was started, delegated, queued, persisted, or given a model task")
    expect(previews).toEqual([{ role: "reviewer", children: 2, parallel: 2, budget: "standard" }])
    expect(formatIntentExecution(safe, "table")).toContain("only a bounded local policy preview was formatted")
    for (const blocked of [unsafe, invalid, ambiguous]) {
      expect(blocked).toMatchObject({ category: "agent-plan-preview", execution: "blocked" })
    }
    expect(previews).toHaveLength(1)
  })

  test("runs bounded device readiness and known-workspace list locally but blocks sensitive routes", async () => {
    const device = await executeLocalIntent("Termux device readiness memory storage dikhao")
    const sensitive = await executeLocalIntent("API key: sk_very-secret-value-123456789")
    const workspace = await executeLocalIntent("workspace ke project list dikhao")

    expect(device.execution).toBe("executed")
    expect(device.result).toContain("Observed local signals only")
    expect(sensitive).toMatchObject({ category: "sensitive-input", execution: "blocked" })
    expect(JSON.stringify(sensitive)).not.toContain("very-secret")
    expect(workspace).toMatchObject({ category: "workspace", command: "list", execution: "executed" })
    expect(workspace.result).toContain("No known local projects")
    expect(formatIntentExecution(workspace, "table")).toContain("completed locally (read-only)")
  })

  test("executes only bounded known-workspace list and exact-ID detail without discovery, selection, or writes", async () => {
    const projects = [
      {
        id: "known-project",
        name: "Known local project",
        vcs: "git",
        time: { updated: 1 },
        sandboxes: [],
        worktree: "/safe/local/project",
      },
    ] as any
    const options = { workspaceProjects: async () => projects }
    const listed = await executeLocalIntent("workspace project list dikhao", options)
    const shown = await executeLocalIntent("workspace show known-project details", options)
    const unknown = await executeLocalIntent("workspace show unknown-project details", options)
    const path = await executeLocalIntent("workspace show known-project path dikhao", options)
    const mutation = await executeLocalIntent("workspace show known-project select kar do", options)

    expect(listed).toMatchObject({ category: "workspace", command: "list", execution: "executed" })
    expect(listed.result).toContain("Known local project")
    expect(listed.result).not.toContain("/safe/local/project")
    expect(shown).toMatchObject({ category: "workspace", command: "show", execution: "executed" })
    expect(shown.result).toContain("Project ID: known-project")
    expect(shown.result).toContain("Read-only detail")
    expect(unknown).toMatchObject({ execution: "blocked" })
    expect(unknown.reason).toContain("exactly one existing normalized workspace ID")
    expect(path).toMatchObject({ execution: "blocked" })
    expect(path.reason).toContain("no path, selection, shell, session, or write request")
    expect(mutation).toMatchObject({ execution: "blocked" })
  })

  test("executes one fixed permission category only and rejects paths, rule details, and multiple categories", async () => {
    const calls: string[] = []
    const options = {
      permissionExplanation: async (category: "bash" | "edit" | "read" | "webfetch" | "question") => {
        calls.push(category)
        return `Permission: ${category}\nScope: category-wide only`
      },
    }
    const bash = await executeLocalIntent("bash permission denied kyu hai", options)
    const multiple = await executeLocalIntent("bash read permission explain karo", options)
    const rule = await executeLocalIntent("bash permission rule explain karo", options)
    const path = await executeLocalIntent("bash permission /tmp/example explain karo", options)

    expect(bash).toMatchObject({ category: "permission", command: "explain", execution: "executed" })
    expect(bash.result).toContain("Permission: bash")
    expect(calls).toEqual(["bash"])
    for (const blocked of [multiple, rule, path]) {
      expect(blocked).toMatchObject({ category: "permission", execution: "blocked" })
      expect(blocked.reason).toContain("exactly one safe permission category")
    }
  })

  test("executes fixed-root instruction transparency without accepting a user-supplied path", async () => {
    const explain = await executeLocalIntent("NEXUS.md instruction precedence explain karo")
    const status = await executeLocalIntent("instructions status dikhao")

    expect(explain.execution).toBe("executed")
    expect(explain.result).toContain("This command never prints instruction contents")
    expect(status.execution).toBe("executed")
    expect(status.result).toContain("Scope: names and paths only; file contents are not read")
    expect(status.result).not.toContain("NEXUS.md instruction precedence explain karo")
  })

  test("executes workspace selection bookmark inspection and bounded workspace list without mutation", async () => {
    const selected = await executeLocalIntent("current selected workspace dikhao")
    const listed = await executeLocalIntent("workspace ke project list dikhao")

    expect(selected.execution).toBe("executed")
    expect(selected.result).toContain("This does not affect the current shell directory")
    expect(listed).toMatchObject({ category: "workspace", command: "list", execution: "executed" })
  })

  test("executes a bounded current-project translation plan only for an explicit language pair", async () => {
    const plan = await executeLocalIntent("TypeScript se Python translation plan banao")
    const ambiguous = await executeLocalIntent("TypeScript Python Go translation plan banao")

    expect(plan).toMatchObject({ category: "translation", execution: "executed" })
    expect(plan.result).toContain("NEXUS Translation Plan (manual review required; not executed)")
    expect(plan.result).toContain("This command does not read file contents, call a model, or write translated output")
    expect(ambiguous.execution).toBe("blocked")
    expect(ambiguous.reason).toContain("exactly two distinct supported languages")
  })

  test("writes only a confirmed fixed-name translation metadata report without overwriting", async () => {
    const directory = mkdtempSync(join(tmpdir(), "nexus-intent-translation-report-"))
    try {
      const request = "TypeScript se Python translation report save karo"
      const reportPath = join(directory, ".nexus-translation-plan.json")
      const withoutConfirmation = await executeLocalIntent(request, { translationRoot: directory })

      expect(withoutConfirmation).toMatchObject({ execution: "blocked" })
      expect(withoutConfirmation.reason).toContain("--confirm-local")
      expect(existsSync(reportPath)).toBe(false)

      const confirmed = await executeLocalIntent(request, { confirmLocal: true, translationRoot: directory })
      expect(confirmed).toMatchObject({ category: "translation", command: "confirmed report", execution: "executed" })
      expect(existsSync(reportPath)).toBe(true)
      expect(readFileSync(reportPath, "utf8")).toContain('"source": "typescript"')

      const second = await executeLocalIntent(request, { confirmLocal: true, translationRoot: directory })
      expect(second).toMatchObject({ execution: "blocked" })
      expect(second.reason).toContain("never overwritten")
      expect(formatIntentExecution(confirmed, "table")).toContain("completed locally (confirmed mutation)")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("executes informational local-model guidance and redacted known-alias route preview only", async () => {
    const localCatalog = await executeLocalIntent("local model catalog dikhao")
    const route = await executeLocalIntent("deepseek model route dikhao")
    const unknownRoute = await executeLocalIntent("my-private-model route dikhao")

    expect(localCatalog).toMatchObject({ category: "local-model", execution: "executed" })
    expect(localCatalog.result).toContain("no download or local-model runtime was started")
    expect(route).toMatchObject({ category: "model-route", execution: "executed" })
    expect(route.result).toContain("Preview only: no provider contacted, key validated, vault changed, route selected, or task started")
    expect(unknownRoute).toMatchObject({ category: "unknown", execution: "blocked" })
  })
})
