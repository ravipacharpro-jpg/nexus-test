import { TermuxAdapter } from "../termux/TermuxAdapter";
import { execSync } from "node:child_process";

export class LightweightEngine {
  static readonly MAX_HEAP_MB = 512;
  
  static enforceMemoryCap() {
    if (process.memoryUsage().heapUsed > this.MAX_HEAP_MB * 1024 * 1024) {
      console.warn(`[NEXUS] Memory warning: Exceeded ${this.MAX_HEAP_MB}MB cap. Triggering garbage collection.`);
      if (global.gc) {
        global.gc();
      }
    }
  }

  static get fileWatcherCommand(): string {
    // Prefer inotifywait on Termux instead of heavy Node chokidar
    return TermuxAdapter.isTermux ? "inotifywait -m -e modify,create,delete" : "node-watcher";
  }

  static cleanupStaleProcesses(maxAgeMinutes: number = 10) {
    if (!TermuxAdapter.isTermux) return;
    try {
      // Only clean up processes owned by NEXUS; never terminate unrelated Termux apps.
      // This requires `ps` and `awk`, which are available in Termux.
      const script = `
        ps -eo pid,etimes,comm | awk '$1 != ${process.pid} && $2 > ${maxAgeMinutes * 60} && $3 ~ /nexus|nexus|nexus/ {print $1}' | xargs -r kill -9
      `;
      execSync(script, { stdio: "ignore" });
    } catch (e) {
      // Ignore errors if ps/awk are missing or no processes match
    }
  }

  static isMinimalMode(): boolean {
    return process.argv.includes("--lightweight");
  }
}
