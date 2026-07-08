/**
 * sdk-subprocess-env.ts — Single-source-of-truth env builder for every SDK
 * subprocess spawn (main chat stream, generateTextViaSdk, provider-doctor
 * live probe, future callers).
 *
 * Why this exists: the per-request shadow `~/.claude/` (claude-home-shadow.ts)
 * implements the "provider-group ownership of credentials" rule. Multiple
 * code paths spawn the SDK, and every one of them must apply the same rule
 * — otherwise auxiliary requests (compression, doctor probes, sub-agent
 * delegations) silently bypass the shadow and pick up cc-switch credentials,
 * making the diagnostic and main flows disagree. See P2 reviews on
 * claude-client.ts:332 (`generateTextViaSdk`) and provider-doctor.ts:758
 * (`runLiveProbe`).
 *
 * Callers receive a `{ env, shadow }` pair and MUST call `shadow.cleanup()`
 * in a `finally` block. The cleanup is idempotent and a no-op when no
 * shadow was actually built (env-mode pass-through).
 */
import os from 'node:os';
import { findGitBash, getExpandedPath } from './platform';
import { toClaudeCodeEnv, type ResolvedProvider } from './provider-resolver';
import { createShadowClaudeHome, type ShadowHome } from './claude-home-shadow';

export interface SdkSubprocessSetup {
  /** Env to pass to the SDK's `env` Option (already sanitized for spawn). */
  env: Record<string, string>;
  /** Shadow handle. Caller MUST call `cleanup()` in a finally block. */
  shadow: ShadowHome;
}

/**
 * Build the env that goes to the SDK subprocess for a resolved provider.
 *
 * Behavior:
 * - When `resolved.provider` is set (explicit DB provider): builds a per-
 *   request shadow ~/.claude/ that strips ANTHROPIC_* keys from settings.json
 *   AND ~/.claude.json, while preserving every other user-level config
 *   (mcpServers, hooks, enabledPlugins, skills, agents, plugins, commands,
 *   CLAUDE.md, .credentials.json). HOME and USERPROFILE are pointed at the
 *   shadow root so the SDK's settings loader reads our stripped copies
 *   instead of the live ones.
 * - When `resolved.provider` is undefined (env mode / cc-switch path):
 *   returns a pass-through real-HOME setup. cc-switch settings.json supplies
 *   credentials normally.
 *
 * In both cases, the returned env has CodexWeb's PATH expansion, Git Bash
 * detection (Windows), and the provider's auth/baseUrl/model env applied via
 * `toClaudeCodeEnv()`.
 */
export function prepareSdkSubprocessEnv(resolved: ResolvedProvider): SdkSubprocessSetup {
  const sdkEnv: Record<string, string> = { ...process.env as Record<string, string> };

  // Provider-group ownership: only build a shadow when an explicit DB
  // provider is selected. Env-mode (resolved.provider === undefined) is the
  // Claude Code group and must continue to use the real ~/.claude/ + cc-switch.
  const shadow = createShadowClaudeHome({ stripAuth: !!resolved.provider });
  sdkEnv.HOME = shadow.home;
  sdkEnv.USERPROFILE = shadow.home;

  // PATH expansion is needed in both Electron and dev so the subprocess can
  // find user-installed CLIs (npm global, brew, bun, etc.).
  sdkEnv.PATH = getExpandedPath();

  // Drop CLAUDECODE so a CodexWeb launched from inside a `claude` session
  // doesn't trip the SDK's "nested session" guard.
  delete sdkEnv.CLAUDECODE;

  // Windows-only: auto-detect Git Bash if not already configured.
  if (process.platform === 'win32' && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
    const gitBashPath = findGitBash();
    if (gitBashPath) sdkEnv.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath;
  }

  // Apply the provider's resolved auth/baseUrl/model env. This MUST come
  // after the shadow setup, because toClaudeCodeEnv may clean ANTHROPIC_*
  // from baseEnv and we want HOME/USERPROFILE to survive that cleanup.
  const resolvedEnv = toClaudeCodeEnv(sdkEnv, resolved);
  Object.assign(sdkEnv, resolvedEnv);

  return { env: sdkEnv, shadow };
}
