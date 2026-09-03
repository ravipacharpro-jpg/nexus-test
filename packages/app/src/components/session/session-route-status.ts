import type { ModelAvailability } from "../model-availability"

export type SessionRouteStatus = {
  modeLabel: "Auto" | "Manual"
  availability?: ModelAvailability
  tooltip: string
}

export function sessionRouteStatus(input: { auto: boolean; availability?: ModelAvailability }): SessionRouteStatus {
  const modeLabel = input.auto ? "Auto" : "Manual"
  const modeDetail = input.auto
    ? "Auto selection is enabled; NEXUS resolves a compatible configured candidate locally."
    : "Manual selection is active; your selected model keeps precedence."
  const availabilityDetail = input.availability ? ` ${input.availability.detail}` : " No local API-vault state is available for this completed route."
  return {
    modeLabel,
    availability: input.availability,
    tooltip: `${modeDetail}${availabilityDetail} These labels are local configuration or observed status only, not account balance, remaining tokens, live quota, provider availability, or an automatic route switch.`,
  }
}
