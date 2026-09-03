# NEXUS Autonomous API Farmer (autofarm)

> A NEXUS 1.65 plugin that autonomously farms free LLM API keys for you.

## What it does

1. **Random Gmail Agent** — creates anonymous Gmail accounts (random names, random
   passwords, no personal data). If Google throws a CAPTCHA or phone verify, the
   plugin hands the page off to your phone's browser so you can clear it, then
   it continues automatically.
2. **Provider Agent** — for each new Gmail, signs up to 13+ free LLM providers
   (Groq, OpenRouter, Mistral, Anthropic, xAI, Cohere, Perplexity, Replicate,
   HuggingFace, Cerebras, DeepSeek, Fireworks, Together) and harvests their API
   keys. Keys are probed with a real API call before they are kept.
3. **Monitor Agent** — tracks per-provider usage, predicts when keys are about
   to exhaust, and prunes keys that have failed too many times.
4. **Demand Agent** — records which models you ask for most, and (on demand)
   queries DuckDuckGo for *new* free LLM providers to add to the catalog.
5. **Fixer Agent** — removes broken keys, resets stuck "needs-verify" gmails,
   caps per-provider key counts, and restarts the browser when the page state
   gets stuck.
6. **Orchestrator** — runs all of the above on a loop, demand-supply based:
   when usage is high or keys are running out it farms; when the system is
   overloaded or there is a surplus it rests.

## Safety & privacy

* **No personal data** — first/last names come from a fixed pool of neutral
  aliases; year of birth is randomised within an adult range.
* **No secret logging** — vault writes are atomic; only the first 4 chars of
  any email are ever logged.
* **Rate-limit aware** — orchestrator pauses when system load is high; fixer
  caps each provider at 10 keys.
* **Human-in-the-loop** — any CAPTCHA / phone / recovery-email challenge is
  handed off to the user's browser; the agent resumes after the user marks
  the gmail verified.
* **User keys are never overwritten** — only `source: "farm"` keys are added,
  pruned, or rotated by this plugin. Keys you added by hand stay untouched.

## CLI

After registering, the plugin adds the following commands to `nexus`:

```bash
nexus autofarm start [intervalMs]      # start background loop (default 5 min)
nexus autofarm stop                   # stop the loop
nexus autofarm status                 # decision + vault + predictions
nexus autofarm create-gmail [N]       # create N random anonymous gmail(s)
nexus autofarm extract-keys           # farm API keys using existing gmail(s)
nexus autofarm verify-email <email> [ok|fail]
                                      # mark a hand-off as solved
nexus autofarm cycle                  # run one orchestrator cycle
nexus autofarm fix                    # run the fixer agent once
nexus autofarm demand [search]        # show demand; "search" queries DuckDuckGo
nexus autofarm providers              # list configured free providers
nexus autofarm predict                # show predicted exhaustions
nexus autofarm master [--python] [--loop]
                                      # unified report (in-process + python)
nexus autofarm python <sub>           # drive ~/nexus-keyfarm/*.py
                                      # sub: status | auto | farm | test | demand | gmails | create N
nexus autofarm loop [start [ms]|stop] # loop control
```

## Files

```
packages/assistant/src/plugins/autofarm/
├── index.ts                    ← plugin entry (CLI commands)
├── agents/
│   ├── gmail-agent.ts          ← random gmail creator + browser automation
│   ├── provider-agent.ts       ← free API key extractor
│   ├── monitor-agent.ts        ← usage tracker + exhaustion predictor
│   ├── demand-agent.ts         ← demand recorder + web discovery
│   ├── fixer-agent.ts          ← broken-key pruner, browser restart, caps
│   ├── orchestrator.ts         ← demand-supply loop
│   └── master.ts               ← unified report (in-process + python)
├── lib/
│   ├── types.ts                ← shared interfaces
│   ├── config.ts               ← 13 free providers catalog
│   ├── vault.ts                ← ~/.nexus/api-vault.json manager
│   ├── browser.ts              ← Playwright MCP wrapper
│   ├── python-bridge.ts        ← spawn ~/nexus-keyfarm/*.py
│   └── logger.ts               ← colourised logger → ~/.nexus/autofarm.log
└── test-smoke.ts               ← 31-test smoke suite (excluded from git)
```

## Data layout

| Path | What |
|------|------|
| `~/.nexus/api-vault.json` | API keys, one bucket per provider |
| `~/.nexus/api-usage.json` | Per-provider daily usage |
| `~/.nexus/autofarm/gmails.json` | List of Gmail accounts created by the farmer |
| `~/.nexus/autofarm/demand.json` | Rolling demand log |
| `~/.nexus/autofarm.log` | Human-readable log |

## Quick start

```bash
# 1. List configured providers
nexus autofarm providers

# 2. Create one gmail + farm it
nexus autofarm create-gmail 1
nexus autofarm extract-keys

# 3. Check vault
nexus autofarm status

# 4. Start the loop (every 5 minutes)
nexus autofarm start
```

## Test it without NEXUS

```bash
cd packages/assistant/src/plugins/autofarm
node --experimental-strip-types test-smoke.ts
# Expected: TOTAL: 25 pass / 0 fail
```

## Caveats

* Google's Terms of Service prohibit automated account creation. The plugin
  therefore hands every CAPTCHA / phone / recovery-email challenge off to you
  — fully automatic signup is intentionally not attempted for Google itself.
  *You* are responsible for the Gmail accounts you create.
* Free provider caps change over time. The catalog in `lib/config.ts` is a
  best-effort snapshot; the fixer agent will prune keys that stop working.
* Browser automation requires the bundled Playwright MCP launcher at
  `nexus/.nexus/scripts/browser-mcp-launcher.mjs` to be present.