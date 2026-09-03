import { FREELANCERS } from "./FreelancerDB"

export type TaskType = "bot" | "tool" | "script"

export type TaskPlan = {
  originalCommand: string
  workersNeeded: string[]
  matchedWorkers: string[]
  taskType: TaskType
  estimatedTime: string
  estimatedSizeMB: number
  estimatedSize: string
}

export class BrainStaff {
  analyze(command: string): TaskPlan {
    const normalized = command.trim().toLowerCase()
    const workers = new Set<string>()

    const add = (name: string) => {
      if (FREELANCERS[name]) workers.add(name)
    }

    if (/\b(bot|telegram|tgbot|echo bot)\b/.test(normalized)) add("telegram-bot")
    if (/\b(youtube|download|downloader|video|instagram|insta|twitter)\b/.test(normalized)) add("yt-dlp")
    if (/\b(scan|network|port|wifi|nmap)\b/.test(normalized)) {
      add("nmap")
      if (/\b(wifi|termux|phone|android)\b/.test(normalized)) add("termux-api")
    }
    if (/\b(scrape|scraping|web|html|parse|beautifulsoup)\b/.test(normalized)) add("beautifulsoup")
    if (/\b(image|photo|compress|resize|pillow)\b/.test(normalized)) add("pillow")
    if (/\b(sms|call|battery|location|termux|system)\b/.test(normalized)) add("termux-api")
    if (/\b(spotify|music)\b/.test(normalized)) add("spotdl")
    if (/\b(browser|selenium|webdriver)\b/.test(normalized)) add("selenium")
    if (/\b(api|http|request)\b/.test(normalized)) add("requests")

    const workersNeeded = [...workers]
    const taskType: TaskType = /\b(bot|telegram|tgbot)\b/.test(normalized)
      ? "bot"
      : workersNeeded.length > 0
        ? "tool"
        : "script"
    const estimatedSizeMB = workersNeeded.reduce((sum, name) => sum + (FREELANCERS[name]?.sizeMB ?? 0), 0)
    const estimatedSeconds = Math.max(5, workersNeeded.length * 10)

    if (workersNeeded.length === 0) {
      console.log("🤔 Could not classify this task. What would you like to automate?")
      console.log("Options: bot, download, network, scrape, image, system")
    }

    return {
      originalCommand: command,
      workersNeeded,
      matchedWorkers: workersNeeded,
      taskType,
      estimatedTime: `${estimatedSeconds} seconds`,
      estimatedSizeMB,
      estimatedSize: `${estimatedSizeMB}MB`,
    }
  }

  matchFreelancers(plan: TaskPlan): string[] {
    return plan.workersNeeded
  }
}
