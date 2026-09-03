import { RGBA, TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"
import { selectedForeground, useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useBindings } from "../keymap"

export type SteeringChoice = "replace" | "queue"

const PAD_X = 3

export type DialogSteeringChoiceProps = {
  onClose?: (choice?: SteeringChoice) => void
}

/**
 * Explicit user choice for a change/replan request issued while a task is
 * active. Nothing happens to the running task until the user picks one of the
 * two options; dismissing keeps everything untouched.
 */
export function DialogSteeringChoice(props: DialogSteeringChoiceProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const [selected, setSelected] = createSignal<SteeringChoice>("replace")

  const close = (choice?: SteeringChoice) => {
    props.onClose?.(choice)
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      {
        key: "left",
        desc: "Previous steering option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "queue" ? "replace" : "queue")),
      },
      {
        key: "right",
        desc: "Next steering option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "replace" ? "queue" : "replace")),
      },
      {
        key: "tab",
        desc: "Next steering option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "replace" ? "queue" : "replace")),
      },
      {
        key: "return",
        desc: "Confirm steering option",
        group: "Dialog",
        cmd: () => close(selected()),
      },
    ],
  }))

  return (
    <box zIndex={1} paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Change requested for running task
        </text>
        <text fg={theme.textMuted} onMouseUp={() => close()}>
          esc
        </text>
      </box>
      <box gap={0}>
        <text fg={theme.textMuted}>Keep and queue: current task finishes first, then your message runs.</text>
        <text fg={theme.textMuted}>Cancel and replace: current task stops now, then your message runs.</text>
      </box>
      <box paddingBottom={1} />
      <box flexDirection="row" justifyContent="space-between">
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === "replace" ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
          onMouseOver={() => setSelected("replace")}
          onMouseUp={() => close("replace")}
        >
          <text
            fg={selected() === "replace" ? fg : theme.text}
            attributes={selected() === "replace" ? TextAttributes.BOLD : undefined}
          >
            cancel &amp; replace
          </text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === "queue" ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
          onMouseOver={() => setSelected("queue")}
          onMouseUp={() => close("queue")}
        >
          <text
            fg={selected() === "queue" ? fg : theme.text}
            attributes={selected() === "queue" ? TextAttributes.BOLD : undefined}
          >
            keep &amp; queue
          </text>
        </box>
      </box>
    </box>
  )
}

DialogSteeringChoice.show = (dialog: DialogContext) => {
  return new Promise<SteeringChoice | undefined>((resolve) => {
    dialog.replace(
      () => <DialogSteeringChoice onClose={(choice) => resolve(choice)} />,
      () => resolve(undefined),
    )
  })
}
