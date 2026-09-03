#!/usr/bin/env bash
# Open a URL in the user's REAL phone/desktop browser (hybrid login handoff).
# The browser-mcp-launcher auto-calls this for login/OAuth/captcha URLs, but the
# agent can also call it directly when it discovers an auth link inside page text.
# Usage: phone-open.sh "<url>"
url="$1"
if [ -z "$url" ]; then echo "usage: phone-open.sh <url>" >&2; exit 1; fi
if command -v termux-open >/dev/null 2>&1; then
  termux-open "$url"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$url"
elif command -v open >/dev/null 2>&1; then
  open "$url"
else
  echo "phone-open.sh: no browser opener available on this platform" >&2
  exit 1
fi
