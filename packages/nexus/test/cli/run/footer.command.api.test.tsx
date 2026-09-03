/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  RUN_COMMAND_PANEL_ROWS,
  apiOnboardingEntries,
  RunApiOnboardingBody,
  RunCommandMenuBody,
} from "@/cli/cmd/run/footer.command"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"

test("Ctrl+P exposes Add API key adjacent to Switch model", async () => {
  const [commands] = createSignal(undefined)
  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunCommandMenuBody
          theme={() => RUN_THEME_FALLBACK.footer}
          commands={commands}
          subagents={() => []}
          queued={() => []}
          variants={() => []}
          variantCycle=""
          onClose={() => {}}
          onModel={() => {}}
          onAddApi={() => {}}
          onEditor={() => {}}
          onSkill={() => {}}
          onSubagent={() => {}}
          onQueued={() => {}}
          onVariant={() => {}}
          onVariantCycle={() => {}}
          onCommand={() => {}}
          onNew={() => {}}
          onExit={() => {}}
        />
      </box>
    ),
    { width: 100, height: RUN_COMMAND_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Switch model")
    expect(frame).toContain("Add API key")
    expect(frame.indexOf("Switch model")).toBeLessThan(frame.indexOf("Add API key"))
  } finally {
    app.renderer.destroy()
  }
})

test("Add API provider selector lists supported and custom options without accepting a secret", async () => {
  const entries = apiOnboardingEntries()
  expect(entries.find((item) => item.providerID === "cloudflare-workers-ai")?.providerLabel).toBe("Cloudflare Workers AI")
  expect(entries.find((item) => item.providerID === "custom")).toMatchObject({ setup: "custom-config" })

  const app = await testRender(
    () => (
      <box width={100} height={RUN_COMMAND_PANEL_ROWS}>
        <RunApiOnboardingBody theme={() => RUN_THEME_FALLBACK.footer} onClose={() => {}} onSelect={() => {}} />
      </box>
    ),
    { width: 100, height: RUN_COMMAND_PANEL_ROWS },
  )

  try {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("Add API key")
    expect(frame).toContain("No API key is requested")
    expect(frame).toContain("OpenAI")
  } finally {
    app.renderer.destroy()
  }
})
