// Standalone deep e2e for the browser MCP launcher (NEXUS harness / CI).
// Spawns the portable launcher the same way NEXUS would, performs an MCP
// initialize handshake, lists tools, navigates a page, and snapshots it.
import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"

const LAUNCHER = new URL("./browser-mcp-launcher.mjs", import.meta.url).pathname
const args = ["--browser", "chromium", "--no-sandbox", "--headless", ...process.argv.slice(2)]

const child = spawn("node", [LAUNCHER, ...args], { stdio: ["pipe", "pipe", "pipe"] })

let buf = ""
const responses = new Map()
const pending = []
function onLine(line) {
  const t = line.trim()
  if (!t.startsWith("{")) return
  try {
    const msg = JSON.parse(t)
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      responses.set(msg.id, msg)
    }
  } catch {}
}

child.stdout.on("data", (d) => {
  buf += d.toString()
  let i
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    onLine(line)
  }
})
child.stderr.on("data", (d) => process.stderr.write("[srv] " + d.toString()))

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + "\n")
}
const wait = (id, ms = 40000) =>
  new Promise((res, rej) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (responses.has(id)) {
        clearInterval(iv)
        res(responses.get(id))
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv)
        rej(new Error("timeout waiting for id " + id))
      }
    }, 100)
  })

let failed = false
try {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } })
  const init = await wait(1)
  if (init.error) throw new Error("initialize failed: " + JSON.stringify(init.error))
  console.log("INIT: ok")

  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  const tools = await wait(2)
  if (tools.error) throw new Error("tools/list failed: " + JSON.stringify(tools.error))
  const names = (tools.result.tools || []).map((t) => t.name)
  if (!names.includes("browser_navigate")) throw new Error("browser_navigate not in tools: " + names.join(","))
  console.log("TOOLS: " + names.length + " tools, browser_navigate present")

  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "browser_navigate", arguments: { url: "data:text/html,<h1>e2e-ok</h1>" } } })
  const nav = await wait(3)
  if (nav.error) throw new Error("browser_navigate failed: " + JSON.stringify(nav.error))
  console.log("NAVIGATE: ok")

  send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "browser_snapshot" } })
  const snap = await wait(4)
  if (snap.error) throw new Error("browser_snapshot failed: " + JSON.stringify(snap.error))
  const text = JSON.stringify(snap.result)
  if (!/e2e-ok/i.test(text)) throw new Error("snapshot did not contain expected content")
  console.log("SNAPSHOT: contains expected content")
  console.log("PASS: browser MCP launcher + server + Chromium work end-to-end")
} catch (e) {
  failed = true
  console.error("FAIL: " + e.message)
  log("FAIL " + e.message)
} finally {
  child.kill("SIGKILL")
  process.exit(failed ? 1 : 0)
}
