export type WorkerPoolSnapshot = {
  maxParallel: number
  activeWorkers: number
  pendingWorkers: number
}

/**
 * A process-local semaphore for worker and checker execution.  It deliberately
 * uses completion-driven draining rather than a timer so it behaves the same
 * on desktop Node/Bun and Android Termux.
 */
export class DualWorkerPool {
  private readonly pending: Array<() => void> = []
  activeWorkers = 0

  constructor(readonly maxParallel: number) {
    if (!Number.isInteger(maxParallel) || maxParallel < 1) {
      throw new Error("maxParallel must be a positive integer")
    }
  }

  get snapshot(): WorkerPoolSnapshot {
    return {
      maxParallel: this.maxParallel,
      activeWorkers: this.activeWorkers,
      pendingWorkers: this.pending.length,
    }
  }

  async execute<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await work()
    } finally {
      this.activeWorkers -= 1
      this.releaseNext()
    }
  }

  private acquire(): Promise<void> {
    if (this.activeWorkers < this.maxParallel) {
      this.activeWorkers += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.pending.push(() => {
        this.activeWorkers += 1
        resolve()
      })
    })
  }

  private releaseNext() {
    const next = this.pending.shift()
    next?.()
  }
}

export default DualWorkerPool
