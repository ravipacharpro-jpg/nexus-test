declare module "*.png" {
  const src: string
  export default src
}

declare module "*.mp4" {
  const src: string
  export default src
}

declare module "*.svg" {
  const src: string
  export default src
}

declare module "*?worker&url" {
  const workerUrl: string
  export default workerUrl
}

declare module "diff" {
  export type DiffHunk = { oldStart: number; newStart: number; lines: Array<string> }
  export type ParsedDiff = {
    index?: string
    oldFileName?: string
    newFileName?: string
    hunks: Array<DiffHunk>
  }
  export function parsePatch(patch: string): Array<ParsedDiff>
}

interface ImportMetaGlobOptions {
  import?: string
  query?: string | Record<string, string>
}

interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: ImportMetaGlobOptions & { eager?: false },
  ): Record<string, () => Promise<T>>
  glob<T = unknown>(pattern: string, options: ImportMetaGlobOptions & { eager: true }): Record<string, T>
}
