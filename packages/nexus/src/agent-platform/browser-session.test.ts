import { createBrowserSession, detectSensitiveBrowserStep, planBrowserAction } from "./browser-session"
import { createManagedChromiumBrowserSession } from "./chromium-launcher"

describe("secure browser session", () => {
  test("binds BrowserSession to the managed Chromium lifecycle", async () => {
    let stopped = false
    const managed = createManagedChromiumBrowserSession({}, async ({ url }) => ({
      url,
      devtoolsUrl: "ws://test",
      stop: async () => void (stopped = true),
    }))
    expect(managed.session.begin("https://example.com").state).toBe("opening")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(managed.getChromium()?.url).toBe("https://example.com/")
    await managed.stop()
    expect(stopped).toBe(true)
  })
  test("detects sensitive browser steps without extracting values", () => {
    expect(detectSensitiveBrowserStep("Please enter your password and verification code")).toBe("otp")
    expect(detectSensitiveBrowserStep("Complete CAPTCHA")).toBe("captcha")
    expect(detectSensitiveBrowserStep("Confirm purchase")).toBe("approval")
    expect(detectSensitiveBrowserStep("Dashboard loaded")).toBeUndefined()
  })

  test("plans ordinary browser actions and gates sensitive targets", () => {
    expect(planBrowserAction({ kind: "click", target: "#submit" })).toEqual({
      kind: "click",
      target: "#submit",
      requiresTakeover: false,
    })
    expect(planBrowserAction({ kind: "type", target: "password field" })).toMatchObject({
      kind: "type",
      requiresTakeover: true,
      reason: "login",
    })
    expect(planBrowserAction({ kind: "click", target: "Confirm purchase" })).toMatchObject({
      kind: "click",
      requiresTakeover: true,
      reason: "approval",
    })
  })

  test("requires user takeover before authenticated completion", async () => {
    const launched: string[] = []
    const session = createBrowserSession({ launch: async (url) => void launched.push(url) })
    expect(session.begin("https://example.com/login").state).toBe("opening")
    await Promise.resolve()
    expect(launched).toEqual(["https://example.com/login"])
    expect(session.requestTakeover("login").state).toBe("awaiting_user")
    expect(session.resumeAfterTakeover(true).state).toBe("authenticated")
    expect(session.complete().state).toBe("completed")
  })

  test("blocks unconfirmed access and never accepts secret input", () => {
    const session = createBrowserSession({ launch: async () => undefined })
    session.begin("https://example.com")
    session.requestTakeover("otp")
    expect(session.resumeAfterTakeover(false).state).toBe("blocked")
    expect(() => session.complete()).toThrow("confirmed")
  })

  test("rejects sensitive URLs before launching", () => {
    let launched = false
    const session = createBrowserSession({ launch: async () => void (launched = true) })
    expect(() => session.begin("https://example.com/?password=secret")).toThrow("sensitive query")
    expect(launched).toBe(false)
  })
})
