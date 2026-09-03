// OmniRoute — local keyless gateway for NEXUS.
// Listens on 127.0.0.1:20128 and reverse-proxies OpenAI-compatible requests to
// the keyless opencode.ai endpoint, so "omniroute" works WITHOUT any API key.
import http from "node:http"
import https from "node:https"
import { URL } from "node:url"

const UPSTREAM_BASE = "https://opencode.ai/zen"
const PORT = 20128
const HOST = "127.0.0.1"

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost")
  const target = new URL(UPSTREAM_BASE + url.pathname + url.search)
  const options = {
    method: req.method,
    hostname: target.hostname,
    port: target.port || 443,
    path: target.pathname + target.search,
    headers: { ...req.headers, host: target.host },
  }

  const upstreamReq = https.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers)
    upstreamRes.pipe(res)
  })

  upstreamReq.on("error", (e) => {
    res.writeHead(502, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "omniroute upstream failed", detail: String(e) }))
  })

  req.pipe(upstreamReq)
})

server.listen(PORT, HOST, () => {
  console.log(`[omniroute] keyless gateway listening on http://${HOST}:${PORT}`)
})
