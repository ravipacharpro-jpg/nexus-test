# NEXUS Reliability Audit

## Confirmed Findings and Completed Remediation

The initial audit confirmed that the Termux API package returned placeholder results rather than real Android command output. Phase A now wraps supported `termux-*` commands with native-Termux guards, a ten-second timeout, and an actionable `pkg install termux-api` message. APK metadata is an explicit optional user-space capability through `aapt dump badging`; if `aapt` is absent, NEXUS explains how to install it rather than fabricating a result.

Runtime classification now distinguishes native Termux from PRoot, Andronix, UserLAnd, WSL, macOS, Linux, and Windows. Android container markers take priority over inherited Termux paths so native-only commands are not attempted inside a container. The canonical `install.sh` now performs an idempotent native-Termux foundation bootstrap, including a Node.js fallback and required download tools, while retaining the verified glibc launcher path. The legacy `install-termux.sh` remains an optional broader foundation helper for bot-related Python packages.

Generated tools are executable Node, Python, or Bash entry points with JSON stdin/stdout contracts and a local `~/.nexus/tools/registry.json` record. Businessman logs now use professional English. The Phase A implementation retains the existing Smart Manager capacity logic, which already reads `/proc/meminfo` and process RSS where available and persists task records.

## Mobile Reliability Policy

Power status can come from `termux-battery-status`, Linux power files, or thermal zones. NEXUS throttles mobile work to one worker below twenty percent battery or above forty-five degrees Celsius, disables background agents under that policy, and recommends `llama3:8b` as a lightweight ARM64 mobile default without claiming unsupported quantization behavior. The shared device report also exposes explicit ARM64 metadata.

Before a download larger than 100 MB, NEXUS warns only when a native Termux Wi-Fi check indicates likely mobile data or cannot determine the network. The normal desktop path does not display a Termux warning. `nexus setup ollama` now uses `pkg`, Homebrew, or winget only where that package-manager route is explicit; other Linux, WSL, and Android container users receive a truthful manual-install instruction instead of an unreviewed remote script.

Wake locks, notifications, toasts, and the Termux:Boot helper are best-effort native-Termux integrations. The boot helper can attempt `termux-wake-lock`, but it explicitly states that the Termux:Boot companion app and Android battery settings are still required and that background survival is not guaranteed. Completion and failure alerts are best effort and never alter the task result.

## Safety Boundaries

Android data access must call only installed Termux:API commands, surface permission or command absence clearly, and never fabricate results. Background Android process survival cannot be guaranteed by a Node process; the product may offer best-effort wake-lock and Termux:Boot guidance but must not promise persistence. Cross-platform configuration and session synchronization, QR transfer, cloud clipboard, voice/camera features, widgets, and root-only work remain intentionally out of scope for this Phase A/B release.
