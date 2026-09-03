import { execFile } from "node:child_process"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { promisify } from "node:util"
import { basename, extname, join, resolve } from "node:path"
import { BaseAgent, type AgentContext } from "./BaseAgent"

const execFileAsync = promisify(execFile)
const MAX_FILE_BYTES = 100 * 1024
const MAX_SCAN_FILES = 2000
const SKIP_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".cache"])
const PRIORITY_NAMES = new Set(["package.json", "tsconfig.json", "Cargo.toml", "src", "main.py", "app.js", "index.ts", "index.js"])

export type FileSummary = {
  path: string
  size: number
  extension: string
  modifiedAt: number
}

export type CodeFile = FileSummary & { content: string; truncated: boolean }

export type BugSeverity = "critical" | "high" | "medium" | "low"
export type BugType = "syntax" | "logic" | "security" | "performance" | "style"

export type BugReport = {
  file: string
  line: number
  severity: BugSeverity
  type: BugType
  description: string
  fix: string
  confidence: number
  autoFixable?: boolean
}

export type FixResult = {
  fixed: BugReport[]
  failed: Array<{ bug: BugReport; error: string }>
  skipped: Array<{ bug: BugReport; reason: string }>
}

export type TestResult = {
  passed: boolean
  command?: string
  output: string
  testsDetected: boolean
}

const severityRank: Record<BugSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

function isTextFile(filePath: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|jsonc|toml|yaml|yml|md|sh|css|html)$/i.test(filePath)
}

function lineNumber(content: string, offset: number) {
  return content.slice(0, offset).split("\n").length
}

async function walk(root: string, output: FileSummary[], depth = 0): Promise<void> {
  if (output.length >= MAX_SCAN_FILES || depth > 32) return
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (output.length >= MAX_SCAN_FILES) return
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue
    if (SKIP_NAMES.has(entry.name)) continue
    const filePath = join(root, entry.name)
    if (entry.isDirectory()) {
      await walk(filePath, output, depth + 1)
      continue
    }
    if (!entry.isFile() || !isTextFile(filePath)) continue
    const metadata = await stat(filePath)
    output.push({ path: filePath, size: metadata.size, extension: extname(filePath), modifiedAt: metadata.mtimeMs })
  }
}

export class CodeReader {
  async quickScan(inputPath: string): Promise<FileSummary[]> {
    const root = resolve(inputPath)
    const metadata = await stat(root)
    if (metadata.isFile()) {
      return [{ path: root, size: metadata.size, extension: extname(root), modifiedAt: metadata.mtimeMs }]
    }
    const files: FileSummary[] = []
    await walk(root, files)
    return files.sort((a, b) => b.modifiedAt - a.modifiedAt)
  }

  async priorityRead(files: FileSummary[]): Promise<CodeFile[]> {
    const ordered = [...files].sort((a, b) => {
      const priority = (file: FileSummary) => {
        const name = basename(file.path)
        if (PRIORITY_NAMES.has(name)) return 0
        if (/error|bug|fix|todo/i.test(name)) return 1
        return 2
      }
      return priority(a) - priority(b) || b.modifiedAt - a.modifiedAt
    })
    const result: CodeFile[] = []
    for (let i = 0; i < ordered.length; i += 10) {
      for (const file of ordered.slice(i, i + 10)) {
        if (file.size > MAX_FILE_BYTES) continue
        try {
          const raw = await readFile(file.path, "utf8")
          result.push({ ...file, content: raw.slice(0, MAX_FILE_BYTES), truncated: raw.length > MAX_FILE_BYTES })
        } catch {
          // A file can disappear during a scan; continue with the remaining files.
        }
      }
    }
    return result
  }

  async deepDive(filePath: string): Promise<string> {
    const content = await readFile(resolve(filePath), "utf8")
    return content.slice(0, MAX_FILE_BYTES * 10)
  }
}

