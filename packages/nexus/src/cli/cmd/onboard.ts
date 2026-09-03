import { collectDoctorReport } from "./doctor"

type OnboardingChecklist = {
  autoModel: "default"
  doctor: "ready" | "attention"
  steps: string[]
}

export async function onboardingChecklist(): Promise<OnboardingChecklist> {
  const doctor = await collectDoctorReport()
  return {
    autoModel: "default",
    doctor: doctor.storage.writable && doctor.deviceGuard.level !== "blocked" ? "ready" : "attention",
    steps: [
      "Open the NEXUS UI and press Ctrl+P, then choose Add API to connect a supported provider or Custom Provider.",
      "Keep Auto Model selected unless you deliberately need a manual provider/model override.",
      "Run `nexus doctor` to review runtime, device, profile, and provider-vault mode without exposing secrets.",
      "Run `nexus models test` to validate configured providers, then try a small explicit task such as `nexus \"Explain this folder\"`.",
    ],
  }
}

export const OnboardCommand = {
  command: "onboard",
  aliases: ["onboarding"],
  describe: "show the safe first-run setup path for Ctrl+P API onboarding and Auto Model",
  builder: (yargs: import("yargs").Argv) => yargs.option("json", { type: "boolean", describe: "print the checklist as JSON" }),
  handler: async (args: { json?: boolean }) => {
    const checklist = await onboardingChecklist()
    if (args.json) {
      console.log(JSON.stringify(checklist, null, 2))
      return
    }
    console.log("NEXUS first-run checklist")
    console.log(`Auto Model: ${checklist.autoModel} (manual selection remains available)`)
    console.log(`Doctor: ${checklist.doctor}`)
    for (const [index, step] of checklist.steps.entries()) console.log(`${index + 1}. ${step}`)
  },
}
