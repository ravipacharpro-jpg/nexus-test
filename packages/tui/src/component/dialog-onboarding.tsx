// OnboardingDialog — first-run guided tour for new NEXUS users.
// Shows on first launch (no provider connected AND tour not yet
// completed) and teaches the 3 most important keyboard shortcuts
// in three short screens.
//
// The tour is intentionally short: more than 3 screens and users
// skip it. Each screen has a concrete next-action button so the
// user can either explore the feature or skip the tour entirely.

import { createSignal, For, Show } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"

const STEPS = [
  {
    title: "Welcome to NEXUS",
    body: "NEXUS is an AI agent for your terminal. This quick tour will teach you the three shortcuts that cover 90% of what you'll do every day. Press Enter or → to continue, Esc to skip.",
    cta: "Next",
  },
  {
    title: "Switch models on the fly",
    body: "Press Ctrl+P to open the command palette, then pick a model — or open the new 'Top 3 Best' section to see the three fastest free models that are available right now, live-checked against your providers and the vault.",
    cta: "Try it",
    shortcut: "ctrl+p",
  },
  {
    title: "Add a provider without leaving the chat",
    body: "Need a different model? Ctrl+P → Provider lets you paste an API key inline. Vault farm keys are detected automatically. The status bar at the bottom shows how many active keys and how many tokens you've spent today.",
    cta: "Connect a provider",
    shortcut: "ctrl+p → Provider",
  },
  {
    title: "You're ready",
    body: "That's it. Type anything in the prompt at the bottom to start a conversation. Press F1 at any time to revisit this tour, or /help inside the prompt for slash commands.",
    cta: "Start chatting",
  },
] as const

export function OnboardingDialog() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const kv = useKV()
  const [step, setStep] = createSignal(0)

  const current = () => STEPS[step()] ?? STEPS[0]
  const isLast = () => step() === STEPS.length - 1

  function dismiss() {
    kv.set("onboarding_completed", true)
    dialog.clear()
  }

  function next() {
    if (isLast()) {
      dismiss()
      return
    }
    setStep(step() + 1)
  }

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
      <text fg={theme.primary}>
        Step {step() + 1} of {STEPS.length} · {current().title}
      </text>
      <text fg={theme.text}>{current().body}</text>
      <Show when={"shortcut" in current()}>
        <text fg={theme.textMuted}>Shortcut: {(current() as { shortcut: string }).shortcut}</text>
      </Show>
      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={theme.text}>
          <span style={{ fg: theme.success }}>[Enter]</span> {current().cta}
        </text>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.textMuted }}>[Esc]</span> Skip tour
        </text>
      </box>
      <box flexDirection="row" gap={1} marginTop={1}>
        <For each={STEPS}>
          {(_, i) => (
            <text fg={i() === step() ? theme.primary : theme.textMuted}>{i() === step() ? "●" : "○"}</text>
          )}
        </For>
      </box>
    </box>
  )
}
