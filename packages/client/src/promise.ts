export * from "./legacy-promise/index"
export type { EventSubscribeOutput as NEXUSEvent } from "./legacy-promise/generated/types"
export type NEXUSClient = ReturnType<typeof import("./legacy-promise/generated/client").make>
export * as NEXUS from "./legacy-promise/generated/client"
