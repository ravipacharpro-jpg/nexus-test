export type PromptSubmitKeyEvent = {
  name: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  super?: boolean
}

export function isPlainPromptSubmitKey(event: PromptSubmitKeyEvent): boolean {
  const name = event.name.toLowerCase()
  if (name !== "return" && name !== "enter") return false
  return !event.shift && !event.ctrl && !event.alt && !event.meta && !event.super
}
