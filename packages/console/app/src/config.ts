/**
 * Application-wide constants and configuration
 */
export const config = {
  // Base URL
  baseUrl: "https://nexus.ai",

  // GitHub
  github: {
    repoUrl: "https://github.com/anomalyco/nexus",
    starsFormatted: {
      compact: "195K",
      full: "195,000",
    },
  },

  // Social links
  social: {
    twitter: "https://x.com/nexus",
    discord: "https://discord.gg/nexus",
  },

  // Static stats (used on landing page)
  stats: {
    contributors: "950",
    commits: "13,000",
    monthlyUsers: "16M",
  },
} as const
