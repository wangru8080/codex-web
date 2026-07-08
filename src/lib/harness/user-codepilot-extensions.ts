/**
 * User CodexWeb Harness scanner — Phase 5e Phase 1 (2026-05-17).
 *
 * Discovers what the user installed INSIDE CodexWeb (Settings → MCP
 * servers, project-level `.mcp.json`, project CLAUDE.md). Produces
 * `UserHarnessExtension[]` consumed by `harness-bundle.ts`.
 *
 * Strict boundaries:
 *
 *   - **Read-only.** Never writes user files.
 *   - **No auth tokens.** Only reads MCP server config metadata
 *     (name, command, args) — explicit allowlist; if a config file
 *     contains an `auth_token` / `api_key` field, we don't surface
 *     it to the bundle.
 *   - **Best-effort.** A read error degrades to "user has no
 *     extensions in this category" rather than throwing — the user
 *     should still be able to chat when one of their config files
 *     is malformed.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  loadCodexWebMcpServers,
  loadProjectMcpServers,
} from '@/lib/mcp-loader';
import type { RuntimeId } from '@/lib/runtime/runtime-id';
import type { UserHarnessExtension } from './harness-bundle';

export interface UserScannerInput {
  readonly workspacePath?: string;
  /**
   * Phase 5e review round 3 fix P2 #C (2026-05-18) — the active
   * Runtime determines whether each scanned extension is actually
   * EXECUTABLE in this turn or merely perceptible. Pre-fix the
   * scanner flagged every entry as `executable: true`, which
   * leaked into the model's "Callable in this Runtime" prompt
   * section and risked the model fabricating tool calls (e.g. a
   * Codex Runtime turn pretending it could invoke a ClaudeCode
   * `.claude/skills/` skill that has no runtime bridge).
   *
   * Rules per extension kind (updated 2026-05-18 review round 4 P1):
   *
   *   - `mcp_server`        → executable on `claude_code` (mcp-loader
   *                           → SDK `mcpServers` option) and on
   *                           `codepilot_runtime` (buildMcpToolSet
   *                           → ai-sdk ToolSet). **NOT executable on
   *                           `codex_runtime`** — the Codex proxy
   *                           does not mount user MCP servers
   *                           (verified: no buildMcpToolSet /
   *                           loadCodexWebMcpServers / loadAllMcpServers
   *                           call anywhere under `src/lib/codex/`).
   *                           Codex Runtime entry returns
   *                           perception_only with a "switch to
   *                           ClaudeCode SDK or CodexWeb Native"
   *                           hint. The contract is double-pinned by
   *                           `codex-user-mcp-wiring.test.ts`.
   *   - `workspace_rule`    → executable on every Runtime. Workspace
   *                           rules are text injected into context;
   *                           they don't "execute" in a tool sense.
   *   - `skill`             → executable ONLY on `claude_code`
   *                           (ClaudeCode SDK natively understands
   *                           `.claude/skills/`). Other Runtimes
   *                           treat as perception_only.
   *   - `slash_command`     → executable ONLY on `claude_code` for
   *                           the same reason — slash command MD
   *                           files are a ClaudeCode-only surface.
   *   - `prompt_fragment`   → executable on every Runtime (text).
   *
   * Caller MUST pass `runtimeId`; omitting it falls back to
   * "perception_only when unsafe" — defensive default for callers
   * that haven't been updated yet, and the tests pin this
   * conservative fallback so a future entry kind doesn't quietly
   * become "callable everywhere".
   */
  readonly runtimeId?: RuntimeId;
}

/**
 * Scan everything the user has plugged into CodexWeb directly.
 *
 * Returns the merged list across (in this order):
 *   - Settings-level MCP servers (`mcp-loader.loadCodexWebMcpServers`)
 *   - Project-level `.mcp.json` (`mcp-loader.loadProjectMcpServers`)
 *   - Project `CLAUDE.md` (workspace-level instructions; always
 *     visible cross-Runtime because the file sits inside the
 *     workspace).
 *   - Project `.claude/skills/<skill-name>/` directories (ClaudeCode-
 *     style user skills committed at the project root). Each
 *     subdirectory becomes one `kind: 'skill'` extension.
 *   - Project `.claude/commands/*.md` slash command definitions.
 *   - Project `.claude/CLAUDE.md` (project-local override of the
 *     root CLAUDE.md — same shape, lower priority).
 *
 * Phase 5e review fix P1/P2 #4 (2026-05-18) — the original first
 * pass only scanned MCP + CLAUDE.md and the comment promised
 * skills/slash too. This implementation closes the gap.
 */
