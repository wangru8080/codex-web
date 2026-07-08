/**
 * BoundedLineRing — a fixed-budget ring buffer of recent log lines.
 *
 * B-025: `serverErrors` in electron/main.ts used to be an unbounded `string[]`
 * that appended EVERY server stdout/stderr chunk for the whole app lifetime. It
 * exists only to give the server-startup timeout / crash dialog a bit of recent
 * context — but under a Codex app-server tracing flood (tens of thousands of
 * lines in seconds) it grew without limit in main-process memory, contributing
 * to the disk + memory pressure behind the reported crashes.
 *
 * This keeps only the most recent lines, capped by BOTH a line count AND a byte
 * budget (whichever binds first), and splits incoming chunks into lines so one
 * giant chunk can't enter as a single unbounded entry. Pure (no I/O) so the cap
 * is unit-testable.
 */
export class BoundedLineRing {
  private lines: string[] = [];
  private bytes = 0;

  constructor(
    private readonly maxLines: number,
    private readonly maxBytes: number,
  ) {}

  /** Push a raw chunk; it's split into lines, trimmed, and bounded-appended. */
  push(chunk: string): void {
    for (const raw of chunk.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      this.lines.push(line);
      this.bytes += Buffer.byteLength(line);
      this.evict();
    }
  }

  private evict(): void {
    while (
      this.lines.length > 0 &&
      (this.lines.length > this.maxLines || this.bytes > this.maxBytes)
    ) {
      const dropped = this.lines.shift();
      if (dropped === undefined) break;
      this.bytes -= Buffer.byteLength(dropped);
    }
  }

  /** All retained lines, oldest → newest. */
  toArray(): string[] {
    return [...this.lines];
  }

  /** The most recent `n` lines (for the startup-timeout context). */
  recent(n: number): string[] {
    return this.lines.slice(-n);
  }

  get byteLength(): number {
    return this.bytes;
  }

  get length(): number {
    return this.lines.length;
  }

  clear(): void {
    this.lines = [];
    this.bytes = 0;
  }
}
