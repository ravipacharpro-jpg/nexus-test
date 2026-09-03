# NEXUS Agent Platform Architecture

## Purpose

This specification defines a durable, extensible agent platform for NEXUS. It is intentionally separate from the existing Assistant plugins and from the current voice-command repair work. The platform adds approved learning, cross-session memory, bounded subagents, schedules, and later message-channel gateways without changing the meaning of existing CLI commands, API-vault entries, model rotation, Termux configuration, or user project data.

The platform is **local-first by default**. A user can use durable memory and approved skills on one device without an account, remote server, or external channel token. The later always-on gateway must reuse the same commands, records, permissions, and schedule definitions rather than inventing a second agent implementation.

## Architectural principles

Every persisted entity has a stable identifier, schema version, timestamps, owner scope, and provenance. Every mutating action is explicit and auditable. Raw API keys, browser sessions, passwords, OTPs, cookies, and private message bodies are not copied into learning records or embeddings. Learning is proposed automatically but becomes reusable only after user approval.

The implementation uses additive SQLite migrations through the existing core database migration journal. No destructive schema migration is permitted in a feature release. Compatibility adapters keep existing files such as `~/.nexus/api-vault.json` and `~/.nexus/queue.json` readable while durable records progressively become the authoritative source for new agent-platform features.

## Package boundaries

| Module | Responsibility | Must not own |
|---|---|---|
| `agent-platform/contracts` | Versioned schemas, command DTOs, permission rules, error codes | SQLite queries, network clients, UI state |
| `agent-platform/store` | SQLite repositories, migrations, atomic writes, retention and delete operations | Model calls, channel transport |
| `agent-platform/learning` | Task outcome capture, redaction, learning proposals, approve/reject lifecycle | Silent skill publication |
| `agent-platform/memory` | Scoped memory retrieval and writes, source provenance, optional semantic index | Secrets, raw provider credentials |
| `agent-platform/orchestrator` | Durable runs, bounded subagent plans, cancellation, budget and concurrency enforcement | Direct Telegram/Discord/Slack SDK use |
| `agent-platform/scheduler` | Validated schedule definitions, next-run calculation, execution claims and audit trail | Hidden boot services or unapproved daemon start |
| `agent-platform/adapters` | Stable inbound/outbound message envelope and per-channel idempotency | Business logic or independent memory stores |
| `agent-gateway` (later) | Opt-in hosted webhook and channel runtime using platform contracts | A different storage model or bypass permissions |

## Versioned contracts

All new public records carry `schemaVersion: 1` at introduction. The contracts are serialized through Effect schemas and persisted as explicit columns plus structured JSON only where the shape is deliberately extensible. A future breaking semantic change creates a new version and migration; it does not reinterpret old records in place.

### Memory record

```ts
type MemoryRecordV1 = {
  schemaVersion: 1
  id: string
  scope: "device" | "project" | "channel"
  scopeId: string
  kind: "fact" | "preference" | "decision" | "summary" | "instruction"
  content: string
  sourceRunId?: string
  confidence: number
  status: "active" | "superseded" | "deleted"
  createdAt: number
  updatedAt: number
}
```

Memory writes require an explicit user command, an approved learning action, or a policy that the user previously enabled for that scope. Retrieval is constrained to the active scope; a project run cannot silently read another project's memory. Initial retrieval uses SQLite full-text search plus recency and confidence ranking. The existing `@nexus/vector-search` capability remains optional behind the same repository interface so semantic search can be enabled later without changing persisted ownership or permissions.

### Learning proposal

```ts
type LearningProposalV1 = {
  schemaVersion: 1
  id: string
  runId: string
  title: string
  summary: string
  skillDraft: string
  evidence: string[]
  redactionReport: { removedSecrets: number; removedSensitiveValues: number }
  status: "proposed" | "approved" | "rejected" | "superseded"
  createdAt: number
  reviewedAt?: number
}
```

After a task, the learning service may create a **proposal** with redacted task evidence and a draft skill. It cannot modify the active skill catalog until a user reviews and approves it. Approval creates an immutable skill revision with provenance. Rejection retains an audit entry but does not retain raw sensitive task content.

### Durable run and subagent plan

```ts
type AgentRunV1 = {
  schemaVersion: 1
  id: string
  parentRunId?: string
  mode: "interactive" | "scheduled" | "channel"
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  requestedAt: number
  startedAt?: number
  completedAt?: number
  policy: { maxChildren: number; maxParallel: number; budgetClass: "low" | "standard" | "high" }
}
```