export class BugDetector {
  async analyze(files: CodeFile[]): Promise<BugReport[]> {
    const bugs: BugReport[] = []
    for (const file of files) {
      const source = file.content
      const add = (offset: number, bug: Omit<BugReport, "file" | "line">) => {
        bugs.push({ ...bug, file: file.path, line: lineNumber(source, offset) })
      }

      for (const match of source.matchAll(/(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{10,}["']/gi)) {
        add(match.index ?? 0, {
          severity: "critical",
          type: "security",
          description: "Possible hardcoded credential detected.",
          fix: "Move the value to an environment variable or secret store.",
          confidence: 94,
          autoFixable: false,
        })
      }
      for (const match of source.matchAll(/\beval\s*\(|\.innerHTML\s*=/g)) {
        add(match.index ?? 0, {
          severity: "high",
          type: "security",
          description: "Dynamic code or unsafe HTML assignment can enable injection.",
          fix: "Replace with a constrained parser or safe text/content APIs.",
          confidence: 93,
          autoFixable: false,
        })
      }
      for (const match of source.matchAll(/setInterval\s*\(/g)) {
        if (!/clearInterval\s*\(/.test(source)) {
          add(match.index ?? 0, {
            severity: "medium",
            type: "performance",
            description: "Interval is created without a visible clearInterval cleanup.",
            fix: "Store the interval handle and clear it during shutdown or disposal.",
            confidence: 90,
            autoFixable: false,
          })
        }
      }
      for (const match of source.matchAll(/while\s*\(\s*true\s*\)\s*\{/g)) {
        const block = source.slice(match.index ?? 0, (match.index ?? 0) + 1200)
        if (!/\b(break|return|throw)\b/.test(block)) {
          add(match.index ?? 0, {
            severity: "high",
            type: "logic",
            description: "Potential infinite loop has no visible exit statement.",
            fix: "Add a cancellation condition and an explicit exit path.",
            confidence: 88,
            autoFixable: false,
          })
        }
      }
      for (const match of source.matchAll(/\.then\s*\(/g)) {
        const tail = source.slice(match.index ?? 0, (match.index ?? 0) + 500)
        if (!/\.catch\s*\(/.test(tail)) {
          add(match.index ?? 0, {
            severity: "medium",
            type: "logic",
            description: "Promise chain has no nearby rejection handler.",
            fix: "Add an explicit catch/failure path or use try/catch with await.",
            confidence: 82,
            autoFixable: false,
          })
        }
      }
    }
    return bugs.sort((a, b) => severityRank[b.severity] - severityRank[a.severity] || a.file.localeCompare(b.file) || a.line - b.line)
  }
}

export class AutoFixer {
  async fix(bugs: BugReport[], dryRun = false): Promise<FixResult> {
    const results: FixResult = { fixed: [], failed: [], skipped: [] }
    for (const bug of bugs) {
      if (bug.confidence < 90 || bug.type === "security" || !bug.autoFixable) {
        results.skipped.push({ bug, reason: "Needs manual review; no safe automatic replacement is available." })
        continue
      }
      if (dryRun) {
        results.skipped.push({ bug, reason: "Dry run requested." })
        continue
      }
      results.skipped.push({ bug, reason: "Detector did not provide a safe exact replacement." })
    }
    return results
  }
}

export class TestRunner {
  async verify(root: string): Promise<TestResult> {
    const directory = resolve(root)
    let packageJson: { scripts?: Record<string, string> } | undefined
    try {
      packageJson = JSON.parse(await readFile(join(directory, "package.json"), "utf8"))
    } catch {
      // Non-JavaScript repositories are handled by the fallback checks below.
    }
    const command = packageJson?.scripts?.test ? "bun test" : packageJson?.scripts?.build ? "bun run build" : undefined
    if (command) {
      try {
        const [executable, ...args] = command.split(" ")
        if (!executable) return { passed: false, command, output: "Unable to determine test command.", testsDetected: Boolean(packageJson?.scripts?.test) }
        const result = await execFileAsync(executable, args, { cwd: directory, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 })
        return { passed: true, command, output: `${result.stdout}${result.stderr}`.slice(-12000), testsDetected: Boolean(packageJson?.scripts?.test) }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string; message?: string }
        return { passed: false, command, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}${failure.message ?? ""}`.slice(-12000), testsDetected: Boolean(packageJson?.scripts?.test) }
      }
    }
    return { passed: true, output: "No supported test/build script found; static analysis completed.", testsDetected: false }
  }
}

export type SeniorDevResult = {
  root: string
  files: FileSummary[]
  bugs: BugReport[]
  fixes?: FixResult
  tests?: TestResult
  summary: string
}

export class SeniorDevAgent extends BaseAgent {
  readonly name = "SeniorDevAgent"
  readonly systemPrompt = "Analyze repositories conservatively, make only high-confidence safe changes, and verify every change."
  readonly reader = new CodeReader()
  readonly detector = new BugDetector()
  readonly fixer = new AutoFixer()
  readonly tester = new TestRunner()

  async scan(root: string) {
    const files = await this.reader.quickScan(root)
    return { files, totalBytes: files.reduce((sum, file) => sum + file.size, 0) }
  }

  async analyze(root: string): Promise<SeniorDevResult> {
    const files = await this.reader.quickScan(root)
    const codeFiles = await this.reader.priorityRead(files)
    const bugs = await this.detector.analyze(codeFiles)
    return {
      root: resolve(root),
      files,
      bugs,
      summary: `Scanned ${files.length} files and found ${bugs.length} potential issues.`,
    }
  }

  async fix(root: string, options: { dryRun?: boolean; runTests?: boolean } = {}): Promise<SeniorDevResult> {
    const analysis = await this.analyze(root)
    const backup = join(resolve(root), ".nexus-backup")
    if (!options.dryRun && analysis.bugs.some((bug) => bug.autoFixable)) {
      await mkdir(backup, { recursive: true })
    }
    const fixes = await this.fixer.fix(analysis.bugs, options.dryRun ?? false)
    const tests = options.runTests === false ? undefined : await this.tester.verify(root)
    if (tests && !tests.passed && fixes.fixed.length > 0) {
      for (const bug of fixes.fixed) {
        fixes.failed.push({ bug, error: "Verification failed; changes should be reverted." })
      }
      fixes.fixed.length = 0
    }
    return { ...analysis, fixes, tests, summary: `Found ${analysis.bugs.length} issues; fixed ${fixes.fixed.length}, skipped ${fixes.skipped.length}.` }
  }

  async execute(task: string, context: AgentContext): Promise<SeniorDevResult> {
    const root = context.outputDir ?? "."
    if (/\b(analy[sz]e|review|scan|inspect)\b/i.test(task)) return this.analyze(root)
    return this.fix(root)
  }
}

export default SeniorDevAgent
