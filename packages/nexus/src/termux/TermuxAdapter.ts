import { detectRuntimeEnvironment, type RuntimeEnvironment } from "@nexus-ai/core/platform"

export const packageManagerForEnvironment = (environment: RuntimeEnvironment) => {
  if (environment === "termux") return "pkg"
  if (environment === "macos") return "brew"
  if (environment === "windows") return "winget"
  return "apt"
}

export class TermuxAdapter {
  static get environment(): RuntimeEnvironment { return detectRuntimeEnvironment() }
  static get isTermux(): boolean {
    return this.environment === "termux"
  }

  static get binPath(): string {
    return this.isTermux ? `${process.env.PREFIX ?? "/data/data/com.termux/files/usr"}/bin/` : "/usr/local/bin/"
  }

  static get homePath(): string {
    return process.env.HOME || (this.isTermux ? "/data/data/com.termux/files/home/" : "/root/")
  }

  static get maxParallelJobs(): number {
    return this.isTermux ? 2 : 4; // Low CPU limit for Termux
  }

  static get packageManager(): string {
    return packageManagerForEnvironment(this.environment)
  }

  static get pipArgs(): string[] {
    return this.isTermux ? ["--no-cache-dir"] : [];
  }
}
