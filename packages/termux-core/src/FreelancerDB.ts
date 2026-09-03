export type FreelancerType = "pip" | "pkg" | "npm"

export type Freelancer = {
  name: string
  installCmd: string
  uninstallCmd: string
  checkCmd: string
  sizeMB: number
  tags: string[]
  type: FreelancerType
}

export const FREELANCERS: Record<string, Freelancer> = {
  "telegram-bot": {
    name: "telegram-bot",
    installCmd: "python -m pip install --user --no-cache-dir python-telegram-bot",
    uninstallCmd: "python -m pip uninstall -y python-telegram-bot",
    checkCmd: "python -c \"import telegram\"",
    sizeMB: 15,
    tags: ["telegram", "bot", "tgbot", "echo bot"],
    type: "pip",
  },
  aiogram: {
    name: "aiogram",
    installCmd: "python -m pip install --user --no-cache-dir aiogram",
    uninstallCmd: "python -m pip uninstall -y aiogram",
    checkCmd: "python -c \"import aiogram\"",
    sizeMB: 12,
    tags: ["aiogram", "async bot"],
    type: "pip",
  },
  "yt-dlp": {
    name: "yt-dlp",
    installCmd: "python -m pip install --user --no-cache-dir yt-dlp",
    uninstallCmd: "python -m pip uninstall -y yt-dlp",
    checkCmd: "python -c \"import yt_dlp\"",
    sizeMB: 25,
    tags: ["youtube", "download", "downloader", "video", "instagram", "insta", "twitter"],
    type: "pip",
  },
  spotdl: {
    name: "spotdl",
    installCmd: "python -m pip install --user --no-cache-dir spotdl",
    uninstallCmd: "python -m pip uninstall -y spotdl",
    checkCmd: "python -c \"import spotdl\"",
    sizeMB: 20,
    tags: ["spotify", "music download", "spotdl"],
    type: "pip",
  },
  nmap: {
    name: "nmap",
    installCmd: "pkg install -y nmap",
    uninstallCmd: "pkg uninstall -y nmap",
    checkCmd: "command -v nmap",
    sizeMB: 30,
    tags: ["scan", "network", "port", "wifi", "nmap"],
    type: "pkg",
  },
  requests: {
    name: "requests",
    installCmd: "python -m pip install --user --no-cache-dir requests",
    uninstallCmd: "python -m pip uninstall -y requests",
    checkCmd: "python -c \"import requests\"",
    sizeMB: 5,
    tags: ["http", "request", "api"],
    type: "pip",
  },
  "termux-api": {
    name: "termux-api",
    installCmd: "pkg install -y termux-api",
    uninstallCmd: "pkg uninstall -y termux-api",
    checkCmd: "command -v termux-battery-status",
    sizeMB: 5,
    tags: ["sms", "call", "battery", "location", "termux", "system"],
    type: "pkg",
  },
  pillow: {
    name: "pillow",
    installCmd: "python -m pip install --user --no-cache-dir Pillow",
    uninstallCmd: "python -m pip uninstall -y Pillow",
    checkCmd: "python -c \"from PIL import Image\"",
    sizeMB: 20,
    tags: ["image", "photo", "compress", "resize", "pillow"],
    type: "pip",
  },
  beautifulsoup: {
    name: "beautifulsoup",
    installCmd: "python -m pip install --user --no-cache-dir beautifulsoup4 requests",
    uninstallCmd: "python -m pip uninstall -y beautifulsoup4",
    checkCmd: "python -c \"from bs4 import BeautifulSoup\"",
    sizeMB: 10,
    tags: ["scrape", "scraping", "web", "html", "parse", "beautifulsoup"],
    type: "pip",
  },
  selenium: {
    name: "selenium",
    installCmd: "python -m pip install --user --no-cache-dir selenium",
    uninstallCmd: "python -m pip uninstall -y selenium",
    checkCmd: "python -c \"import selenium\"",
    sizeMB: 35,
    tags: ["selenium", "browser automation", "webdriver"],
    type: "pip",
  },
}

export class FreelancerDB {
  get(name: string): Freelancer | undefined {
    return FREELANCERS[name]
  }

  has(name: string): boolean {
    return Boolean(FREELANCERS[name])
  }

  list(): Freelancer[] {
    return Object.values(FREELANCERS)
  }
}

export function getFreelancer(name: string): Freelancer | undefined {
  return FREELANCERS[name]
}