The existing process-local `BackgroundJob` registry remains responsible for live process coordination. The new durable run store records ownership, state transitions, cancellation requests, idempotency keys, and restart-safe observation. A process restart never pretends that live work continued; it marks interrupted work recoverable and requires a user-approved retry policy.

## SQLite data model

The first additive migration creates the following tables. Each table includes `time_created` and `time_updated`; foreign keys are enabled by the existing core database layer.

| Table | Main records | Key constraints |
|---|---|---|
| `agent_memory` | Scoped, redacted facts and preferences | `(scope, scope_id, content_hash)` unique for active entries |
| `agent_memory_revision` | Supersession/delete history | Links immutable event to memory record |
| `agent_run` | Interactive, scheduled, and channel runs | Idempotency key unique per owner/channel scope |
| `agent_subtask` | Bounded child work units | Parent run foreign key; explicit sequence and status |
| `agent_learning_proposal` | Redacted skill proposals | One proposal status lifecycle per revision |
| `agent_skill_revision` | Approved reusable skill versions | Immutable content hash and provenance |
| `agent_schedule` | Disabled-by-default schedule definitions | Time zone, next run, policy, explicit enabled state |
| `agent_schedule_execution` | Claims and audit outcomes | One execution per schedule/idempotency window |
| `agent_adapter_connection` | Channel configuration metadata only | Secrets remain in the credential/secret store, never this table |
| `agent_audit` | Mutation, consent, delivery, and error events | Append-only event data without secrets |

## Permissions and data safety

The platform has four separate permission categories: memory write, skill approval, schedule enablement, and channel delivery. A consent for one does not grant another. High-impact requests, remote mutations, destructive commands, browser interaction, external message sending, and schedule activation retain their current explicit confirmation requirements.

Channel adapters store only connection metadata and a reference to a credential-store entry. They do not export sessions, intercept OTPs, bypass CAPTCHAs, impersonate users, or process credentials through language-model prompts. Inbound messages have idempotency keys and source identity checks. Outbound channel messages are auditable and can be disabled per adapter.

## Scheduling model

The local-first scheduler has a shared `ScheduleDefinition` contract but does not silently install boot receivers, hidden Android services, wake locks, or a permanent daemon. On Termux and desktop it can expose validated schedule definitions and user-started execution; platform-specific schedulers are adapters with an explicit enable command and clear status diagnostics.

The later hosted gateway claims due schedules transactionally, records each execution, and routes work through the same durable run policy. A schedule has a maximum parallelism, allowed action class, retry policy, and user-visible enable/disable state. A failed or interrupted task cannot loop indefinitely.

## Channel gateway model

Telegram, Discord, and Slack are independent adapters behind one `InboundMessage` and `OutboundMessage` contract. Adapter code validates source signatures where available, normalizes message identity and channel scopes, deduplicates deliveries, and sends every request through the core orchestrator. No adapter gets direct database access beyond its own connection and idempotency repository.

The always-on gateway is an opt-in second deployment. It shares the local platform schemas and can synchronize only user-selected scopes. Gateway activation requires the user to connect each service with its own token or OAuth flow; no automatic account creation, token discovery, or credit purchase occurs.

## Staged delivery plan

1. **Foundation release:** contracts, additive SQLite migration, memory repository, learning proposal/approval CLI, durable run records, bounded subagent policy, scheduler definitions, redaction, migration tests, and diagnostics.
2. **Local workflow release:** command-palette/TUI views, memory search, skill review, run history, user-started platform scheduler adapters, import/export with redaction.
3. **Gateway design review:** webhook capability review, adapter threat model, credential connection flows, hosted operational plan, and explicit user selection of shared scopes.
4. **Gateway release:** Telegram, Discord, and Slack adapters; remote schedule claims; dashboard; per-channel audit; idempotency and retry tests.

No automatic “self-modification” is included. The learning loop improves behavior only through approved, revisioned skills and memory entries that the user can inspect, export, disable, or delete.

## Compatibility commitments

Existing aliases (`nexus`, `nx`, `devhub`, and `opencode`), current API-vault formats, provider rotation, TUI layout, Termux paths, historic releases, and project data remain compatible. New commands are namespaced under `nexus agent ...` initially; short aliases are added only after command collision review. All migrations are forward-only and backups/export are available before any future cross-device synchronization is enabled.
