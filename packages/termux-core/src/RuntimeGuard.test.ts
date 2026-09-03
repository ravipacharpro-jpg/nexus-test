// @ts-nocheck -- this file is executed by Bun's test runner; production code remains type-checked separately.
import { describe, expect, test } from "bun:test"
import { RUNTIME_GUARD_CRITICAL_TEMPERATURE_C, RUNTIME_GUARD_MIN_BATTERY_PERCENT, runtimeGuard } from "./RuntimeGuard"

test("blocks work when the battery is below the floor and not charging", async () => {
  const verdict = await runtimeGuard(() => ({ batteryPercent: RUNTIME_GUARD_MIN_BATTERY_PERCENT - 3, charging: false }))
  expect(verdict.ok).toBe(false)
  if (!verdict.ok) expect(verdict.reason).toMatch(/battery.*not charging/i)
})

test("allows a low battery while charging", async () => {
  const verdict = await runtimeGuard(() => ({ batteryPercent: 5, charging: true }))
  expect(verdict.ok).toBe(true)
})

test("blocks work at the critical thermal threshold", async () => {
  const verdict = await runtimeGuard(() => ({ batteryPercent: 90, temperatureC: RUNTIME_GUARD_CRITICAL_TEMPERATURE_C + 0.5 }))
  expect(verdict.ok).toBe(false)
  if (!verdict.ok) expect(verdict.reason).toMatch(/temperature/i)
})

test("treats a failing probe as healthy after logging once", async () => {
  const verdict = await runtimeGuard(() => {
    throw new Error("sensor bus unavailable")
  })
  expect(verdict.ok).toBe(true)
})

test("allows readings without any sensor data", async () => {
  const verdict = await runtimeGuard(() => ({}))
  expect(verdict.ok).toBe(true)
})
