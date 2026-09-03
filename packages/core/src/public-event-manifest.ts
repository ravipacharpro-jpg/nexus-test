export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@nexus-ai/schema/event"
import { EventManifest } from "@nexus-ai/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
