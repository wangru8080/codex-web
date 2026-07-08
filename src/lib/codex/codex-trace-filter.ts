/**
 * Codex app-server tracing noise control (B-025).
 *
 * A user's main log reached 12.5 GB; ~99% of the recent tail was Codex
 * app-server INFO span tracing — `codex_core::tasks: enter/exit` and
 * `codex_core::session::handlers: enter/exit` — tens of thousands of lines in
 * seconds. Two defenses, both pure + unit-testable:
 *
 *  1. `resolveCodexRustLog` — default the spawned app-server to `RUST_LOG=warn`
 *     so it doesn't EMIT the INFO flood at all; opt back in explicitly.
 *  2. `shouldDropCodexTraceLine` — a backstop on the stderr tee that drops those
 *     specific high-frequency INFO spans even if something re-enables info
 *     tracing (operator RUST_LOG, older binary). It NEVER drops warn / error /
 *     fatal lines, so fatal-config fail-fast and real diagnostics survive.
 */

// Matches the high-cardinality span targets at their enter/exit boundary.
const HIGH_FREQ_SPAN_RE = /\bcodex_core::(?:tasks|session::handlers):\s*(?:enter|exit)\b/;

// Anything that smells like a real problem — keep it no matter what.
const KEEP_ALWAYS_RE = /\b(?:WARN|ERROR|FATAL|panic(?:ked)?)\b|error:/;

/**
 * True when `line` is a high-frequency Codex INFO span that should be dropped
 * from the persistent log/tee by default. Conservative: a line that looks like
 * a warning/error/fatal is always kept, even if it also mentions a span target.
 */
export function shouldDropCodexTraceLine(line: string): boolean {
  if (KEEP_ALWAYS_RE.test(line)) return false;
  return HIGH_FREQ_SPAN_RE.test(line);
}

/**
 * Resolve the `RUST_LOG` value for the spawned Codex app-server.
 *  - explicit operator `RUST_LOG` always wins;
 *  - else `CODEXWEB_CODEX_TRACE=1` opts into full `info` tracing for debugging;
 *  - else default to `warn` (no INFO flood).
 */
export function resolveCodexRustLog(env: Record<string, string | undefined>): string {
  const rustLog = env.RUST_LOG;
  if (rustLog && rustLog.trim()) return rustLog;
  if (env.CODEXWEB_CODEX_TRACE === '1') return 'info';
  return 'warn';
}
