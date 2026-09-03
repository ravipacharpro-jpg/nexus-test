import { Config } from "@/config/config"
import { AppRuntime } from "@/effect/app-runtime"
import { Flag } from "@nexus-ai/core/flag/flag"
import { Installation, planSelfUpdate } from "@/installation"
import { InstallationVersion } from "@nexus-ai/core/installation/version"
import { GlobalBus } from "@/bus/global"

export async function upgrade() {
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  if (config.autoupdate === false || Flag.NEXUS_DISABLE_AUTOUPDATE) return
  const method = await Installation.method()
  const latest = await Installation.latest(method).catch(() => {})
  if (!latest) return

  if (Flag.NEXUS_ALWAYS_NOTIFY_UPDATE) {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  if (method === "unknown") return
  const plan = planSelfUpdate({ currentVersion: InstallationVersion, latestVersion: latest, method })
  if (!plan.available) return

  const kind = Installation.getReleaseType(InstallationVersion, latest)

  if (config.autoupdate === "notify" || kind !== "patch") {
    GlobalBus.emit("event", {
      directory: "global",
      payload: {
        type: Installation.Event.UpdateAvailable.type,
        properties: { version: latest },
      },
    })
    return
  }

  await Installation.upgrade(method, latest)
    .then(() =>
      GlobalBus.emit("event", {
        directory: "global",
        payload: {
          type: Installation.Event.Updated.type,
          properties: { version: latest },
        },
      }),
    )
    .catch(() => {})
}
