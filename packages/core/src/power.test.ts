import { expect, test } from "bun:test"
import { workloadPolicy } from "./power"

test("throttles low battery and high temperature workloads", () => {
  expect(workloadPolicy({ batteryPercent: 12, source: "termux" })).toMatchObject({ throttled: true, maxConcurrency: 1, disableBackgroundAgents: true })
  expect(workloadPolicy({ temperatureC: 48, source: "sysfs" })).toMatchObject({ throttled: true, maxConcurrency: 1 })
})

test("does not throttle a healthy workload", () => {
  expect(workloadPolicy({ batteryPercent: 83, temperatureC: 31, source: "termux" })).toMatchObject({ throttled: false, disableBackgroundAgents: false })
})
