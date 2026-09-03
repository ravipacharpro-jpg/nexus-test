# Agentic Architecture Research Notes

## Findings applied to NEXUS

Recent agent-orchestration research consistently emphasizes that a capable coding agent needs more than a prompt and a tool list. The control plane must own planning, dependency-aware execution, policy enforcement, state/checkpoint management, quality verification, observability, and recovery. Specialized agents should have narrow responsibilities and explicit communication contracts rather than sharing an uncontrolled context.

A strong practical loop is **Plan → Execute → Verify → Replan → Synthesize**. The plan should be a dependency graph; independent safe tasks may run in parallel on a capable PC, while Termux should remain conservative and mostly sequential. Verification must happen at the orchestration level, not only inside a worker. If output is incomplete or a test fails, the Master should preserve previous evidence, create a targeted repair step, and stop after explicit iteration, time, token, and tool-call limits.

For coding workflows, useful reliability patterns include isolated workspaces or worktrees, a shared task list with dependency states, peer/context handoff between specialists, a dedicated reviewer/quality gate, and an external memory file for durable project conventions. NEXUS should adapt these ideas to its terminal-first architecture without forcing parallel workers on low-memory Android devices.

## Concrete NEXUS improvements to prioritize

| Research pattern           | NEXUS implementation direction                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Plan/execute/verify/replan | Extend `MasterAgent` with a verification result contract and targeted replan steps                     |
| DAG execution              | Keep dependency-aware scheduling; add safe concurrency waves for PC and sequential Termux mode         |
| Specialized workers        | Connect coder/debugger/reviewer/tester/research/docs to existing TaskTool sessions with typed briefs   |
| Shared state               | Persist task, worker, evidence, retry, approval, and artifact records atomically                       |
| Quality gate               | Run reviewer and verification worker before a step becomes completed                                   |
| Loop guardrails            | Enforce max attempts, total time, same-error detection, token budget, and tool-call budget             |
| Context isolation          | Scope worker prompts to objective, dependency evidence, allowed files, and project instructions        |
| Peer/context handoff       | Store structured worker outputs and pass only relevant evidence to dependent workers                   |
| Observability              | Stream worker lifecycle, command, test, model route, and checkpoint events to the TUI                  |
| Resource awareness         | Use Termux fast profile, low output caps, sequential work, process groups, and cleanup                 |
| Compound learning          | Read curated project guidance; only persist reviewed project conventions, never blindly generate rules |
| Async operation            | Use resumable background jobs with user notifications and explicit cancel/resume controls              |

## Reliability conclusions

The main engineering bottleneck is verification, not raw code generation. Passing tests are necessary but not sufficient; the agent should verify that the intended files changed, the expected artifact exists, the command actually ran, the result matches the objective, and no secret or unsafe external action occurred. A worker that cannot perform its capability must return `blocked`, not `completed`.

Parallelism should be conditional. It is useful for independent read-only research or isolated worktrees on a PC, but it increases memory, token cost, merge complexity, and failure surface. Termux should default to sequential execution and bounded logs. A reviewer should not share write permissions with a coder unless the workflow explicitly requires it.

Autonomous repair should be iterative but bounded. The agent should reflect on the exact failure, change one focused hypothesis at a time, rerun the smallest relevant test, and escalate when the same failure repeats. It should never hide a failure by weakening an assertion or marking an unsupported action successful.

## References

[1]: https://arxiv.org/html/2603.11445v1 "Verified Multi-Agent Orchestration: A Plan-Execute-Verify-Replan Framework for Complex Query Resolution"
[2]: https://arxiv.org/html/2601.13671 "The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption"
[3]: https://addyosmani.com/blog/code-agent-orchestra/ "The Code Agent Orchestra - what makes multi-agent coding work"

## Additional self-healing and async findings

Additional 2026 research reinforces that retry-only behavior is not enough. A self-healing orchestrator should classify observable failures, choose targeted recovery actions under explicit budgets, verify the recovered result, and record an auditable trace. A repair loop must bind its verification evidence to the exact code state that was tested; otherwise a later edit can make an old passing trace misleading. This supports storing a source-state fingerprint, command, exit code, artifact hash, and changed-file set with each verification record.

Long-running agent workflows should persist active execution state before each meaningful side effect, not only conversation text. Durable state should include working memory, current step, previous step output, tool/process state where possible, approvals, artifacts, provider route, retry budget, and a checkpoint chain. External mutations need idempotency keys based on run/step/action identity, because a transport timeout can otherwise cause duplicate effects on retry. Read-only actions may use cached evidence; mutation actions require stronger approval and deduplication.

A practical NEXUS recovery ladder is: retry transient local/network failures with bounded jitter; honor provider `Retry-After`; open a route circuit and switch only to a compatible healthy provider route; use cached evidence for read-only inspection; reduce reasoning/tool scope on constrained Termux; pause durably for approval; then move unrecoverable work to a dead-letter or blocked state. Repeated same-error loops must stop rather than consume unlimited tokens.

These findings add three concrete next steps: introduce state-bound verification receipts, add idempotency metadata to future external-action adapters, and persist approval waits as resumable task states rather than keeping a live process blocked.

## Additional references

[4]: https://arxiv.org/abs/2606.01416 "Self-Healing Agentic Orchestrators for Reliable Tool-Augmented Large Language Model Systems"
[5]: https://arxiv.org/abs/2607.24604 "Looping Is Not Reliability: State-Bound Evidence and Typed Revision Contracts for Agentic Code Repair"
[6]: https://www.augmentcode.com/guides/async-ai-agent-workflows "How Async AI Agent Workflows Survive Failures"
