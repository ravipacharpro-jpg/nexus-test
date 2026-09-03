export function footerMotionEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  const value = environment.NEXUS_REDUCED_MOTION?.trim().toLowerCase()
  return value !== "1" && value !== "true"
}
