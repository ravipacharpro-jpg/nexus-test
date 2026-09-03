export type AgentContext = {
  outputDir?: string
  hiredWorkers: string[]
}

export abstract class BaseAgent {
  abstract readonly name: string
  abstract readonly systemPrompt: string
  abstract execute(task: string, context: AgentContext): Promise<unknown>
}
