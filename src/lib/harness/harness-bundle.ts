/**
 * Harness Bundle — Phase 5e Phase 1 (2026-05-17).
 *
 * Single typed envelope that every Runtime adapter consumes ONCE per
 * turn. Replaces the pre-Phase-5e shape where each Runtime
 * (`claude-client.ts` / `builtin-tools/index.ts` /
 * `codex/proxy/unified-adapter.ts`) independently decided:
 *
 *   - which built-in capabilities to mount
 *   - whether to scan user-installed MCP servers / Skills
 *   - whether to surface ClaudeCode-side `~/.claude/*` configuration
 *   - which capabilities are "advertised but actually unavailable"
 *
 * Phase 5e formalises three layers — every Runtime must walk through
 * the SAME bundle, even when a particular path can only execute a
 * subset:
 *
 *   1. **Built-in Harness** — CodexWeb ships these (widget, memory,
 *      tasks_and_notify, image_generation, media_import, dashboard,
 *      cli_tools, ...). Sourced from `capability-contract.ts`.
 *
 *   2. **User CodexWeb Harness** — what the user installed *inside
 *      CodexWeb* (Settings → MCP servers, Skills, slash commands,
 *      project CLAUDE.md). Sourced from
 *      `user-codepilot-extensions.ts` scanner.
 *
 *   3. **External Framework Harness** — what the user installed
 *      *inside another agent framework* and CodexWeb should at least
 *      surface to the model (e.g. `~/.claude/mcp.json`,
 *      `~/.claude/CLAUDE.md`, `~/.codex/config.toml` plugins). Cross-
 *      framework PERCEPTION is mandatory; CROSS-framework EXECUTION
 *      is best-effort (Codex MCP can't run a ClaudeCode-only hook,
 *      etc.). Sourced from `external-framework-harness.ts` scanner.
 *
 * ── Invariants the type system enforces ────────────────────────────
 *
 *   - Any extension where `executable === false` MUST carry a
 *     `perceptionHint` so the model gets a human-readable explanation
 *     of why the tool is visible-but-not-callable + the alternative
 *     Runtime / Provider that CAN execute it. Builder throws on
 *     missing hint.
 *
 *   - `relatedCapabilityId` (when present) must resolve to a
 *     capability in `HARNESS_CAPABILITIES`. Builder cross-checks.
 *
 *   - "感知 ≠ 可执行" — extensions where `executable === false`
 *     contribute to `contextFragments` (so model + UI list it) but
 *     do NOT contribute to `toolSurfaces` (model can't call them).
 *     The split is structural, not convention.
 */

import type { RuntimeId } from '@/lib/runtime/runtime-id';
import {
  HARNESS_CAPABILITIES,
  type CapabilityContract,
} from './capability-contract';

// ─────────────────────────────────────────────────────────────────────
// Layer 1 — Built-in Harness capability mount
// ─────────────────────────────────────────────────────────────────────

/**
 * A capability the current Runtime + Provider path actually mounts.
 * For deferred / unsupported entries see `UnavailableCapability`.
 */
export interface BuiltinCapabilityMount {
  readonly capabilityId: string;
  readonly displayName: string;
  readonly toolNames: readonly string[];
  /** How the tool surface is implemented in this Runtime. Mirrors
   *  the `RuntimeExposureKind` from `capability-contract.ts`. */
  readonly exposureKind:
    | 'mcp_server'
    | 'ai_sdk_tool'
    | 'bridge_executable';
  /** True iff every `toolNames` entry is callable by the model in
   *  the current Runtime path. False here means the Runtime can list
   *  the capability but the user must switch Runtime to execute. */
  readonly executable: boolean;
  /** When `executable === false`, required: a model-visible / UI-
   *  visible explanation. e.g. "当前 Runtime 协议未开放第三方工具
   *  挂载，无法调用 CodexWeb Widget；如需 Widget 请切到 Native
   *  Runtime 或 ClaudeCode SDK". */
  readonly perceptionHint?: string;
  /** Permission boundary the wrapper / UI should display.
   *  `auto_safe` = no approval needed (allowlisted read-only).
   *  `requires_approval` = wrapper asks user.
   *  `bypass_in_full_access` = approval needed except in full_access
   *  profile (mirrors current `bypassPermissions` behaviour for the
   *  Native runtime). */
  readonly trustBoundary:
    | 'auto_safe'
    | 'requires_approval'
    | 'bypass_in_full_access';
}

