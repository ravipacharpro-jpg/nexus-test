#!/usr/bin/env node
// Portable Playwright MCP launcher for NEXUS.
// NEXUS spawns THIS script (cross-platform via `node`). It detects the platform and
// runs the Playwright MCP server the right way:
//   - Termux / Android: inside a proot-distro Ubuntu container (where process.platform === "linux",
//     so Playwright's Chromium actually runs). A one-time bootstrap installs Ubuntu + Chromium there.
//   - Windows / macOS / Linux desktop: directly via `npx -y @playwright/mcp` (auto-installs).
// All CLI args from the NEXUS mcp config are forwarded unchanged.
//
// Launcher-only flag (stripped before forwarding to the server):
//   --warmup   After the MCP initialize handshake, pre-launch Chromium by navigating to
//              about:blank, so the agent's first real navigation is instant. Harmless if it fails.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const WARMUP = args.includes("--warmup");
const serverArgs = args.filter((a) => a !== "--warmup");

const WARMUP_ID = 990001;

// Auto handoff: when the agent navigates to a login/OAuth/captcha URL, open it in
// the user's REAL phone/desktop browser so they can authenticate there, with zero
// agent guesswork. Heuristic only (URL patterns) — never blocks the headless flow.
const AUTH_URL_RE = /login|signin|sign-in|oauth|auth|account|sso|consent|captcha|callback|connect/i;
function isAuthUrl(url) {
  if (!url || /^data:|^about:/.test(url)) return false;
  return AUTH_URL_RE.test(url);
}
function openInPhoneBrowser(url) {
  console.error("browser-mcp-launcher: auth URL detected -> opening in your real browser for login: " + url);
  if (isAndroid()) {
    spawn("termux-open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "linux") spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

function isAndroid() {
  if (process.platform === "android") return true;
  try {
    return spawnSync("proot-distro", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

// Proxy the MCP stdio channel between NEXUS (parent) and the Playwright MCP server (child).
// When WARMUP is on, after the first `initialize` request we inject a throwaway
// `browser_navigate about:blank` and swallow its response, pre-launching Chromium.
function launch(cmd, cmdArgs) {
  const child = spawn(cmd, cmdArgs, { stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.pipe(process.stderr);

  let warmupSent = false;
  const openedAuthUrls = new Set();

  // child stdout -> parent stdout (drop the warmup response)
  let cout = "";
  child.stdout.on("data", (d) => {
    cout += d.toString();
    let i;
    while ((i = cout.indexOf("\n")) >= 0) {
      const line = cout.slice(0, i).replace(/\r$/, "");
      cout = cout.slice(i + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === WARMUP_ID) continue;
      } catch {}
      process.stdout.write(line + "\n");
    }
  });

  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    console.error("browser-mcp-launcher: failed to start", cmd, cmdArgs.join(" "), err.message);
    process.exit(1);
  });

  // parent stdin -> child stdin (inject warmup after first initialize)
  let pin = "";
  process.stdin.resume();
  process.stdin.on("data", (d) => {
    pin += d.toString();
    let i;
    while ((i = pin.indexOf("\n")) >= 0) {
      const line = pin.slice(0, i).replace(/\r$/, "");
      pin = pin.slice(i + 1);
      if (!line.trim()) continue;
      child.stdin.write(line + "\n");
      if (WARMUP && !warmupSent) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            warmupSent = true;
            child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");
            child.stdin.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: WARMUP_ID,
                method: "tools/call",
                params: { name: "browser_navigate", arguments: { url: "about:blank" } }
              }) + "\n"
            );
          }
        } catch {}
      }
      // Auto handoff for login/OAuth/captcha URLs.
      try {
        const msg = JSON.parse(line);
        if (msg.method === "tools/call" && msg.params && msg.params.name === "browser_navigate") {
          const url = (msg.params.arguments && msg.params.arguments.url) || "";
          if (isAuthUrl(url) && !openedAuthUrls.has(url)) {
            openedAuthUrls.add(url);
            openInPhoneBrowser(url);
          }
        }
      } catch {}
    }
  });
}

if (isAndroid()) {
  // Termux/Android: self-heal only if the environment looks incomplete, so normal
  // startup stays fast (no apt/network on every launch).
  const ready = spawnSync(
    "proot-distro",
    ["login", "ubuntu", "--", "bash", "-c", "command -v playwright-mcp >/dev/null && test -n \"$(ls -d $HOME/.cache/ms-playwright/chromium* 2>/dev/null)\""],
    { stdio: "ignore" }
  ).status === 0;
  if (!ready) {
    const ensureScript = fileURLToPath(new URL("./ensure-browser-env.sh", import.meta.url));
    console.error("browser-mcp-launcher: browser env incomplete, running ensure-browser-env.sh ...");
    const ensureResult = spawnSync("bash", [ensureScript], { stdio: "inherit" });
    if (ensureResult.status !== 0) {
      console.error("browser-mcp-launcher: ensure-browser-env.sh failed; attempting to start server anyway.");
    }
  }
  // Prefer the global bin; fall back to npx.
  let bin = "npx";
  let binArgs = ["-y", "@playwright/mcp"];
  const r = spawnSync("proot-distro", ["login", "ubuntu", "--", "bash", "-c", "command -v playwright-mcp"], { encoding: "utf8" });
  const found = (r.stdout || "").trim();
  if (found) {
    bin = "playwright-mcp";
    binArgs = [];
  }
  launch("proot-distro", ["login", "ubuntu", "--", bin, ...binArgs, ...serverArgs]);
} else {
  // Desktop (win32/darwin/linux): run directly.
  launch("npx", ["-y", "@playwright/mcp", ...serverArgs]);
}
