/**
 * Size-based rotation for the persistent main log (B-025).
 *
 * The old `setupPersistentMainLog` had `No size-based rotation` — it only ever
 * did a one-shot sanitizer rename and then appended forever. A real user hit a
 * 12.5 GB `codepilot-main.log` because the Codex app-server INFO tracing flood
 * streamed into it unbounded. This caps the active file and keeps a small ring
 * of numbered archives instead.
 *
 * Pure node:fs (no `electron`) so electron/main.ts can import it and the unit
 * tests can exercise rotation against a temp dir.
 */
import fs from 'node:fs';

/**
 * Rotate `activeLogFile` → `.1`, shifting existing `.1`→`.2` … and dropping the
 * oldest beyond `maxArchives`. Best-effort: a rotation failure (locked file,
 * readonly FS) must never block logging, so all of it is swallowed.
 */
export function rotateLogFiles(activeLogFile: string, maxArchives: number): void {
  try {
    const oldest = `${activeLogFile}.${maxArchives}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let i = maxArchives - 1; i >= 1; i--) {
      const from = `${activeLogFile}.${i}`;
      const to = `${activeLogFile}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    if (fs.existsSync(activeLogFile)) fs.renameSync(activeLogFile, `${activeLogFile}.1`);
  } catch {
    /* rotation is best-effort */
  }
}

export interface RotatingLogWriter {
  /** Append a line, rotating first if it would push the active file over cap. */
  write(line: string): void;
  /** Close the underlying fd (on app quit). */
  end(): void;
  /** Bytes written to the current active file since it was opened. */
  currentBytes(): number;
}

function openAppendFd(file: string): number | null {
  try {
    return fs.openSync(file, 'a');
  } catch {
    return null;
  }
}

/**
 * Append-only writer that rotates `activeLogFile` once it would exceed
 * `maxBytes`, keeping `maxArchives` numbered archives. On creation, if a
 * leftover active file is ALREADY over cap (e.g. the 12 GB file from before
 * this fix), it rotates immediately so the session marker lands in a fresh file
 * instead of appending to the giant one.
 *
 * Uses SYNCHRONOUS fd writes (openSync / writeSync / closeSync), NOT an async
 * `createWriteStream`, because the cap must be a real hard limit (B-025 review):
 *  - a buffered stream can flush queued writes AFTER the rotate-rename — landing
 *    them in the just-archived file, or letting the active file drift past cap;
 *  - on Windows, renaming a file whose stream handle is still open can fail and
 *    (since rotateLogFiles swallows errors) silently leave the file growing.
 * Closing the fd before each rename makes rotation deterministic and
 * Windows-safe. Main-log write volume is low (especially after the B-025 Codex
 * tracing reduction), so synchronous writes are acceptable.
 */
export function createRotatingLogWriter(opts: {
  activeLogFile: string;
  maxBytes: number;
  maxArchives: number;
}): RotatingLogWriter {
  const { activeLogFile, maxBytes, maxArchives } = opts;

  let startBytes = 0;
  try {
    startBytes = fs.existsSync(activeLogFile) ? fs.statSync(activeLogFile).size : 0;
  } catch {
    startBytes = 0;
  }
  // A leftover file already over cap (the B-025 12 GB case) gets archived now,
  // not appended to.
  if (startBytes > maxBytes) {
    rotateLogFiles(activeLogFile, maxArchives);
    startBytes = 0;
  }

  let fd: number | null = openAppendFd(activeLogFile);
  let bytes = startBytes;

  return {
    write(line: string): void {
      const lineBytes = Buffer.byteLength(line);
      // Rotate when the active file would exceed the cap. `bytes > 0` guard so a
      // single line larger than the whole cap still gets written somewhere (to
      // the freshly-rotated file) instead of looping.
      if (bytes + lineBytes > maxBytes && bytes > 0) {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
        rotateLogFiles(activeLogFile, maxArchives);
        fd = openAppendFd(activeLogFile);
        bytes = 0;
      }
      if (fd !== null) {
        try { fs.writeSync(fd, line); } catch { /* best-effort */ }
      }
      bytes += lineBytes;
    },
    end(): void {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        fd = null;
      }
    },
    currentBytes(): number {
      return bytes;
    },
  };
}
