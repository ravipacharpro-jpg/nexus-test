---
name: opencode-openrouter
description: Enable the OpenCode (keyless) and OpenRouter providers in NEXUS so both endpoints work without the dead local OmniRoute gateway
---
# /opencode-openrouter
Enable the OpenCode and OpenRouter providers in NEXUS.

## OpenCode (keyless, default)
- Built-in free gateway at `https://opencode.ai/zen/v1`. No API key required.
- Enabled by default; models are auto-discovered from the public endpoint.
- Switch models any time: `nexus config set model opencode/hy3-free`

## OpenRouter
- Built-in provider at `https://openrouter.ai/api/v1`. Requires an API key.
- Add a key (stored in the encrypted API vault, never printed to the terminal):
  `nexus api add openrouter <your-openrouter-key>`
- Then select any OpenRouter model, e.g. `openrouter/openai/gpt-4o-mini`
  or `openrouter/google/gemini-2.5-flash`.

## Why not OmniRoute?
- The old `omniroute` local gateway (`http://localhost:20128/v1`) is NOT bundled in this
  build — its launcher scripts (`install-omniroute.sh` / `start-omniroute.sh`) do not exist,
  so the gateway can never start. It has been replaced by the two first-class built-in
  providers above: OpenCode (keyless) and OpenRouter (bring your own key).
- Verify a key is healthy: `nexus api list` (prints status + health latency).
