#!/bin/sh
# Install OmniRoute — the Free AI Gateway.
# After this, `omniroute` boots a local server on http://localhost:20128/v1.
# Model 'auto' includes the KEYLESS NEXUS Free Gateway → works with NO API key, NO signup.
# Source is NOT vendored (keeps repo tiny); this pulls the published npm package.
set -e
echo "Installing OmniRoute (Free AI Gateway) via npm..."
npm i -g omniroute
echo "Done. Now start it:  bash scripts/start-omniroute.sh   (or run /omniroute in NEXUS)"
