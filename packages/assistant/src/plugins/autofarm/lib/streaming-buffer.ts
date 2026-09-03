// streaming-buffer: a token-by-token buffer that delivers text in
// smooth chunks, supports mid-stream cancellation, and exposes a
// pause/resume hook for the priority-router.
//
// Why: raw fetch streams deliver data in TCP-sized chunks (hundreds
// of bytes at a time). Rendering them straight to TUI causes flicker.
// Buffering + chunking gives a smooth typewriter effect with cancel.

import { EventEmitter } from "node:events"
import { log } from "./logger.ts"

export interface StreamChunk {
  text: string
  /** Monotonically increasing id. */
  index: number
  /** True on the final chunk. */
  done: boolean
  /** ms since stream start. */
  elapsedMs: number
}

export interface StreamOptions {
  /** Min chunk size in chars (default 8). */
  minChunk?: number
  /** Max chunk size in chars (default 64). */
  maxChunk?: number
  /** Flush interval ms (default 16ms = ~60fps). */
  flushMs?: number
  /** Optional token counter (default chars * 0.25). */
  tokenCounter?: (s: string) => number
}

export class StreamBuffer extends EventEmitter {
  private buffer = ""
  private index = 0
  private startedAt = 0
  private stoppedAt = 0
  private cancelled = false
  private paused = false
  private pausedAt = 0
  private totalPausedMs = 0
  private flushHandle: ReturnType<typeof setInterval> | null = null
  private opts: Required<StreamOptions>
  private sourceDone = false

  constructor(opts: StreamOptions = {}) {
    super()
    this.opts = {
      minChunk: opts.minChunk ?? 8,
      maxChunk: opts.maxChunk ?? 64,
      flushMs: opts.flushMs ?? 16,
      tokenCounter: opts.tokenCounter ?? ((s) => Math.ceil(s.length * 0.25)),
    }
  }

  /** Begin consuming a stream (readable stream of Uint8Array). */
  consume(stream: ReadableStream<Uint8Array> | AsyncIterable<string>): void {
    this.startedAt = Date.now()
    this.flushHandle = setInterval(() => this.flush(), this.opts.flushMs)
    void this.runConsumer(stream).catch((e) => {
      log.error("stream", `consumer error: ${(e as Error).message}`)
      this.finish()
    })
  }

  /** Push raw text in (for callers that already have a string source). */
  push(text: string): void {
    if (this.cancelled) return
    if (!this.startedAt) this.startedAt = Date.now()
    this.buffer += text
    if (!this.flushHandle) {
      this.flushHandle = setInterval(() => this.flush(), this.opts.flushMs)
    }
  }

  /** Mark the source as done. */
  done(): void { this.sourceDone = true; this.finish() }

  /** Cancel the stream. The current buffer is flushed, then no more. */
  cancel(reason = "user cancelled"): void {
    this.cancelled = true
    this.stoppedAt = Date.now()
    log.info("stream", `cancelled: ${reason}`)
    this.emit("cancelled", { reason, elapsedMs: this.elapsedMs() })
    this.finish()
  }

  /** Pause emission. push() will still buffer. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    this.pausedAt = Date.now()
    this.emit("paused", { elapsedMs: this.elapsedMs() })
  }

  /** Resume emission. */
  resume(): void {
    if (!this.paused) return
    this.pausedAt = 0
    this.totalPausedMs += Date.now() - this.pausedAt
    this.paused = false
    this.emit("resumed", { elapsedMs: this.elapsedMs() })
  }

  /** Force a flush of whatever is in the buffer. */
  flushNow(): void { this.flush(true) }

  /** Synchronous: elapsed wall time minus paused time. */
  elapsedMs(): number {
    if (!this.startedAt) return 0
    const now = this.stoppedAt || Date.now()
    let paused = this.totalPausedMs
    if (this.paused) paused += Date.now() - this.pausedAt
    return now - this.startedAt - paused
  }

  /** Total tokens seen (rough). */
  tokenCount(): number { return this.opts.tokenCounter(this.fullText) }

  /** Full text so far. */
  get fullText(): string { return this._fullText }

  private _fullText = ""

  private async runConsumer(stream: ReadableStream<Uint8Array> | AsyncIterable<string>): Promise<void> {
    if (isReadableStream(stream)) {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      try {
        while (!this.cancelled) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) this.push(decoder.decode(value, { stream: true }))
        }
      } finally {
        reader.releaseLock()
      }
    } else {
      for await (const chunk of stream as AsyncIterable<string>) {
        if (this.cancelled) break
        this.push(chunk)
      }
    }
    this.sourceDone = true
  }

  private flush(force = false): void {
    if (this.cancelled) return
    if (this.paused) return
    if (this.buffer.length === 0) {
      if (this.sourceDone) this.finish()
      return
    }
    // Pick chunk size
    const want = force
      ? this.buffer.length
      : Math.min(this.opts.maxChunk, Math.max(this.opts.minChunk, Math.floor(this.buffer.length / 2)))
    const text = this.buffer.slice(0, want)
    this.buffer = this.buffer.slice(want)
    this._fullText += text
    const chunk: StreamChunk = {
      text,
      index: this.index++,
      done: this.sourceDone && this.buffer.length === 0,
      elapsedMs: this.elapsedMs(),
    }
    this.emit("chunk", chunk)
    if (chunk.done) this.finish()
  }

  private finish(): void {
    if (this.flushHandle) {
      clearInterval(this.flushHandle)
      this.flushHandle = null
    }
    // Emit any remainder
    if (this.buffer.length > 0 && !this.cancelled) {
      const chunk: StreamChunk = {
        text: this.buffer,
        index: this.index++,
        done: true,
        elapsedMs: this.elapsedMs(),
      }
      this._fullText += this.buffer
      this.buffer = ""
      this.emit("chunk", chunk)
    }
    this.stoppedAt = Date.now()
    this.emit("end", { totalChunks: this.index, totalChars: this._fullText.length, elapsedMs: this.elapsedMs(), cancelled: this.cancelled })
  }
}

function isReadableStream(x: unknown): x is ReadableStream<Uint8Array> {
  return typeof x === "object" && x !== null && "getReader" in x
}
