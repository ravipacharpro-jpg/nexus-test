// @ts-nocheck

import { NEXUS } from "@nexus-ai/core"
import { ReadTool } from "@nexus-ai/core/tools"

const nexus = NEXUS.make({})

nexus.tool.add(ReadTool)

nexus.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

nexus.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

nexus.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await nexus.session.create({
  agent: "build",
})

nexus.subscribe((event) => {
  console.log(event)
})

await nexus.session.prompt({
  sessionID,
  text: "hey what is up",
})

await nexus.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await nexus.session.wait()

console.log(await nexus.session.messages(sessionID))
