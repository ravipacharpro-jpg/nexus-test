import { TASK_PROFILES, currentTaskProfile, setTaskProfile, type TaskProfileName } from "@/runtime/task-profile"

const choices = Object.keys(TASK_PROFILES) as TaskProfileName[]

export const ProfileCommand = {
  command: "profile <command>",
  describe: "view or set a bounded task-execution profile",
  builder: (yargs: import("yargs").Argv) =>
    yargs
      .command({
        command: "list",
        describe: "list available profiles",
        handler: () => {
          for (const profile of Object.values(TASK_PROFILES)) {
            console.log(`${profile.name.padEnd(9)} ${profile.label} — ${profile.preference}, ${profile.outputBudget} output, max ${profile.maxParallel} parallel`)
          }
        },
      })
      .command({
        command: "show",
        describe: "show the active profile",
        handler: () => console.log(JSON.stringify(currentTaskProfile(), null, 2)),
      })
      .command({
        command: "set <name>",
        describe: "set the default profile; manual model and task settings still override it",
        builder: (command) => command.positional("name", { choices, type: "string" }),
        handler: async (args: { name: TaskProfileName }) => {
          const profile = await setTaskProfile(args.name)
          console.log(`Task profile set to ${profile.label}.`)
        },
      })
      .demandCommand(1),
  handler: () => undefined,
}
