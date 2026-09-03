// top3-models.ts — public surface for "Top 3 best free models" picker.
// Wraps model-selector.ts so callers have a single, stable import path
// for the TUI, slash commands, and the autofarm agent.
//
// Usage:
//   import { getTop3Models } from "./top3-models.ts"
//   const top3 = await getTop3Models({ task: "code" })

import { suggestModels, formatSuggestions, type ModelCandidate, type SuggestOptions } from "./model-selector.ts"

export { suggestModels, formatSuggestions, type ModelCandidate, type SuggestOptions }

/** Convenience wrapper: returns the top 3 best free+fast+available
 *  models for the given task. Runs the live health probe on each
 *  candidate (unless `skipProbe: true`).
 *
 *  This is the function the TUI and `/top3` slash command call. */
export async function getTop3Models(
  opts: SuggestOptions = {},
) {
  return suggestModels({ topN: 3, ...opts })
}
