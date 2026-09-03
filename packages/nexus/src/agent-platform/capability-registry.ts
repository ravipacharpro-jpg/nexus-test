import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AdaptiveIntent } from "./adaptive-intent"

export type FeatureStatus = "verified" | "partial" | "blocked" | "unknown"

export type FeatureRecord = {
  id: string
  name: string
  version: string
  status: FeatureStatus
  summary: string
  files: string[]
  tests: string[]
  limitations: string[]
  evidence?: string[]
  updatedAt: string
}

export type CapabilityRegistry = {
  version: 1
  updatedAt: string
  features: FeatureRecord[]
}

function now() {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function isCapabilityRegistry(value: unknown): value is CapabilityRegistry {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { version?: unknown; updatedAt?: unknown; features?: unknown }
  return candidate.version === 1 && typeof candidate.updatedAt === "string" && Array.isArray(candidate.features)
}

export function createCapabilityRegistry(features: FeatureRecord[] = []): CapabilityRegistry {
  return { version: 1, updatedAt: now(), features: clone(features) }
}

export function upsertFeature(
  registry: CapabilityRegistry,
  feature: Omit<FeatureRecord, "updatedAt">,
): CapabilityRegistry {
  const next = clone(registry)
  const record = { ...feature, updatedAt: now() }
  const index = next.features.findIndex((item) => item.id === feature.id)
  if (index < 0) next.features.push(record)
  else next.features[index] = record
  next.updatedAt = record.updatedAt
  return next
}

export function featureForIntent(registry: CapabilityRegistry, intent: AdaptiveIntent): FeatureRecord[] {
  const terms = new Set(intent.requestedWorkers)
  return registry.features.filter((feature) =>
    feature.files.some((file) => [...terms].some((term) => file.includes(term))),
  )
}

export function missingVerifiedFeatures(registry: CapabilityRegistry, intent: AdaptiveIntent): string[] {
  const known = featureForIntent(registry, intent)
    .filter((feature) => feature.status === "verified")
    .map((feature) => feature.name.toLowerCase())
  return intent.requestedWorkers
    .filter((worker) => !known.some((feature) => feature.includes(worker)))
    .filter((worker) => !intent.capabilityGaps.includes(worker))
}

export async function loadCapabilityRegistry(path: string): Promise<CapabilityRegistry> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (!isCapabilityRegistry(parsed)) throw new Error("invalid registry")
    return parsed
  } catch {
    return createCapabilityRegistry()
  }
}

export async function saveCapabilityRegistry(path: string, registry: CapabilityRegistry): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${path.split("/").pop() ?? "capabilities"}.tmp`)
  await writeFile(temporary, `${JSON.stringify({ ...registry, updatedAt: now() }, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
}

export function defaultCapabilityRegistryPath(workspace: string): string {
  return process.env.NEXUS_CAPABILITY_REGISTRY_PATH || join(workspace, ".nexus", "capabilities.json")
}

export * as CapabilityRegistry from "./capability-registry"
