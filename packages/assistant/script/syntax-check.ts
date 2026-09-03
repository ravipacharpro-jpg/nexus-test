const files = [
  "src/index.ts",
  "src/core/types.ts",
  "src/core/adaptive.ts",
  "src/core/security.ts",
  "src/core/style.ts",
  "src/core/plugin-manager.ts",
  "src/core/orchestrator.ts",
  "src/plugins/codegen.ts",
  "src/plugins/devtools.ts",
  "src/plugins/recovery.ts",
  "src/plugins/workspace.ts",
  "src/plugins/termux.ts",
  "src/plugins/translator.ts",
  "src/plugins/gitpro.ts",
  "src/plugins/cpanel.ts",
  "src/plugins/deploy.ts",
  "src/plugins/webtest.ts",
  "src/plugins/copilot.ts",
  "src/plugins/integrations.ts",
  "src/plugins/voice.ts",
  "src/plugins/bg.ts",
  "src/plugins/security.ts",
  "src/plugins/daemon.ts",
]

const transpiler = new Bun.Transpiler({ loader: "ts" })
let failed = 0
for (const file of files) {
  try {
    await transpiler.transform(await Bun.file(file).text())
    console.log("ok   " + file)
  } catch (error) {
    failed++
    console.log("FAIL " + file + " → " + error.message)
  }
}
process.exit(failed === 0 ? 0 : 1)
