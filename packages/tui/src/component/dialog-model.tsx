import { createMemo, createResource, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { describe, suggestTop3, type Top3Candidate } from "../util/top3-models"

export function DialogModel(props: { providerID?: string; onPick?: (providerID: string, modelID: string) => void }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "nexus" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "nexus" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) => !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "nexus",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            releaseDate: info.release_date,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "nexus" && model.includes("-nano"),
            footer:
              info.status === "alpha"
                ? "Experimental"
                : info.cost?.input === 0 && provider.id === "nexus"
                  ? "Free"
                  : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    const top3Option =
      connected() && !props.providerID && showSections
        ? [
            {
              value: { providerID: "top3", modelID: "top3" },
              title: "Top 3 Best",
              description: "Live health-checked: opencode, omniroute, and your vault farm keys",
              category: "Mode",
              footer: "Auto-checked",
              onSelect: () => {
                dialog.replace(() => <DialogTop3Models />)
              },
            },
          ]
        : []

    if (needle) {
      const matches = fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj)
      const top3Match = "top3".includes(needle.toLowerCase()) ? top3Option : []
      return [
        ...top3Match,
        ...sortModelOptions(matches, false),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...top3Option, ...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    if (props.onPick) {
      props.onPick(providerID, modelID)
      return
    }
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

/**
 * DialogTop3Models: replaces the legacy Auto-switch dialog.
 *
 * On open, this runs a live, fresh-from-the-wire health check:
 *   1. Ping the keyless gateways (opencode, omniroute) at /models.
 *   2. Read the user's vault (~/.nexus/api-vault.json) for active farm keys.
 *   3. Ping each vault provider and probe one model with a real API call.
 *   4. Score by speed + quality + freshness, keep the top 3 that work RIGHT NOW.
 *
 * Anything that fails, is paid-only, or has disappeared from the provider's
 * live /models endpoint is silently dropped — exactly the "only suggest models
 * that are available" behavior the user asked for. New models from a provider
 * automatically appear because /models is the source of truth.
 */
export function DialogTop3Models() {
  const local = useLocal()
  const dialog = useDialog()

  // createResource runs once on mount, exactly what we want: a fresh on-open check.
  const [candidates] = createResource(() => suggestTop3({ topN: 3 }))

  const options = createMemo(() => {
    const list = candidates() ?? []
    if (list.length === 0) {
      return [
        {
          key: "empty",
          value: "empty",
          title: candidates.loading ? "Checking available models…" : "No free models available right now",
          description: candidates.loading
            ? "Live-pinging opencode, omniroute, and your vault farm keys"
            : "All candidates failed the health probe. Check your network or vault keys.",
          disabled: true,
        },
      ]
    }
    return list.map((c: Top3Candidate, i: number) => ({
      key: `top3-${c.provider}-${c.model}-${i}`,
      value: { providerID: c.provider, modelID: c.model },
      title: `${c.provider}/${c.model}`,
      description: describe(c),
      footer: c.source === "keyless" ? "Keyless" : "Vault",
      onSelect: () => {
        local.model.set({ providerID: c.provider, modelID: c.model }, { recent: true })
        dialog.clear()
      },
    }))
  })

  return (
    <DialogSelect
      options={options()}
      title="Top 3 Best Models"
      current={undefined}
      actions={[
        {
          command: "model.dialog.refresh",
          title: "Refresh",
          onTrigger: () => {
            // Force a re-fetch by remounting the resource.
            location.reload()
          },
        },
        {
          command: "model.dialog.autoswitch.done",
          title: "Done",
          onTrigger: () => dialog.clear(),
        },
      ]}
    />
  )
}

/**
 * Legacy DialogAutoModel — kept as a thin alias so any external callers
 * (tests, future PRs) still compile. Internally it now opens the top-3 picker.
 */
export function DialogAutoModel() {
  return <DialogTop3Models />
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
