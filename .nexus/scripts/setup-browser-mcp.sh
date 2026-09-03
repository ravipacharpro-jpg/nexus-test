#!/bin/sh
# Configure the Playwright browser MCP in NEXUS's ACTUAL config store.
#
# IMPORTANT: this NEXUS build reads MCP servers from ~/.config/nexus/nexus.jsonc
# (managed via `nexus mcp add`), NOT from .nexus/opencode.jsonc. So `opencode.jsonc`
# is only useful for source builds; for the installed binary you must run this once.
set -e
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
nexus mcp add playwright -- node "$DIR/browser-mcp-launcher.mjs" --browser chromium --no-sandbox --headless --mobile --warmup
echo "browser MCP configured. Verify with: nexus mcp list"