/**
 * Phase 5e review round 3 fix P2 #C — runtime-aware executable
 * classification. Returns the `{ executable, perceptionHint? }`
 * doublet for a given kind under the active Runtime.
 *
 * Defensive default: if `runtimeId` is undefined, every kind that
 * isn't universally cross-runtime gets `executable=false`. This
 * keeps unmigrated callers conservative — they won't accidentally
 * leak unrunnable tools into the model's "Callable" prompt section.
 */
function executableForKind(
  kind: UserHarnessExtension['kind'],
  runtimeId: RuntimeId | undefined,
): { executable: boolean; perceptionHint?: string } {
  switch (kind) {
    case 'mcp_server':
      // Phase 5e review round 4 fix P1 (2026-05-18) — Codex Runtime
      // does NOT mount user MCP servers. The Codex provider proxy
      // (`src/lib/codex/proxy/*`) only mounts:
      //   - codepilot_* builtin bridge tools (createCodexWebBuiltinTools)
      //   - Codex's own incoming function tools (translateResponsesTools)
      // grep verified: `src/lib/codex/` contains no
      // `buildMcpToolSet` / `loadCodexWebMcpServers` /
      // `loadAllMcpServers` call. Marking user MCP as executable on
      // Codex Runtime would invite the model to call tools that
      // aren't on its wire — exactly the "假装能调用" reviewer concern.
      //
      // ClaudeCode SDK mounts user MCPs via mcp-loader → SDK
      // `mcpServers` option in `claude-client.ts`. CodexWeb Native
      // mounts via `buildMcpToolSet()` in `agent-tools.ts:90` →
      // ai-sdk ToolSet. Both are real wire-ups.
      if (runtimeId === 'codex_runtime') {
        return {
          executable: false,
          perceptionHint:
            'CodexWeb user MCP servers are not mounted on the Codex Runtime proxy path. Switch to ClaudeCode SDK or CodexWeb Native Runtime to invoke this MCP server.',
        };
      }
      // claude_code / codepilot_runtime / undefined → cross-Runtime
      // executable. For undefined the conservative default is to
      // treat the call site as "modern adapter that wired MCPs", in
      // line with the rest of the migrated callers. Tests pin both
      // claude_code and codepilot_runtime as executable.
      return { executable: true };
    case 'workspace_rule':
    case 'prompt_fragment':
      // Cross-Runtime — context-compiler reads workspace rules /
      // prompt fragments as text on every Runtime path.
      return { executable: true };
    case 'skill':
      if (runtimeId === 'claude_code') return { executable: true };
      return {
        executable: false,
        perceptionHint:
          '`.claude/skills/` is a ClaudeCode SDK surface. The current Runtime cannot invoke it; switch to ClaudeCode SDK Runtime to use this skill.',
      };
    case 'slash_command':
      if (runtimeId === 'claude_code') return { executable: true };
      return {
        executable: false,
        perceptionHint:
          '`.claude/commands/<name>.md` slash commands are ClaudeCode-only. The current Runtime cannot invoke them; switch to ClaudeCode SDK Runtime.',
      };
  }
}

