import { Effect } from "effect"
import { randomBytes } from "crypto"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@nexus-ai/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless NEXUS server",
  // Server loads instances per-request via x-nexus-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    if (!Flag.NEXUS_SERVER_PASSWORD) {
      // Require auth by default: generate an ephemeral password so the server
      // is never left wide open on the network.
      const generated = randomBytes(18).toString("base64url")
      process.env.NEXUS_SERVER_PASSWORD = generated
      console.log(`NEXUS_SERVER_PASSWORD was not set; generated ephemeral password: ${generated}`)
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`NEXUS server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
