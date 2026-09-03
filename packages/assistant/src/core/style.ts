export const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
}

export const dim = (text: string) => `\x1b[90m${text}\x1b[0m`
export const ok = (text: string) => `\x1b[92m${text}\x1b[0m`
export const bad = (text: string) => `\x1b[91m${text}\x1b[0m`
export const bold = (text: string) => `\x1b[1m${text}\x1b[0m`

export const Icon = {
  success: "✅",
  fail: "❌",
  warn: "⚠️",
  info: "ℹ️",
  robot: "🤖",
  plugin: "📦",
  bug: "🐛",
  test: "🧪",
  eye: "👁️",
  rocket: "🚀",
  lock: "🔐",
  brain: "🧠",
}
