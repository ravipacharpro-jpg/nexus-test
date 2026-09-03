import { sentryVitePlugin } from "@sentry/vite-plugin"
import path from "node:path"
import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const sentry =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
    ? sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        telemetry: false,
        release: {
          name: process.env.SENTRY_RELEASE ?? process.env.VITE_SENTRY_RELEASE,
        },
        sourcemaps: {
          assets: "./dist/**",
          filesToDeleteAfterUpload: "./dist/**/*.map",
        },
      })
    : false

export default defineConfig({
  plugins: [desktopPlugin, sentry] as any,
  // NEXUS retained this internal import namespace while the vendored OpenCode
  // client package exposes a different generated API. Resolve it to the
  // workspace NEXUS client source so the embedded UI receives the matching
  // NEXUS factory and types at build time.
  resolve: {
    alias: {
      "@nexus-ai/client": path.resolve(import.meta.dirname, "../client/src"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
    sourcemap: process.env.NEXUS_DISABLE_SOURCEMAP === "1" ? false : true,
  },
})
