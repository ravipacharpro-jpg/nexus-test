# NEXUS Always-On Agent Gateway Architecture

## Scope

This document specifies the second, opt-in layer of the NEXUS agent platform. It adds Telegram, Discord, and Slack ingress; remote schedule execution; cross-device access to selected memory scopes; and controlled remote status/actions. It does not replace the local-first SQLite foundation introduced in `v0.1.58`.

The gateway is deployed only when the owner explicitly enables a channel and provides that channel's own token or OAuth connection. It never auto-creates social accounts, discovers tokens, bypasses login/OTP/CAPTCHA challenges, imports browser sessions, or silently turns on a 24×7 daemon.

## Gateway boundaries

The gateway is a small, separately deployable Node service named `agent-gateway`. It owns public HTTPS endpoints, channel signature verification, inbound idempotency, outbound delivery audit, scheduler claims, and remote policy enforcement. The existing `agent-platform` store remains the source of truth for memory, learning, runs, and schedules. A gateway deployment uses a durable server-side database configured for that deployment; it does not copy arbitrary local files from a phone or desktop.

| Boundary | Gateway responsibility | Explicitly excluded |
|---|---|---|
| Ingress | Verify raw request authenticity and normalize one message envelope | Treating a raw webhook as trusted before verification |
| Identity | Map approved channel users and conversations to a NEXUS scope | Impersonating users or accepting every public message by default |
| Orchestration | Create a durable run and enforce the same run policy as local CLI | Bypassing confirmation or budget limits |
| Delivery | Send auditable progress/results to the original channel | Sending arbitrary unsolicited messages |
| Scheduling | Claim a due schedule once and record its result | Hidden boot services, endless retries, or a schedule enabled by default |
| Synchronization | Replicate only owner-approved memory scopes | Automatic migration of all device data to a server |

## Common channel envelope

Every verified channel event is converted to the same record before it reaches NEXUS logic.

```ts
type GatewayInboundV1 = {
  schemaVersion: 1
  channel: "telegram" | "discord" | "slack"
  connectionId: string
  eventId: string
  senderId: string
  conversationId: string
  receivedAt: number
  text?: string
  command?: string
  rawRetention: "none" | "redacted"
}
```

`eventId` is unique for `(channel, connectionId)` and is stored before dispatch. A duplicate delivery returns an acknowledgement but never creates a second run. `senderId` and `conversationId` are matched against the connection's explicit allowlist. Unknown senders receive no task execution.

All text is redacted before durable memory, learning proposals, or audit summaries. The raw signed body is kept only in process memory long enough to verify the provider request; it is not written to a learning record or vector index.

## Provider verification contracts

Telegram uses HTTPS webhooks. The owner configures a per-connection secret token; ingress compares it in constant time against the `X-Telegram-Bot-Api-Secret-Token` header. Telegram documents that webhook delivery uses HTTPS POST and that `secret_token` is returned in that header for verification; it also provides monotonically useful `update_id` values for duplicate handling.[1]

Discord uses either a Gateway socket or HTTP interaction endpoint. NEXUS uses HTTP interactions first because the request is independently verifiable. The endpoint validates `X-Signature-Ed25519` and `X-Signature-Timestamp` against the raw body before parsing, acknowledges Discord `PING` requests, and rejects invalid signatures with `401`.[2]

Slack verifies the raw body with `X-Slack-Signature`, `X-Slack-Request-Timestamp`, and the app signing secret. NEXUS rejects stale timestamps beyond five minutes and uses a timing-safe comparison, matching Slack's request-verification guidance.[3]

Outgoing messages use provider-specific send APIs only after the linked NEXUS run has produced a permitted status update or response. The gateway stores a masked credential reference, not a token, in `agent_adapter_connection`; actual values remain in the server credential store.

## Remote command policy

Remote commands are divided into three classes. Read-only tasks such as `memory search`, `run list`, and `status` may return after sender allowlist validation. Local project writes, deployment, browser interaction, external API mutations, and schedule enablement create a confirmation request; they never execute solely because a message was received. Sensitive actions remain unavailable through channel text alone.