export interface UnavailableCapability {
  readonly capabilityId: string;
  readonly displayName: string;
  /** Why the current Runtime + Provider path can't execute this. */
  readonly reason: string;
  /** Suggested alternative Runtime (and / or Provider) where the
   *  capability IS executable. */
  readonly suggestedRuntime?: RuntimeId;
}

// ─────────────────────────────────────────────────────────────────────
// Layer 2 — User CodexWeb Harness extension
// ─────────────────────────────────────────────────────────────────────

export type UserExtensionKind =
  | 'mcp_server'
  | 'skill'
  | 'slash_command'
  | 'prompt_fragment'
  | 'workspace_rule';

export interface UserHarnessExtension {
  readonly kind: UserExtensionKind;
  /** Where the user installed it inside CodexWeb. */
  readonly origin: 'codepilot_settings' | 'project_file';
  readonly id: string;
  readonly displayName: string;
  /** Path / identifier (read-only reference for Settings UI; never
   *  used to read auth tokens). */
  readonly sourcePath?: string;
  readonly executable: boolean;
  /** Required when `executable === false`. */
  readonly perceptionHint?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Layer 3 — External Framework Harness reference
// ─────────────────────────────────────────────────────────────────────

export type ExternalFrameworkId = 'claude_code' | 'codex' | 'future';

export type ExternalExtensionKind =
  | 'mcp_server'
  | 'skill'
  | 'cli'
  | 'memory'
  | 'plugin'
  | 'hook';

export interface ExternalFrameworkHarnessRef {
  readonly framework: ExternalFrameworkId;
  readonly kind: ExternalExtensionKind;
  /** Read-only filesystem origin (config file path / install
   *  location). The scanner reads non-secret config; auth tokens are
   *  forbidden — `scan-external-framework-harness.ts` enforces the
   *  filename allowlist. */
  readonly origin: string;
  readonly id: string;
  readonly displayName: string;
  readonly executable: boolean;
  /** When false, mandatory: tell the model + UI why the external
   *  extension is perceptible but not callable in this Runtime, and
   *  which Runtime / Provider COULD execute it. */
  readonly perceptionHint?: string;
}

// ─────────────────────────────────────────────────────────────────────
// HarnessBundle — assembled per-turn input for each Runtime adapter
// ─────────────────────────────────────────────────────────────────────

export interface HarnessBundle {
  readonly runtimeId: RuntimeId;
  readonly providerId: string;
  readonly builtinCapabilities: readonly BuiltinCapabilityMount[];
  readonly userCapabilities: readonly UserHarnessExtension[];
  readonly externalExtensions: readonly ExternalFrameworkHarnessRef[];
  readonly unavailableCapabilities: readonly UnavailableCapability[];
  /** Diagnostic record — what the bundle decided per capability id +
   *  why. Mirrors `CompiledContext.diagnostics.capabilityDecisions`
   *  but at the bundle granularity (which is one layer above the
   *  prompt compiler). */
  readonly diagnostics: BundleDiagnostics;
}

export interface BundleDiagnostics {
  readonly capabilityDecisions: readonly CapabilityBundleDecision[];
  /** Number of perception-only (executable=false) entries across all
   *  three layers — used by Settings UI to show a count. */
  readonly perceptionOnlyCount: number;
}

export interface CapabilityBundleDecision {
  readonly capabilityId: string;
  readonly outcome:
    | 'builtin_mounted'
    | 'builtin_unavailable'
    | 'user_extension'
    | 'external_perception_only';
  readonly reason: string;
}

// ─────────────────────────────────────────────────────────────────────
// Builder input + builder
// ─────────────────────────────────────────────────────────────────────

export interface BuildHarnessBundleInput {
  readonly runtimeId: RuntimeId;
  readonly providerId: string;
  /** Capabilities the caller's gating logic has decided to attempt
   *  to mount this turn (workspace / keyword / always rules upstream
   *  of the bundle). Bundle filters this against capability-contract
   *  exposure + the runtime's mount limits. */
  readonly attemptedCapabilities: ReadonlySet<string>;
  /** Pre-scanned User Harness — see `user-codepilot-extensions.ts`. */
  readonly userCapabilities?: readonly UserHarnessExtension[];
  /** Pre-scanned External Framework Harness — see
   *  `external-framework-harness.ts`. */
  readonly externalExtensions?: readonly ExternalFrameworkHarnessRef[];
  /** Optional overrides — used by tests + future Codex Account
   *  degradation work to mark specific capabilities as
   *  perception-only on a provider path that fundamentally can't
   *  execute them. The builder honours this by emitting the
   *  capability as `unavailableCapabilities` with the supplied
   *  reason. */
  readonly forceUnavailable?: ReadonlyMap<string, { reason: string; suggestedRuntime?: RuntimeId }>;
}

/**
 * Map RuntimeId → the `exposure` key in `CapabilityContract`. Identical
 * to the helper in `context-compiler.ts` (kept private to bundle for
 * dependency direction — compiler should ultimately consume bundle,
 * not the other way around).
 */
function exposureKeyForRuntime(
  runtimeId: RuntimeId,
): 'claudecode_sdk' | 'native' | 'codex_proxy' {
  switch (runtimeId) {
    case 'claude_code':
      return 'claudecode_sdk';
    case 'codepilot_runtime':
      return 'native';
    case 'codex_runtime':
      return 'codex_proxy';
  }
}

/** Default trust boundary derivation. Tools that match the current
 *  Phase 5e P0 allowlist get `auto_safe`; everything else default
 *  `requires_approval`. Phase 5 mutationLevel will refine this. */
function deriveTrustBoundary(
  capability: CapabilityContract,
): 'auto_safe' | 'requires_approval' | 'bypass_in_full_access' {
  // Read-only capabilities — all tools are listed in PERMISSION_SAFE_TOOLS
  // in agent-tools.ts. Mirror the classification here so the bundle's
  // trustBoundary matches the wrapper's actual behaviour.
  const READ_ONLY_CAPS = new Set(['memory', 'widget']);
  if (READ_ONLY_CAPS.has(capability.id)) {
    // Widget = load_widget_guidelines (read static spec) → safe.
    // Memory = read-only search/get/recent.
    return 'auto_safe';
  }
  // Capabilities that write filesystem / DB / shell-exec → must
  // require approval. Phase 5 mutationLevel makes this per-tool;
  // Phase 1 builds it at capability granularity.
  return 'requires_approval';
}

/**
 * Build the HarnessBundle for a turn. The compile step (system prompt
 * assembly, tool descriptors) still goes through `context-compiler.ts`
 * + `runtime-adapter.ts` for now; this bundle is the data envelope
 * those adapters consume.
 *
 * Throws on contract violations (executable=false without
 * perceptionHint, dangling relatedCapabilityId, etc.). Throwing is
 * deliberate — silently producing a bundle with missing perception
 * data is exactly the regression the Phase 5e plan is built against.
 */
export function buildHarnessBundle(
  input: BuildHarnessBundleInput,
): HarnessBundle {
  const exposureKey = exposureKeyForRuntime(input.runtimeId);
  const builtinMounted: BuiltinCapabilityMount[] = [];
  const unavailable: UnavailableCapability[] = [];
  const decisions: CapabilityBundleDecision[] = [];

  for (const cap of HARNESS_CAPABILITIES) {
    const forced = input.forceUnavailable?.get(cap.id);
    if (forced) {
      unavailable.push({
        capabilityId: cap.id,
        displayName: cap.displayName,
        reason: forced.reason,
        ...(forced.suggestedRuntime ? { suggestedRuntime: forced.suggestedRuntime } : {}),
      });
      decisions.push({
        capabilityId: cap.id,
        outcome: 'builtin_unavailable',
        reason: `forced unavailable: ${forced.reason}`,
      });
      continue;
    }

    if (!input.attemptedCapabilities.has(cap.id)) {
      // Caller didn't ask for this — don't decide, don't list. The
      // compiler / adapter only emit fragments for capabilities the
      // caller mounted; we follow the same rule here.
      continue;
    }
    const exposure = cap.exposure[exposureKey];

    if (exposure.kind === 'unsupported') {
      unavailable.push({
        capabilityId: cap.id,
        displayName: cap.displayName,
        reason: exposure.notes ?? `${exposureKey} exposure unsupported in capability-contract.ts`,
      });
      decisions.push({
        capabilityId: cap.id,
        outcome: 'builtin_unavailable',
        reason: `exposure.${exposureKey}.kind=unsupported`,
      });
      continue;
    }

    if (cap.status === 'deferred' || cap.status === 'unsupported') {
      unavailable.push({
        capabilityId: cap.id,
        displayName: cap.displayName,
        reason: cap.deferredReason ?? `status=${cap.status}`,
      });
      decisions.push({
        capabilityId: cap.id,
        outcome: 'builtin_unavailable',
        reason: `capability status=${cap.status}`,
      });
      continue;
    }

    // Capability is `live` + exposure kind is one of the executable
    // kinds. Build the mount entry.
    const mount: BuiltinCapabilityMount = {
      capabilityId: cap.id,
      displayName: cap.displayName,
      toolNames: cap.toolNames,
      exposureKind: exposure.kind as
        | 'mcp_server'
        | 'ai_sdk_tool'
        | 'bridge_executable',
      executable: true,
      trustBoundary: deriveTrustBoundary(cap),
    };
    builtinMounted.push(mount);
    decisions.push({
      capabilityId: cap.id,
      outcome: 'builtin_mounted',
      reason: `${exposureKey} exposure.kind=${exposure.kind}`,
    });
  }

  // Validate user + external layers — perceptionHint contract.
  const userCapabilities = input.userCapabilities ?? [];
  const externalExtensions = input.externalExtensions ?? [];

  for (const ext of userCapabilities) {
    if (!ext.executable && !ext.perceptionHint) {
      throw new Error(
        `UserHarnessExtension "${ext.id}" has executable=false but no perceptionHint. Phase 5e contract: perception-only extensions must explain why they can't be called in the current Runtime.`,
      );
    }
  }

  let perceptionOnlyCount = 0;
  for (const ref of externalExtensions) {
    if (!ref.executable && !ref.perceptionHint) {
      throw new Error(
        `ExternalFrameworkHarnessRef "${ref.framework}/${ref.id}" has executable=false but no perceptionHint. Phase 5e contract: perception-only references must tell the model + UI which Runtime can actually execute them.`,
      );
    }
    if (!ref.executable) perceptionOnlyCount++;
  }
  for (const ext of userCapabilities) {
    if (!ext.executable) perceptionOnlyCount++;
  }

  // Decision rows for user / external for diagnostics completeness.
  for (const ext of userCapabilities) {
    decisions.push({
      capabilityId: `user:${ext.id}`,
      outcome: 'user_extension',
      reason: `${ext.kind} from ${ext.origin}${ext.executable ? '' : ' (perception-only)'}`,
    });
  }
  for (const ref of externalExtensions) {
    decisions.push({
      capabilityId: `external:${ref.framework}/${ref.id}`,
      outcome: 'external_perception_only',
      reason: `${ref.framework} ${ref.kind} at ${ref.origin}${ref.executable ? ' (executable)' : ' (perception-only)'}`,
    });
  }

  return {
    runtimeId: input.runtimeId,
    providerId: input.providerId,
    builtinCapabilities: builtinMounted,
    userCapabilities,
    externalExtensions,
    unavailableCapabilities: unavailable,
    diagnostics: {
      capabilityDecisions: decisions,
      perceptionOnlyCount,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience accessors — used by Settings UI matrix derivation
// ─────────────────────────────────────────────────────────────────────

export function bundleExecutableCapabilities(
  bundle: HarnessBundle,
): readonly BuiltinCapabilityMount[] {
  return bundle.builtinCapabilities.filter((c) => c.executable);
}

export function bundlePerceptionOnlyExtensions(
  bundle: HarnessBundle,
): {
  readonly user: readonly UserHarnessExtension[];
  readonly external: readonly ExternalFrameworkHarnessRef[];
} {
  return {
    user: bundle.userCapabilities.filter((e) => !e.executable),
    external: bundle.externalExtensions.filter((e) => !e.executable),
  };
}
