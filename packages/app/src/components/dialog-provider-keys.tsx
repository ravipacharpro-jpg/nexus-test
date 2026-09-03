import { Button } from "@nexus-ai/ui/button"
import { Dialog } from "@nexus-ai/ui/dialog"
import { Tag } from "@nexus-ai/ui/tag"
import { TextField } from "@nexus-ai/ui/text-field"
import { useDialog } from "@nexus-ai/ui/context/dialog"
import { createResource, createSignal, For, Show, type Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { showToast } from "@/utils/toast"

const statusLabel = (status: string) => status.replace("_", " ")

export const DialogProviderKeys: Component<{ provider: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const [key, setKey] = createSignal("")
  const [label, setLabel] = createSignal("")
  const [accountId, setAccountId] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [data, { refetch }] = createResource(
    () => props.provider,
    () => serverSDK().client.providerVault.keys.list(),
  )

  const entries = () => data()?.providers.find((item) => item.provider === props.provider)?.keys ?? []
  const requiresAccountId = () => props.provider === "cloudflare-workers-ai"

  const add = async (event: SubmitEvent) => {
    event.preventDefault()
    const value = key().trim()
    if (!value || busy()) return
    setBusy(true)
    try {
      await serverSDK().client.providerVault.keys.add({
        provider: props.provider,
        key: value,
        ...(label().trim() ? { label: label().trim() } : {}),
        ...(requiresAccountId() ? { metadata: { accountId: accountId().trim() } } : {}),
      })
      await serverSDK().client.global.dispose()
      setKey("")
      setLabel("")
      setAccountId("")
      await refetch()
      showToast({ variant: "success", icon: "circle-check", title: "API key added" })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (index: number) => {
    if (busy()) return
    setBusy(true)
    try {
      await serverSDK().client.providerVault.keys.remove({ providerID: props.provider, index })
      await serverSDK().client.global.dispose()
      await refetch()
      showToast({ variant: "success", icon: "circle-check", title: "API key removed" })
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title={`API keys · ${props.provider}`}>
      <div class="flex flex-col gap-5 px-2.5 pb-6">
        <p class="text-14-regular text-text-base">
          Keys stay local and are shown here only in masked form.
          <Show when={requiresAccountId()}> Your Cloudflare Account ID stays local and is never shown in this list.</Show>
        </p>
        <div class="flex flex-col gap-2">
          <Show when={data.loading}>
            <div class="py-3 text-14-regular text-text-weak">Loading keys…</div>
          </Show>
          <Show when={!data.loading && entries().length === 0}>
            <div class="py-3 text-14-regular text-text-weak">No API keys added for this provider.</div>
          </Show>
          <For each={entries()}>
            {(entry) => (
              <div class="flex items-center justify-between gap-3 border-b border-border-weak-base py-3 last:border-none">
                <div class="flex min-w-0 flex-col gap-1">
                  <div class="flex items-center gap-2">
                    <span class="text-14-medium text-text-strong truncate">{entry.label}</span>
                    <Tag>{statusLabel(entry.status)}</Tag>
                  </div>
                  <span class="text-12-regular text-text-weak font-mono">{entry.key}</span>
                </div>
                <Button size="small" variant="ghost" disabled={busy()} onClick={() => void remove(entry.index)}>
                  Remove
                </Button>
              </div>
            )}
          </For>
        </div>
        <form onSubmit={add} class="flex flex-col gap-3 border-t border-border-weak-base pt-4">
          <TextField label="API key" type="password" autocomplete="off" value={key()} onChange={setKey} />
          <Show when={requiresAccountId()}>
            <TextField label="Cloudflare Account ID" autocomplete="off" value={accountId()} onChange={setAccountId} />
            <p class="text-12-regular text-text-weak">
              Create a scoped Workers AI token with Workers AI Read and Edit. This form never estimates remaining Neurons.
            </p>
          </Show>
          <TextField label="Label (optional)" autocomplete="off" value={label()} onChange={setLabel} />
          <Button type="submit" size="large" variant="primary" disabled={busy() || !key().trim() || (requiresAccountId() && !accountId().trim())}>
            {busy() ? language.t("common.saving") : "Add API key"}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}