The first gateway release supports a small command allowlist: `status`, `memory search`, `learning list`, `run list`, `schedule list`, `task propose`, and `cancel own-run`. A later command can expand only after an adapter policy review and tests cover both rejection and authorization paths.

## Scheduler and durable execution

The gateway scheduler polls the durable schedule store on a bounded interval with a transactional lease. It claims one due execution through an idempotency key `(schedule_id, scheduled_window)`, creates an `agent_run` using the schedule policy, and writes an `agent_schedule_execution` record before running work. It applies a maximum retry count and exponential backoff. Disabled schedules are never considered due.

The local CLI may create a schedule definition, but it cannot cause a persistent service to start. Moving a schedule to gateway execution is a separate, explicit enable action showing the target timezone, allowed command class, model/budget policy, and maximum concurrency.

## Cross-device memory

Cross-device synchronization is opt-in by memory scope. The owner selects a device, project, or channel scope and starts a one-time sync handshake. Each memory record retains source device, version, content hash, and tombstone state. Conflict resolution is append-only: a newer conflicting fact creates a superseding revision rather than erasing history. The gateway never synchronizes API-vault keys, credential store values, browser data, local shell history, or arbitrary project files.

## Default local mode and optional hosted mode

NEXUS creates gateway connections in **local** mode by default. A local gateway listens only on `127.0.0.1` or `::1`, is started explicitly in the foreground by its user, writes a private runtime-state file, and stops on `Ctrl+C` or a deliberate stop command. It never installs a boot receiver, wake lock, permanent daemon, public tunnel, or paid service. For a local Telegram bot, the user stores its token through the encrypted interactive credential prompt and starts `nexus agent gateway telegram-poll <connection-id>`; the foreground poller uses Telegram's documented `getUpdates` path and turns only allowed, deduplicated updates into bounded NEXUS run plans. Discord and Slack require a reachable signed HTTP endpoint for live interactions, so they remain suitable for the opt-in hosted profile or an owner-managed reverse proxy.[1] [2] [3]

A connection becomes **hosted** only when its owner explicitly selects that profile during registration. That profile is metadata and deployment guidance—not an implicit hosting purchase or remote process. Its credential reference must point to the deployment's own server-side credential store. A local listener refuses to serve a hosted connection, preventing accidental cross-mode activation.

## Deployment choices

The same gateway contracts support two operational modes. A user-started local gateway is useful for development and requires the computer or Termux environment to stay awake. A hosted gateway is required for reliable 24×7 public webhooks and scheduled automation. The hosted service needs HTTPS, a durable database, server-side secret storage, controlled deployment logs, and an explicit owner-controlled enable/disable switch per channel.

The implementation begins with local contract tests and fake signed fixtures. Production adapter activation occurs only after the owner supplies the relevant bot/app credential through a secure connection setup. No real Telegram, Discord, or Slack message is sent during tests.

## Gateway storage additions

| Table | Purpose |
|---|---|
| `agent_adapter_connection` | Adapter metadata, allowed senders/scopes, and a credential-store reference |
| `agent_gateway_event` | Unique verified inbound event id and dispatch status |
| `agent_delivery` | Outbound delivery intent, provider message reference, and masked outcome |
| `agent_schedule_execution` | Lease, scheduled window, run id, retry count, and completion outcome |
| `agent_memory_replica` | Opt-in scope replication cursor and conflict watermark |

## Implementation sequence

1. Add provider-neutral gateway schemas, idempotency repository, connection state machine, and strict policy tests.
2. Add local fake adapters for Telegram, Discord, and Slack verification fixtures; prove no unsigned event reaches orchestration.
3. Add a user-started local gateway runtime for development with explicit `connect`, `status`, and `stop` commands.
4. Add hosted gateway deployment manifest, secret references, schedule lease worker, and remote audit dashboard.
5. Add production channel connection flows one provider at a time, beginning with Telegram, then Discord, then Slack.

## References

[1] [Telegram Bot API — updates and `setWebhook`](https://core.telegram.org/bots/api#setwebhook)

[2] [Discord Developer Docs — Interactions Overview](https://docs.discord.com/developers/interactions/overview)

[3] [Slack Developer Docs — Verifying requests from Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
