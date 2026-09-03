# NEXUS Browser Handoff Policy

## Purpose and default

NEXUS Browser Handoff is an **optional, local-first** bridge between an NEXUS task and a website the user is authorized to use. Its job is to open an explicit HTTPS page, describe the next safe step, pause, and resume only after the user confirms they are ready. It is not a hidden browser controller, password manager, credential extractor, or unattended RPA service.

The default on Android Termux is a simple browser handoff. NEXUS opens a user-approved URL through the local device, records only a redacted origin and task status, and waits for an explicit `resume` command. Termux:API is intended to expose Android capabilities to local command-line programs, but its permission model is significant and must not be used to silently exfiltrate terminal output or private browser state. [1] [2]

| Mode | Intended platform | What NEXUS does | What it never does |
| --- | --- | --- | --- |
| **Simple handoff** | Termux, Windows, macOS, Linux | Opens an approved HTTP(S) URL in the user's local browser and creates an awaiting-user checkpoint. | Reads browser cookies, scans browser pages, fills credentials, or sends a form. |
| **Isolated co-pilot** | Desktop only, explicitly authorized | Uses a dedicated NEXUS-owned browser profile or a user-started loopback connection for an approved task. | Opens the user's default browser profile, exports session data, bypasses authentication, or submits a consequential action. |
| **User-attached advanced session** | Desktop only, explicit local setup | Attaches only to a browser endpoint the user started on loopback and approved for the named target. | Exposes a remote debugging listener beyond loopback or treats attachment as permission to access unrelated tabs. |

Playwright supports isolated browser contexts, including non-persistent contexts that do not write browsing data, so the temporary profile option is the default for desktop co-pilot work. [3]

## Mandatory human checkpoints

NEXUS must stop and wait for a human whenever a workflow reaches authentication, an authentication factor, personal or regulated information, a financial action, an external mutation, or a legally meaningful declaration.

> `resume` means only: “I have completed the browser-only step and want NEXUS to show the next permitted instruction.” It does **not** prove that login succeeded and does not authorize NEXUS to act as the user.

| Step category | Permitted NEXUS assistance | Required user action |
| --- | --- | --- |
| Public page or official console page | Locate and open the verified URL; explain navigation. | Confirm the target is authorized. |
| Normal non-sensitive draft field | Suggest or prepare a draft from user-provided information; record no raw form values in audit logs. | Review and enter/confirm the value in the browser. |
| Login, password, passkey, OTP, authenticator, CAPTCHA, recovery code | Open the page and pause. | Complete it manually in the browser. |
| Government-form personal data, Aadhaar/PAN, health, tax, banking, payment, signature, declaration, final submission | Explain the next step and identify the official page. | Review, attest, and submit personally after an explicit confirmation. |
| Destructive or production mutation | Prepare a dry-run/preflight and show the precise intended effect. | Give a fresh explicit confirmation before any permitted local follow-up. |

NEXUS must never request, read, relay, store, or log passwords, session cookies, browser-storage values, OTPs, SMS/email codes, authenticator codes, CAPTCHA answers, recovery codes, biometric data, or a user’s normal-browser profile. It must never use stealth, automated CAPTCHA solving, browser-profile copying, background persistence, or a remote debug endpoint exposed off loopback.

## URL and audit handling

Each handoff must use a parsed `http:` or `https:` URL. The audit record stores a redacted origin/path classification, not raw query parameters or fragments. URLs containing token-like query keys such as `token`, `key`, `secret`, `code`, `password`, or `session` may be opened only for the user’s local browser after warning, but the parameter values must never be persisted in handoff, memory, task, telemetry, or sync records.

Every durable handoff record contains a random identifier, the sanitized origin, a short redacted purpose, a state, timestamps, and an append-only safe audit event. It contains no browser data, form values, credentials, or site responses. A handoff can transition only through `awaiting_user`, `resumed`, `completed_by_user`, `cancelled`, or `expired`; it cannot claim that an external website accepted a form.

## Direct links and discovery

For a public documentation page or an explicit URL supplied by the user, NEXUS may provide an official direct link. For session-dependent pages, it may provide an origin plus clear navigation instructions after the user has logged in. It must not guess private endpoint paths, crawl authenticated accounts, or assert that every website provides a stable direct deep link.

## Firebase module boundary

Firebase support is a separately optional module, not an implicit browser-handoff privilege. It may generate local project configuration, SDK integration, emulator guidance, rules drafts, deployment preflight, and official console links. It may not create billing obligations, enable paid products, download or retain a service-account private key, modify production rules, change OAuth consent, or deploy to production without a current, explicit user confirmation. Firebase secrets remain in the user’s existing secret-storage pathway and are excluded from memory-sync packs and browser audits.

## References

[1] [Termux:API repository — Android APIs exposed to local command-line programs](https://github.com/termux/termux-api)

[2] [Termux RUN_COMMAND intent documentation — permission and privacy considerations](https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent)

[3] [Playwright BrowserContext documentation — isolated non-persistent contexts](https://playwright.dev/docs/api/class-browsercontext)
