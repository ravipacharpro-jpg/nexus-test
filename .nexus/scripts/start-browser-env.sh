#!/usr/bin/env bash
# OPTIONAL: only for "watch the browser" mode (visible captcha inside the agent's
# own Chromium). The DEFAULT browser mode is HEADLESS and needs NONE of this.
#
# To use visible mode: (1) edit .nexus/opencode.jsonc mcp.playwright command to drop
# `--headless` and use ["proot-distro","login","ubuntu","--","env","DISPLAY=:0",
# "playwright-mcp","--browser","chromium","--no-sandbox"]; (2) run this script;
# (3) connect a VNC viewer on your phone to 127.0.0.1:5900; (4) run `nexus`.
#
# Normal (headless/autonomous) usage needs only: run `nexus`.
set -u

LOG_DIR="/data/data/com.termux/files/usr/tmp/nexus"
mkdir -p "$LOG_DIR"
echo "Starting persistent display session (Xvfb :0 + x11vnc :5900) inside Ubuntu..."
nohup proot-distro login ubuntu -- bash -c '
  pkill -x Xvfb 2>/dev/null; pkill -x x11vnc 2>/dev/null; sleep 1; rm -f /tmp/.X11-unix/X0
  Xvfb :0 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
  x11vnc -display :0 -nopw -listen 127.0.0.1 -forever >/tmp/vnc.log 2>&1 &
  echo "xvfb+x11vnc launched in container"
  wait
' >"$LOG_DIR/browser-env.log" 2>&1 &

sleep 4
echo "Launched (log: /tmp/browser-env.log). Verify with: bash .nexus/scripts/check-browser-env.sh"
echo "Then connect a VNC viewer on your phone to 127.0.0.1:5900 (no password; localhost only), and run: nexus"
