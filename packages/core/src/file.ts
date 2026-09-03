export * as File from "./file"

import { Revert } from "@nexus-ai/schema/revert"

export const Diff = Revert.FileDiff
export type Diff = typeof Diff.Type
