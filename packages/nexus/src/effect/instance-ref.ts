import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@nexus-ai/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~nexus/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~nexus/WorkspaceRef", {
  defaultValue: () => undefined,
})
