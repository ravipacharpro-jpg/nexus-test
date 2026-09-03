import { describe, expect, test } from "bun:test"
import { routeModel } from "../../src/api/ModelRouter"

describe("ModelRouter local fallback filtering", () => {
  test("excludes only implicit local fallback when local routes are disabled", () => {
    expect(routeModel("unmapped-model", { includeLocal: false })).toEqual([])
    expect(routeModel("unmapped-model")).toEqual([
      {
        alias: "unmapped-model",
        provider: "ollama",
        model: "unmapped-model",
        reason: "local/default route",
      },
    ])
  })

  test("retains an explicit Ollama route even when implicit local fallbacks are disabled", () => {
    expect(routeModel("ollama/qwen2.5-coder:3b-instruct-q4", { includeLocal: false })).toEqual([
      {
        alias: "ollama/qwen2.5-coder:3b-instruct-q4",
        provider: "ollama",
        model: "qwen2.5-coder:3b-instruct-q4",
        reason: "explicit provider/model",
      },
    ])
  })
})