export function scanUserCodexWebExtensions(
  input: UserScannerInput = {},
): readonly UserHarnessExtension[] {
  const out: UserHarnessExtension[] = [];
  const runtimeId = input.runtimeId;

  // Settings-level MCP servers — installed via CodexWeb Settings UI
  // and stored in the global config DB / file.
  try {
    const settingsMcp = loadCodexWebMcpServers();
    if (settingsMcp) {
      const { executable, perceptionHint } = executableForKind('mcp_server', runtimeId);
      for (const [name] of Object.entries(settingsMcp)) {
        out.push({
          kind: 'mcp_server',
          origin: 'codepilot_settings',
          id: `mcp:${name}`,
          displayName: name,
          executable,
          ...(perceptionHint ? { perceptionHint } : {}),
        });
      }
    }
  } catch {
    // ignore — settings file may not exist on first launch
  }

  // Project-level `.mcp.json` — read by `loadProjectMcpServers` from
  // the workspace root.
  if (input.workspacePath) {
    try {
      const projectMcp = loadProjectMcpServers(input.workspacePath);
      if (projectMcp) {
        const { executable, perceptionHint } = executableForKind('mcp_server', runtimeId);
        for (const [name] of Object.entries(projectMcp)) {
          out.push({
            kind: 'mcp_server',
            origin: 'project_file',
            id: `mcp:project:${name}`,
            displayName: `${name} (project .mcp.json)`,
            sourcePath: path.join(input.workspacePath, '.mcp.json'),
            executable,
            ...(perceptionHint ? { perceptionHint } : {}),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // Project workspace rule: CLAUDE.md at the workspace root.
  // ClaudeCode reads this directly; CodexWeb Native treats it as a
  // workspace_rule extension that the model should be aware of.
  if (input.workspacePath) {
    const { executable: workspaceExec, perceptionHint: workspaceHint } =
      executableForKind('workspace_rule', runtimeId);
    const claudeMd = path.join(input.workspacePath, 'CLAUDE.md');
    if (existsSafe(claudeMd)) {
      out.push({
        kind: 'workspace_rule',
        origin: 'project_file',
        id: 'workspace:CLAUDE.md',
        displayName: 'Project CLAUDE.md',
        sourcePath: claudeMd,
        executable: workspaceExec,
        ...(workspaceHint ? { perceptionHint: workspaceHint } : {}),
      });
    }

    // Project `.claude/CLAUDE.md` — ClaudeCode supports a nested
    // override; same workspace_rule executability semantics.
    const nestedClaudeMd = path.join(input.workspacePath, '.claude', 'CLAUDE.md');
    if (existsSafe(nestedClaudeMd)) {
      out.push({
        kind: 'workspace_rule',
        origin: 'project_file',
        id: 'workspace:.claude/CLAUDE.md',
        displayName: 'Project .claude/CLAUDE.md (override)',
        sourcePath: nestedClaudeMd,
        executable: workspaceExec,
        ...(workspaceHint ? { perceptionHint: workspaceHint } : {}),
      });
    }

    // Project `.claude/skills/<skill-name>/` — ClaudeCode-only surface;
    // every skill is `executable: false` on non-claude_code Runtimes.
    const { executable: skillExec, perceptionHint: skillHint } =
      executableForKind('skill', runtimeId);
    const skillsDir = path.join(input.workspacePath, '.claude', 'skills');
    for (const name of listSubdirsSafe(skillsDir)) {
      out.push({
        kind: 'skill',
        origin: 'project_file',
        id: `skill:project:${name}`,
        displayName: `${name} (.claude/skills/)`,
        sourcePath: path.join(skillsDir, name),
        executable: skillExec,
        ...(skillHint ? { perceptionHint: skillHint } : {}),
      });
    }

    // Project `.claude/commands/*.md` — ClaudeCode-only slash commands.
    const { executable: slashExec, perceptionHint: slashHint } =
      executableForKind('slash_command', runtimeId);
    const commandsDir = path.join(input.workspacePath, '.claude', 'commands');
    for (const name of listFilenamesSafe(commandsDir, '.md')) {
      const slashName = name.replace(/\.md$/, '');
      out.push({
        kind: 'slash_command',
        origin: 'project_file',
        id: `slash:project:${slashName}`,
        displayName: `/${slashName} (.claude/commands/)`,
        sourcePath: path.join(commandsDir, name),
        executable: slashExec,
        ...(slashHint ? { perceptionHint: slashHint } : {}),
      });
    }
  }

  return out;
}

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function listSubdirsSafe(dir: string): readonly string[] {
  if (!existsSafe(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}

function listFilenamesSafe(dir: string, ext?: string): readonly string[] {
  if (!existsSafe(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => (ext ? n.endsWith(ext) : true))
      .filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}
