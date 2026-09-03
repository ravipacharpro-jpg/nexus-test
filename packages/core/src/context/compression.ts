import { Effect, Context, Layer } from "effect"

export interface Message {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  name?: string
}

export interface Interface {
  readonly compress: (messages: Message[], budget: number) => Effect.Effect<Message[]>
  readonly summarize: (text: string) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@nexus/ContextCompression") {}

const make = Effect.gen(function* () {
  const compress = Effect.fn("ContextCompression.compress")(function* (messages: Message[], budget: number) {
    // Simple TF-IDF stub for 2GB RAM devices
    // Keep system prompts, recent user messages, and tool results that fit the budget
    if (messages.length <= 10) return messages;
    
    const systemMessages = messages.filter(m => m.role === "system");
    const recentMessages = messages.slice(-5);
    
    return [...systemMessages, ...recentMessages];
  })
  
  const summarize = Effect.fn("ContextCompression.summarize")(function* (text: string) {
    if (text.length < 500) return text;
    return text.substring(0, 500) + "... (compressed)";
  })
  
  return Service.of({ compress, summarize })
})

export const layer = Layer.effect(Service, make)
