import { AgentV2 } from "@nexus-ai/core/agent"
import { AISDK } from "@nexus-ai/core/aisdk"
import { Catalog } from "@nexus-ai/core/catalog"
import { CommandV2 } from "@nexus-ai/core/command"
import { Credential } from "@nexus-ai/core/credential"
import { AppNodeBuilder } from "@nexus-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@nexus-ai/core/effect/app-node-platform"
import { LayerNode } from "@nexus-ai/core/effect/layer-node"
import { EventV2 } from "@nexus-ai/core/event"
import { FileSystem } from "@nexus-ai/core/filesystem"
import { FSUtil } from "@nexus-ai/core/fs-util"
import { Integration } from "@nexus-ai/core/integration"
import { Location } from "@nexus-ai/core/location"
import { Npm } from "@nexus-ai/core/npm"
import { PluginV2 } from "@nexus-ai/core/plugin"
import { Reference } from "@nexus-ai/core/reference"
import { SkillV2 } from "@nexus-ai/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
