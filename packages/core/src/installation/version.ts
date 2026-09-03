declare global {
  const NEXUS_VERSION: string
  const NEXUS_CHANNEL: string
}

export const InstallationVersion = typeof NEXUS_VERSION === "string" ? NEXUS_VERSION : "local"
export const InstallationChannel = typeof NEXUS_CHANNEL === "string" ? NEXUS_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
