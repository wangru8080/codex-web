/**
 * Phase 7.0 — Runtime-agnostic Auto-Invoke Context Accounting contract.
 *
 * Replaces per-Runtime tool / mcp / skills accounting logic with a shared
 * abstraction so adding a new Agent runtime (or backend) doesn't require
 * rewriting token estimation, classification, or source-breadcrumb rules.
 *
 * Design driver (v7 user decision, 2026-05-20):
 *   "ClaudeCode + Native 都搞；Codex 看 SDK 接口；
 *    也得抽象，不然后面接新的 Agent 又会出问题"
 *
 * Reconnaissance finding: all three current Runtimes already emit the same
 * SSE tool_use event shape ({ id, name, input }) — see:
 *   - ClaudeCode  src/lib/claude-client.ts:1585 (block.type === 'tool_use')
 *   - Native      src/lib/agent-loop.ts:483-489 (case 'tool-call')
 *   - Codex       src/lib/codex/runtime.ts:82-134 (RuntimeRunEvent.tool_started)
 * So the contract is promotion of an already-shared shape, not invention.
 *
 * Public surface:
 *   - ToolInvocationRecord     — Runtime-agnostic record shape
 *   - ToolInvocationAccumulator — per-turn collector for streaming loops
 *   - collectAutoInvokeSnapshot — Runtime-agnostic snapshot producer
 *
 * Extending to a new Agent: see `docs/exec-plans/completed/context-accounting-runtime-contract.md`
 * section "跨 Agent 扩展规则" — any new Runtime MUST reuse this contract;
 * per-Runtime reinvention is explicitly rejected at plan-review time.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ContextAccountingEntry,
  ContextAccountingKind,
  ContextAccountingRuntimeId,
  RuntimeContextAccountingSnapshot,
} from '@/types';
import { discoverSkills } from '@/lib/skill-discovery';

/**
 * Canonicalize a skill name from any UI source (badge label, badge command,
 * manual input). Strips leading slashes + whitespace.
 *
 * Phase 7 (2026-05-20): moved here from claude-code-context-accounting.ts
 * (which is being deleted). MessageInput.tsx keeps its own inline copy of
 * the same 2-line logic to avoid pulling node:fs into the client bundle —
 * see commit 5c356e8 client-bundle hotfix.
 */
export function canonicalizeSkillName(value: string): string {
  return value.trim().replace(/^\/+/, '');
}

// ─────────────────────────────────────────────────────────────────────────
// Contract types
// ─────────────────────────────────────────────────────────────────────────

/** Runtime-agnostic record of one tool invocation in a turn. */
export interface ToolInvocationRecord {
  toolUseId: string;
  /** Raw tool name as emitted by the Runtime. Possible shapes:
   *  - 'Skill'                         → Anthropic Skill tool
   *  - 'mcp__<server>__<tool>'         → MCP server tool (double-underscore split)
   *  - Everything else                 → built-in tool (Bash / Read / Edit / Grep / ...)
   */
  toolName: string;
  /** Tool input arg object. Treated as opaque except:
   *   - Skill: input.skill (string) gives the skill name
   *   - All: char length of JSON.stringify(input) feeds the estimate
   */
  input: unknown;
  /** Tool result content text. Optional because a turn may end before
   *  the result arrives (rare in normalized SDK output, but possible). */
  resultContent?: string;
}

/**
 * Per-turn collector. Each Runtime instantiates this once at stream start,
 * calls recordToolUse / recordToolResult during streaming, and calls drain()
 * at result-event time to feed collectAutoInvokeSnapshot.
 */
export class ToolInvocationAccumulator {
  private byId = new Map<string, ToolInvocationRecord>();
  /** Insertion order so drain() returns records in turn order. */
  private order: string[] = [];

  recordToolUse(toolUseId: string, toolName: string, input: unknown): void {
    if (this.byId.has(toolUseId)) {
      // Defensive: same id seen twice (shouldn't happen). Last write wins
      // on name/input; result is preserved.
      const prior = this.byId.get(toolUseId)!;
      this.byId.set(toolUseId, { ...prior, toolName, input });
      return;
    }
    this.byId.set(toolUseId, { toolUseId, toolName, input });
    this.order.push(toolUseId);
  }

  recordToolResult(toolUseId: string, content: string): void {
    const record = this.byId.get(toolUseId);
    if (!record) {
      // Result without matching tool_use — Runtime stream anomaly. Ignore
      // rather than fabricate a record (no toolName / input would be a guess).
      return;
    }
    record.resultContent = content;
  }

  drain(): readonly ToolInvocationRecord[] {
    return this.order.map((id) => this.byId.get(id)!);
  }

