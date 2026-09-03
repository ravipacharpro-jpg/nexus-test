import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerNexusSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
