import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { TermuxAdapter } from "./TermuxAdapter"

export type ToolLanguage = "node" | "python" | "bash"

type ToolRegistryEntry = { name: string; description: string; path: string; language: ToolLanguage; runner: string }

const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`

const pythonJsonRunner = `import json, sys
try:
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else {}
    print(json.dumps({"ok": True, "tool": sys.argv[1], "description": sys.argv[2], "input": payload}))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error) or "Invalid JSON input"}), file=sys.stderr)
    sys.exit(1)`

export class ToolGenerator {
  static generateTool(name: string, description: string, language: ToolLanguage = "node") {
    if (!(["node", "python", "bash"] as const).includes(language)) throw new Error(`Unsupported tool language: ${language}`)
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "nexus-tool"
    const toolDir = join(TermuxAdapter.homePath, ".nexus", "tools", safeName)
    mkdirSync(toolDir, { recursive: true })

    const runners: Record<ToolLanguage, { filename: string; command: string; source: string; dependency: string }> = {
      node: {
        filename: "run.mjs",
        command: 'exec node "$DIR/run.mjs" "$@"',
        dependency: "node",
        source: `#!/usr/bin/env node
let raw = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { raw += chunk })
process.stdin.on("end", () => {
  try {
    const input = raw.trim() ? JSON.parse(raw) : {}
    process.stdout.write(JSON.stringify({ ok: true, tool: ${JSON.stringify(safeName)}, description: ${JSON.stringify(description)}, input }) + "\\n")
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Invalid JSON input" }) + "\\n")
    process.exitCode = 1
  }
})
`,
      },
      python: {
        filename: "run.py",
        command: 'exec python3 "$DIR/run.py" "$@"',
        dependency: "python3",
        source: `#!/usr/bin/env python3
${pythonJsonRunner.replace("sys.argv[1]", JSON.stringify(safeName)).replace("sys.argv[2]", JSON.stringify(description))}
`,
      },
      bash: {
        filename: "tool.sh",
        command: 'exec "$DIR/tool.sh" "$@"',
        dependency: "python3",
        source: `#!/usr/bin/env bash
set -euo pipefail
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\\n' '{"ok":false,"error":"Python 3 is required for Bash JSON I/O. Install it with: ${TermuxAdapter.packageManager} install python"}' >&2
  exit 1
fi
exec python3 -c ${shellQuote(pythonJsonRunner)} ${shellQuote(safeName)} ${shellQuote(description)}
`,
      },
    }
    const runner = runners[language]

    const installScript = `#!/bin/bash
set -euo pipefail
command -v ${runner.dependency} >/dev/null 2>&1 || { echo "${runner.dependency} is required. Install it with: ${TermuxAdapter.packageManager} install ${language === "node" ? "nodejs" : "python"}" >&2; exit 1; }
echo "${safeName}: no additional dependencies declared."
`
    writeFileSync(join(toolDir, "install.sh"), installScript, { mode: 0o755 })

    const runScript = `#!/bin/bash
set -euo pipefail
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
${runner.command}
`
    writeFileSync(join(toolDir, "run.sh"), runScript, { mode: 0o755 })
    writeFileSync(join(toolDir, runner.filename), runner.source, { mode: 0o755 })
    const registryPath = join(TermuxAdapter.homePath, ".nexus", "tools", "registry.json")
    let registry: ToolRegistryEntry[] = []
    try { registry = JSON.parse(readFileSync(registryPath, "utf8")) } catch {}
    registry = registry.filter((tool) => tool.name !== safeName)
    registry.push({ name: safeName, description, path: toolDir, language, runner: join(toolDir, "run.sh") })
    writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n")

    console.log(`[NEXUS] Tool '${safeName}' (${language}) created at ${toolDir}`)
    console.log(`To add to PATH, run: echo 'export PATH="$PATH:${toolDir}"' >> ~/.bashrc`)
  }
}
