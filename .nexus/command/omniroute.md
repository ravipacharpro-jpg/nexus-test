---
name: omniroute
description: Launch the bundled OmniRoute Free AI Gateway locally (keyless, no API key) so the NEXUS provider omniroute/auto works on http://localhost:20128/v1
---
# /omniroute
Start the bundled OmniRoute Free AI Gateway:

1. If the `omniroute` binary is not installed, run `bash scripts/install-omniroute.sh`.
2. Run `bash scripts/start-omniroute.sh` to boot the gateway on http://localhost:20128/v1.
3. Verify it responds: `curl -s http://localhost:20128/v1/models`.

Once running, NEXUS's `omniroute/auto` model uses the **keyless "OpenCode Free"** provider —
free models with NO API key and NO signup. Together with the built-in default free API,
both providers work without any API. Keep the gateway running while using NEXUS.