  /** For tests. */
  size(): number {
    return this.order.length;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────

export type ToolInvocationCategory = 'skill' | 'mcp' | 'tool';

export interface ClassifiedToolUse {
  category: ToolInvocationCategory;
  /** For skill: skill name from input. For mcp: server name. For tool: toolName itself. */
  detail: string;
  /** For mcp: full 'mcp__server__tool' name. Stable identity inside the category. */
  fullName: string;
}

/**
 * Classify a record into one of three buckets. Exposed for tests; also used
 * by collectAutoInvokeSnapshot internally.
 */
export function classifyToolUse(record: ToolInvocationRecord): ClassifiedToolUse | null {
  if (record.toolName === 'Skill') {
    const skillName = extractSkillName(record.input);
    if (!skillName) return null; // malformed Skill call — drop, don't guess
    return { category: 'skill', detail: skillName, fullName: 'Skill' };
  }
  if (record.toolName.startsWith('mcp__')) {
    // Split on double-underscore: ['mcp', 'server-name', 'tool_name', maybe more]
    const segments = record.toolName.split('__');
    const server = segments[1] || 'unknown';
    return { category: 'mcp', detail: server, fullName: record.toolName };
  }
  return { category: 'tool', detail: record.toolName, fullName: record.toolName };
}

function extractSkillName(input: unknown): string | null {
  if (input && typeof input === 'object' && 'skill' in input) {
    const skill = (input as { skill?: unknown }).skill;
    if (typeof skill === 'string' && skill.trim().length > 0) return skill.trim();
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Token estimation
// ─────────────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

function estimateTokensFromBytes(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

function jsonByteLength(value: unknown): number {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

function estimateInvocationTokens(record: ToolInvocationRecord): number {
  const inputBytes = jsonByteLength(record.input);
  const resultBytes = record.resultContent?.length ?? 0;
  return estimateTokensFromBytes(inputBytes + resultBytes);
}

// ─────────────────────────────────────────────────────────────────────────
// Source breadcrumb
// ─────────────────────────────────────────────────────────────────────────

function formatSkillSource(workspacePath: string, filePath: string): string {
  const rel = path.relative(workspacePath, filePath);
  if (!rel.startsWith('..')) return `workspace/${rel}`;
  return filePath;
}

// ─────────────────────────────────────────────────────────────────────────
// Main entry — collectAutoInvokeSnapshot
// ─────────────────────────────────────────────────────────────────────────

export interface CollectAutoInvokeInput {
  workspacePath: string;
  records: readonly ToolInvocationRecord[];
  producedBy: ContextAccountingRuntimeId;
  /** Codex-specific subclassification; transparently forwarded. */
  providerBackend?: string;
  /** Badge picker selections (ClaudeCode only) — pre-declared skills
   *  that may not be auto-invoked yet. Merged into entries.skills with
   *  dedup against records of category === 'skill'. */
  selectedSkills?: readonly string[];
  /** Kinds that this Runtime cannot account for, even after auto-invoke.
   *  Caller supplies (e.g. ['system_prompt', 'memory', 'files_attachments']
   *  for Phase 7 — system prompt is opaque, memory bridge not wired, etc). */
  unsupported: readonly ContextAccountingKind[];
  /** Optional injection point for the workspace rules entry (CLAUDE.md
   *  filesize today; can swap to other rules sources later). Runtime-
   *  specific filesystem layout is encapsulated here. */
  resolveRulesEntry?: (workspacePath: string) => ContextAccountingEntry | undefined;
}

/**
 * Build a RuntimeContextAccountingSnapshot from a turn's tool invocations.
 *
 * Three entry kinds are filled from records when present (entry omitted
 * when no matching invocations or no resolvable detail):
 *   - entries.skills : from records where category === 'skill', plus
 *                      selectedSkills (badge picker). Token = sum of each
 *                      matched skill's SKILL.md filesize / 4.
 *   - entries.mcp    : from records where category === 'mcp', aggregated
 *                      by server. Token = sum per-call (input + result) chars / 4.
 *   - entries.tools  : from records where category === 'tool', aggregated
 *                      by tool name. Token = sum per-call (input + result) chars / 4.
 *
 * entries.rules is populated by resolveRulesEntry when provided.
 *
 * No fabrication: a category with zero resolvable records → entry omitted,
 * UI hides the row. Hallucination (showing 0 / placeholder) is rejected.
 */
export function collectAutoInvokeSnapshot(
  input: CollectAutoInvokeInput,
): RuntimeContextAccountingSnapshot {
  const entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>> = {};

  // Workspace rules (injection point; pure source from CLAUDE.md or similar).
  if (input.resolveRulesEntry) {
    const rules = input.resolveRulesEntry(input.workspacePath);
    if (rules) entries.rules = rules;
  }

  // Classify each record once.
  const classifiedRecords: Array<{ record: ToolInvocationRecord; cls: ClassifiedToolUse }> = [];
  for (const rec of input.records) {
    const cls = classifyToolUse(rec);
    if (cls) classifiedRecords.push({ record: rec, cls });
  }

  // ── Skills ──
  // 1) Collect skill names from auto-invoke records + badge picker.
  // 2) Dedup by canonical name (case-insensitive, slash-stripped).
  // 3) Resolve each via discoverSkills, sum SKILL.md filesizes.
  const skillNames = new Set<string>();
  for (const { cls } of classifiedRecords) {
    if (cls.category === 'skill') skillNames.add(canonicalizeSkillName(cls.detail).toLowerCase());
  }
  for (const raw of input.selectedSkills ?? []) {
    const canonical = canonicalizeSkillName(raw);
    if (canonical) skillNames.add(canonical.toLowerCase());
  }
  if (skillNames.size > 0) {
    let allSkills: ReturnType<typeof discoverSkills> = [];
    try {
      allSkills = discoverSkills(input.workspacePath);
    } catch {
      // Skip — skills entry will stay omitted if no matches resolve.
    }
    let totalTokens = 0;
    const matchedNames: string[] = [];
    const sources: string[] = [];
    for (const lowerName of skillNames) {
      const skill = allSkills.find((s) => s.name.toLowerCase() === lowerName);
      if (!skill || !skill.filePath) continue;
      try {
        const stat = fs.statSync(skill.filePath);
        totalTokens += estimateTokensFromBytes(stat.size);
        matchedNames.push(skill.name);
        sources.push(formatSkillSource(input.workspacePath, skill.filePath));
      } catch {
        // SKILL.md missing despite discovery — skip silently.
      }
    }
    if (totalTokens > 0) {
      entries.skills = {
        tokens: totalTokens,
        source: sources.length === 1 ? sources[0] : sources.join(' + '),
        detail: matchedNames.join(', '),
      };
    }
  }

  // ── MCP ──
  // Aggregate per server: sum tokens across all calls; count calls per server
  // for the detail string ("server × N").
  {
    const tokensByServer = new Map<string, number>();
    const countByServer = new Map<string, number>();
    let total = 0;
    for (const { record, cls } of classifiedRecords) {
      if (cls.category !== 'mcp') continue;
      const t = estimateInvocationTokens(record);
      total += t;
      tokensByServer.set(cls.detail, (tokensByServer.get(cls.detail) ?? 0) + t);
      countByServer.set(cls.detail, (countByServer.get(cls.detail) ?? 0) + 1);
    }
    if (total > 0) {
      const servers = [...countByServer.keys()].sort();
      entries.mcp = {
        tokens: total,
        source: servers.map((s) => `tool_use/mcp/${s}`).join(' + '),
        detail: servers.map((s) => `${s} × ${countByServer.get(s)}`).join(', '),
      };
    }
  }

  // ── Tools ──
  // Aggregate per tool name; same shape as MCP but keyed on toolName.
  {
    const countByTool = new Map<string, number>();
    let total = 0;
    for (const { record, cls } of classifiedRecords) {
      if (cls.category !== 'tool') continue;
      total += estimateInvocationTokens(record);
      countByTool.set(cls.detail, (countByTool.get(cls.detail) ?? 0) + 1);
    }
    if (total > 0) {
      const tools = [...countByTool.keys()].sort();
      entries.tools = {
        tokens: total,
        source: tools.map((t) => `tool_use/tool/${t}`).join(' + '),
        detail: tools.map((t) => `${t} × ${countByTool.get(t)}`).join(', '),
      };
    }
  }

  const snapshot: RuntimeContextAccountingSnapshot = {
    entries,
    unsupported: [...input.unsupported],
    producedBy: input.producedBy,
  };
  if (input.providerBackend) {
    snapshot.providerBackend = input.providerBackend;
  }
  return snapshot;
}

// ─────────────────────────────────────────────────────────────────────────
// Workspace-rules helper (shared across Runtimes — Runtime-specific layouts
// can supply their own; this is the default for "workspace/CLAUDE.md").
// ─────────────────────────────────────────────────────────────────────────

export function resolveWorkspaceClaudeMdRules(
  workspacePath: string,
): ContextAccountingEntry | undefined {
  try {
    const stat = fs.statSync(path.join(workspacePath, 'CLAUDE.md'));
    return {
      tokens: estimateTokensFromBytes(stat.size),
      source: 'workspace/CLAUDE.md',
      detail: 'CLAUDE.md',
    };
  } catch {
    return undefined;
  }
}
