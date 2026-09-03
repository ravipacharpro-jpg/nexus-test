import { Dialog } from "@nexus-ai/ui/dialog"
import { List } from "@nexus-ai/ui/list"
import { ProviderIcon } from "@nexus-ai/ui/provider-icon"
import { Tag } from "@nexus-ai/ui/tag"
import { useDialog } from "@nexus-ai/ui/context/dialog"
import { Show, type Component } from "solid-js"
import { DialogProviderKeys } from "./dialog-provider-keys"
import { DialogConnectProvider } from "./dialog-connect-provider"
import { rankedApiKeyProviders } from "./palette-api-key-providers"

export const DialogPaletteApiKeys: Component = () => {
  const dialog = useDialog()

  return (
    <Dialog title="Add API key">
      <div class="flex flex-col gap-3 px-2.5 pb-6">
        <p class="text-14-regular text-text-base">
          Select a provider. Keys stay local in the NEXUS vault and are shown only in masked form.
        </p>
        <List
          class="px-3"
          search={{ placeholder: "Search providers", autofocus: true }}
          emptyMessage="No supported API-key provider found."
          key={(provider) => provider?.id}
          items={rankedApiKeyProviders}
          filterKeys={["id", "name", "badge", "detail"]}
          onSelect={(provider) => {
            if (!provider) return
            if (provider.id === "custom") {
              void dialog.show(() => <DialogConnectProvider />)
              return
            }
            void dialog.show(() => <DialogProviderKeys provider={provider.id} />)
          }}
        >
          {(provider) => (
            <div class="flex w-full items-center gap-3">
              <Show
                when={provider.id !== "custom"}
                fallback={<span class="flex size-5 items-center justify-center text-text-weak">+</span>}
              >
                <ProviderIcon id={provider.id} />
              </Show>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span>{provider.name}</span>
                  <Show when={provider.badge}>{(badge) => <Tag>{badge()}</Tag>}</Show>
                </div>
                <Show when={provider.detail}>
                  {(detail) => <div class="text-12-regular text-text-weak">{detail()}</div>}
                </Show>
              </div>
            </div>
          )}
        </List>
      </div>
    </Dialog>
  )
}
