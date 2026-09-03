# NEXUS Assistant

On-demand assistant ecosystem for the NEXUS CLI. Natural language in, plugin routed work out — Hinglish/Urdu-English mixed commands supported.

## Design

- Zero-bloat: plugins load on first use, unload after idle (adaptive per device).
- Termux is a first-class citizen: memory limits, plugin caps and timeouts adapt automatically.
- Security-first: HITL gates, no passwords, no OTP interception, no CAPTCHA bypass.

## Usage

```bash
nexus "ek react app banao"              # natural language → codegen
nexus code generate "todo app" --out ./todo
nexus devtools env:scan                 # env detective
nexus devtools deps:check               # dependency doctor
nexus devtools api:scan ./src --format markdown
nexus recovery save "before-refactor"   # time machine
nexus recovery restore --latest
nexus workspace init && nexus workspace run all test
nexus translate --from python --to nodejs ./script.py
nexus gitpro commit                     # review + smart message + commit
nexus cpanel connect --host <host> --user <user>
nexus deploy ssh --host myserver.com --user deploy --local ./dist
nexus webtest run https://mysite.com --scenario smoke
nexus copilot do --url https://myhost.com:2083 "database banao"
nexus integrations connect github       # OAuth device flow
nexus termux notify "Build Complete"
nexus voice say "website test karo"
```

## Plugins

| Plugin | Purpose |
|--------|---------|
| codegen | project scaffolding (node-api, react, php+mysql login, static), dockerize, serve |
| devtools | Env Detective, Dependency Doctor, API route scanner |
| recovery | tar-based snapshots with restore |
| workspace | multi-project runner with parallel execution |
| termux | notifications, toast, battery, clipboard, APK inspect, extra-keys keyboard |
| translator | LLM code translation with offline fallback guidance |
| gitpro | pre-commit secret/debug review + conventional commit messages |
| cpanel | official UAPI client (API token only) |
| deploy | rsync/scp SSH deploys + git push + health checks |
| webtest | HTTP smoke/headers/image checks; full browser mode when playwright-core present |
| copilot | browser co-pilot, existing-profile session reuse, hard HITL pauses |
| integrations | OAuth device flow (GitHub implemented) |
| voice | Termux speech-to-text command loop |

## Optional dependencies

`playwright-core` unlocks browser testing and co-pilot. Without it, webtest degrades to HTTP-only checks and copilot explains what to install.
