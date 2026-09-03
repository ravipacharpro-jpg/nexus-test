import { wordmark } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmarkLines(pad = "") {
  const left = `${dim}${wordmark.slice(0, 3)}${reset}`
  const right = `${bold}${wordmark.slice(4)}${reset}`
  return [pad, `${pad}${left} ${right}`, pad, pad]
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmarkLines("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}nexus -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
