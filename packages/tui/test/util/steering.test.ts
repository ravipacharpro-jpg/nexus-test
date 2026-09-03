import { expect, test } from "bun:test"
import {
  classifySteering,
  STEERING_ACK,
  steeringStatusLine,
  stripStopPhrase,
} from "../../src/util/steering"
import { liveActivity } from "../../src/util/activity"

test("classifies status questions while a task runs", () => {
  expect(classifySteering("status")).toBe("status")
  expect(classifySteering("Status update?")).toBe("status")
  expect(classifySteering("progress?")).toBe("status")
  expect(classifySteering("what's happening")).toBe("status")
  expect(classifySteering("kya ho raha hai?")).toBe("status")
  expect(classifySteering("kya chal raha hai")).toBe("status")
})

test("classifies stop/cancel requests", () => {
  expect(classifySteering("stop")).toBe("stop")
  expect(classifySteering("Stop it now!")).toBe("stop")
  expect(classifySteering("cancel that")).toBe("stop")
  expect(classifySteering("ruko")).toBe("stop")
  expect(classifySteering("band karo")).toBe("stop")
})

test("classifies change/replan requests", () => {
  expect(classifySteering("instead use bun")).toBe("change")
  expect(classifySteering("actually stop")).toBe("change")
  expect(classifySteering("wait no, do X")).toBe("change")
  expect(classifySteering("scratch that")).toBe("change")
  expect(classifySteering("badal do")).toBe("change")
})

test("ordinary follow-ups are not misclassified", () => {
  expect(classifySteering("please add tests for the parser module")).toBe("followup")
  // Only leading phrases count: these contain keywords deeper in the text.
  expect(classifySteering("how do I stop a service on linux")).toBe("followup")
  expect(classifySteering("the statusbar component flickers")).toBe("followup")
  expect(classifySteering("fix the bug\n\nby the way what's happening")).toBe("followup")
  expect(classifySteering("restart the dev server after changes")).toBe("followup")
  expect(classifySteering("")).toBe("followup")
})

test("stripStopPhrase preserves remaining content as the next prompt", () => {
  expect(stripStopPhrase("stop")).toBe("")
  expect(stripStopPhrase("cancel!")).toBe("")
  // Overlapping stop phrases: the longest leading phrase must win so no
  // phantom remainder ("now") survives as a next prompt.
  expect(stripStopPhrase("stop now")).toBe("")
  expect(stripStopPhrase("STOP NOW")).toBe("")
  expect(stripStopPhrase("stop it")).toBe("")
  expect(stripStopPhrase("cancel it")).toBe("")
  expect(stripStopPhrase("cancel that")).toBe("")
  expect(stripStopPhrase("cancel this")).toBe("")
  expect(stripStopPhrase("cancel the task")).toBe("")
  expect(stripStopPhrase("cancel task")).toBe("")
  expect(stripStopPhrase("abort")).toBe("")
  expect(stripStopPhrase("ruko")).toBe("")
  expect(stripStopPhrase("band karo")).toBe("")
  // A stop phrase followed by actual task text preserves only the task text.
  expect(stripStopPhrase("stop now, run the typecheck instead of lint")).toBe(
    "run the typecheck instead of lint",
  )
  expect(stripStopPhrase("cancel the task; deploy staging after that")).toBe(
    "deploy staging after that",
  )
  expect(stripStopPhrase("ruko, pehle tests chalao")).toBe("pehle tests chalao")
  // Task text starting with a stop-like word is preserved verbatim.
  expect(stripStopPhrase("cancel that. stop the server first")).toBe("stop the server first")
  // Non-stop input is returned untouched.
  expect(stripStopPhrase("deploy to staging")).toBe("deploy to staging")
})

const SECRET_INPUTS = [
  "/home/user/secret-project/src/token.txt",
  "bun run --eval 'rm -rf /'",
  "https://internal.corp/keys?id=42",
  "my-secret-pattern",
  "sk-live-abcdef0123456789",
]

test("acknowledgements are fixed constants and never embed user input", () => {
  for (const secret of SECRET_INPUTS) {
    const acks = [
      STEERING_ACK.stop,
      STEERING_ACK.change,
      STEERING_ACK.followup,
      steeringStatusLine(undefined),
    ]
    for (const ack of acks) expect(ack).not.toContain(secret)
    // Even classifying a secret-laden message only yields fixed strings.
    const kind = classifySteering(`${secret}\nstop`)
    const routed =
      kind === "stop" ? STEERING_ACK.stop : kind === "change" ? STEERING_ACK.change : STEERING_ACK.followup
    expect(routed).not.toContain(secret)
  }
  for (const value of Object.values(STEERING_ACK)) expect(value.length).toBeGreaterThan(0)
})

test("status line uses existing redacted activity categories only", () => {
  expect(steeringStatusLine("Running tool…")).toBe("Status: Running tool…")
  expect(steeringStatusLine("Reading…")).toBe("Status: Reading…")
  expect(steeringStatusLine(undefined)).toBe("Status: Thinking...")
})

function toolPart(tool: string, status: "pending" | "running" | "completed", secret = "") {
  return {
    type: "tool",
    tool,
    state: { status, input: { command: secret, filePath: secret }, time: { start: 0 } },
  } as any
}

test("live stage stays within the fixed redacted category set", () => {
  expect(liveActivity([toolPart("bash", "running")])).toBe("Running tool…")
  expect(liveActivity([toolPart("read", "running")])).toBe("Reading…")
  expect(liveActivity([toolPart("bash", "completed")])).toBe("Thinking...")
  expect(
    liveActivity([{ type: "text", text: "partial answer streaming" } as any]),
  ).toBeUndefined()
  for (const secret of SECRET_INPUTS) {
    const label = liveActivity([toolPart("bash", "running", secret)])!
    expect(label).not.toContain(secret)
  }
})
