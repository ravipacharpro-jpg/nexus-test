interface ImportMetaEnv {
  readonly NEXUS_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:nexus-server" {
  export namespace Server {
    export const listen: typeof import("../../../nexus/dist/types/src/node").Server.listen
    export type Listener = import("../../../nexus/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../nexus/dist/types/src/node").Config.get
    export type Info = import("../../../nexus/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../nexus/dist/types/src/node").bootstrap
}
