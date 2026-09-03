import { describe, expect, test } from "bun:test"
import { deriveFooterActivity } from "../../../src/cli/cmd/run/footer.activity"

describe("Termux footer activity", () => {
  test("uses real runtime wording for compact activity labels", () => {
    expect(
      deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "running bun test" }),
    ).toMatchObject({ label: "Testing", pulse: true })
    expect(deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "writing patch" })).toMatchObject({
      label: "Writing",
    })
  })

  test("keeps retry and approval state truthful without raw status text", () => {
    expect(
      deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "provider fallback sk-secret" }),
    ).toMatchObject({ label: "Retrying route", tone: "warning" })
    expect(
      deriveFooterActivity({ busy: false, exiting: false, armed: false, status: "permission requested" }),
    ).toMatchObject({ label: "Waiting for approval", pulse: false })
  })

  test("maps only explicit runtime wording to compact reasoning, hold, deletion, and attention states", () => {
    expect(deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "reasoning about the task" })).toMatchObject({
      label: "Reasoning",
      tone: "active",
    })
    expect(deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "on hold" })).toMatchObject({
      label: "Waiting",
      pulse: false,
    })
    expect(deriveFooterActivity({ busy: true, exiting: false, armed: false, status: "deleting generated file" })).toMatchObject({
      label: "Deleting",
      tone: "warning",
    })
    expect(deriveFooterActivity({ busy: false, exiting: false, armed: false, status: "request failed" })).toMatchObject({
      label: "Needs attention",
      tone: "error",
    })
  })

  test("shows completion only when the footer observes a real completed run", () => {
    expect(
      deriveFooterActivity({ busy: false, exiting: false, armed: false, status: "", completed: true }),
    ).toMatchObject({ label: "Completed", tone: "muted", pulse: false })
    expect(deriveFooterActivity({ busy: false, exiting: false, armed: false, status: "" })).toBeUndefined()
  })
})
