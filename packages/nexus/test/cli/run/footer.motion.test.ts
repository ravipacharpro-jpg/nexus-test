import { describe, expect, test } from "bun:test"
import { footerMotionEnabled } from "../../../src/cli/cmd/run/footer.motion"

describe("terminal footer motion preference", () => {
  test("keeps motion enabled unless the explicit local reduced-motion preference is set", () => {
    expect(footerMotionEnabled({})).toBe(true)
    expect(footerMotionEnabled({ NEXUS_REDUCED_MOTION: "0" })).toBe(true)
    expect(footerMotionEnabled({ NEXUS_REDUCED_MOTION: "false" })).toBe(true)
  })

  test("disables only nonessential pulse motion for explicit truthy reduced-motion values", () => {
    expect(footerMotionEnabled({ NEXUS_REDUCED_MOTION: "1" })).toBe(false)
    expect(footerMotionEnabled({ NEXUS_REDUCED_MOTION: "true" })).toBe(false)
    expect(footerMotionEnabled({ NEXUS_REDUCED_MOTION: " TRUE " })).toBe(false)
  })
})
