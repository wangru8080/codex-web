/**
 * Phase 5c (2026-05-16) — CodexWeb built-in tool bridge for Codex
 * Runtime proxy path.
 *
 * Problem: when a CodexWeb provider (GLM / Kimi / OpenAI-compat /
 * Anthropic-compat / openai-oauth / CodePlan brand) is the target of
 * a Codex Runtime turn, the upstream provider can't see CodexWeb's
 * built-in MCP tools (memory / image / widget / tasks / notify). Real
 * smoke (2026-05-16) showed GLM/Kimi reading `imagegen` Skill text,
 * trying to call a tool that wasn't in their function list, then
 * fabricating a fallback chain — `OPENAI_API_KEY` lookup,
 * `~/.codex/auth.json` read attempt, `npm install openai`, then
 * generation stopped.
 *
 * Solution: inject the CodexWeb built-in tools INTO the ai-sdk
 * `ToolSet` the unified adapter passes to `streamText`, each tool
 * with a server-side `execute()` that calls the real underlying
 * handler. From Codex's perspective the function_call never happens
 * (the bridge suppresses it in `translate-stream.ts`); the model
 * gets the tool result inline within the same ai-sdk step and
 * continues with assistant text.
 *
 * The result reaches CodexWeb's chat UI through a side-channel:
 *   1. `execute()` emits a `tool_started` + `tool_completed`
 *      `RuntimeRunEvent` on the per-session bus
 *      (`./builtin-event-bus.ts`).
 *   2. `codex/runtime.ts` is already subscribed for the same session;
 *      it forwards each event through `canonicalToSseLine` → SSE →
 *      `useSSEStream` → `MessageList`. Identical channel Codex's own
 *      `item/completed` notifications use today.
 *
 * Anti-patterns this bridge MUST NOT reintroduce — pinned by
 * `codex-builtin-no-anti-patterns.test.ts`:
 *
 *   - Reading `~/.codex/auth.json` (Codex Account's private auth).
 *   - Running `scripts/image_gen.py` or any shelled-out generator.
 *   - Triggering `npm install openai` on the fly.
 *   - Bypassing `/api/media/serve` by serving paths outside
 *     `<dataDir>/.codepilot-media`.
 *
 * Codex Account guardrail: the unified adapter must NOT mount this
 * bridge when `targetProviderId === 'codex_account'` (Codex Account
 * routes natively without the proxy injection at all — the proxy's
 * `adapter.ts` virtual-provider routingBug check fires earlier, but
 * we keep the bridge-side check too as defence in depth).
 */

import { tool, jsonSchema, type ToolSet } from 'ai';
import crypto from 'node:crypto';
import type { JSONSchema7 } from '@ai-sdk/provider';
import type { MediaBlock } from '@/types';
import { makeToolStarted, makeToolCompleted } from '@/lib/runtime/event-adapter';
import { emitBuiltinEvent } from './builtin-event-bus';
import { materializeCodexEventMedia } from '@/lib/codex/media-import';
// Phase 5d Phase 2 slice 2e (2026-05-17) — `WIDGET_SYSTEM_PROMPT`
// import dropped: the bridge no longer holds a local WIDGET_PROMPT
// scalar. Capability prompts are produced by the Context Compiler
// and consumed by unified-adapter.ts.

/** Tool names this bridge owns. The unified adapter passes this set
 *  to `translate-stream.ts` so its tool-call / tool-result events
 *  are NOT forwarded to Codex (the bridge handled them already). */
export const CODEXWEB_BUILTIN_TOOL_NAMES = [
  'codepilot_generate_image',
  'codepilot_import_media',
  'codepilot_memory_recent',
  'codepilot_memory_search',
  'codepilot_memory_get',
  'codepilot_load_widget_guidelines',
  'codepilot_notify',
  'codepilot_schedule_task',
  'codepilot_list_tasks',
  'codepilot_cancel_task',
] as const;

export type CodexWebBuiltinToolName = (typeof CODEXWEB_BUILTIN_TOOL_NAMES)[number];

export interface BuiltinBridgeOpts {
  /** Originating CodexWeb chat session id. Used both as the
   *  side-channel bus key and as `origin_session_id` for scheduled
   *  tasks so the runner later scopes to the right project. */
  sessionId: string;
  /** Working directory the chat was launched in. Forwarded into
   *  image-gen reference-path resolution and memory workspace
   *  lookup. Empty when the chat has no workspace bound. */
  workspacePath?: string;
  /** Target CodexWeb provider id from
   *  `x-codepilot-target-provider`. Pre-checked by the unified
   *  adapter — `codex_account` should never reach here, but the
   *  guard below stays as defence in depth. */
  targetProviderId: string;
}

export interface BuiltinBridgeResult {
  /** AI SDK tool set for `streamText({ tools })`. */
  readonly tools: ToolSet;
  /** Names the unified adapter uses to suppress Codex-bound
   *  function_call events for these tools. */
  readonly toolNames: ReadonlySet<string>;
  /** System prompt fragments describing what each tool does, joined
   *  with double-newlines. The adapter prepends this to whatever
   *  `instructions` Codex sent so the model knows the tools exist. */
  readonly systemPrompt: string;
  /** When the bridge declined to mount (no session id / Codex
   *  Account / etc.), `reason` tells the caller why. `undefined`
   *  means the bridge is fully active. */
  readonly skippedReason?: string;
}

/**
 * Build the CodexWeb built-in tool bridge for the current turn.
 *
 * Empty result (no tools, no system prompt) when:
 *   - `sessionId` empty (older runtime build, or smoke without
 *     CodexRuntime).
 *   - `targetProviderId === 'codex_account'` — Codex Account routes
 *     natively, bridge tools would be a routing bug.
 */
export function createCodexWebBuiltinTools(opts: BuiltinBridgeOpts): BuiltinBridgeResult {
  if (!opts.sessionId) {
    return emptyResult('Empty sessionId — runtime did not supply x-codepilot-session-id header.');
  }
  if (opts.targetProviderId === 'codex_account') {
    return emptyResult('Codex Account target — bridge intentionally disabled (native path owns these capabilities).');
  }

  const tools: ToolSet = {};

  tools.codepilot_generate_image = buildImageGenerationTool(opts);
  tools.codepilot_import_media = buildImportMediaTool(opts);
  tools.codepilot_load_widget_guidelines = buildWidgetGuidelinesTool(opts);
  tools.codepilot_notify = buildNotifyTool(opts);
  tools.codepilot_schedule_task = buildScheduleTaskTool(opts);
  tools.codepilot_list_tasks = buildListTasksTool(opts);
  tools.codepilot_cancel_task = buildCancelTaskTool(opts);

  // Memory tools are workspace-gated — without a workspace there's
  // no manifest to read. We still register the names in the set so
  // the model can be told they're unavailable, but skipping the
  // tool registration keeps the model from calling them and getting
  // a generic "Failed: ENOENT" message.
  if (opts.workspacePath && opts.workspacePath.length > 0) {
    tools.codepilot_memory_recent = buildMemoryRecentTool(opts);
    tools.codepilot_memory_search = buildMemorySearchTool(opts);
    tools.codepilot_memory_get = buildMemoryGetTool(opts);
  }

  // Phase 5d Phase 2 slice 2e (2026-05-17) — bridge no longer assembles
  // its own systemPrompt. The Harness Context Compiler
  // (`src/lib/harness/context-compiler.ts`) is the sole producer of
  // capability prompts across all three runtimes; unified-adapter.ts
  // calls `compileContext({ runtimeId: 'codex_runtime', ... })` and
  // prepends `compiled.systemPromptText` to Codex's instructions. The
  // empty string is a stable signal to callers that haven't migrated
  // yet — slice 2e leaves no Codex-local prompt scalars.
  return {
    tools,
    toolNames: new Set(Object.keys(tools)),
    systemPrompt: '',
  };
}

function emptyResult(reason: string): BuiltinBridgeResult {
  return {
    tools: {},
    toolNames: new Set(),
    systemPrompt: '',
    skippedReason: reason,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper — wrap an execute() body with side-channel event emission.
//
// Every built-in tool follows the same shape:
//   1. Generate a fresh toolId so the UI can pair tool_started ↔
//      tool_completed by id (same convention `useSSEStream` uses for
//      the Codex notification path).
//   2. Emit tool_started BEFORE the handler runs so the chat UI
//      shows the "tool running…" affordance.
//   3. Run the handler, catching everything.
//   4. Emit tool_completed AFTER, either with `output` text (success)
//      + optional MediaBlock, or with `error` string (failure).
//   5. Return text to ai-sdk so the model sees the result inline.
//
// The wrapper centralises the emit/catch pattern so each tool body
// stays focused on its own business logic.
// ─────────────────────────────────────────────────────────────────────

interface HandlerSuccess {
  /** Text the model sees (and CodexWeb UI shows as tool result content). */
  text: string;
  /** Optional MediaBlock[] for image/audio/video results. */
  media?: MediaBlock[];
}

async function runWithEvents(
  opts: BuiltinBridgeOpts,
  toolName: string,
  input: unknown,
  handler: () => Promise<HandlerSuccess>,
): Promise<string> {
  const toolId = `cpb_${crypto.randomBytes(8).toString('hex')}`;
  const base = { runtimeId: 'codex_runtime' as const, sessionId: opts.sessionId };
  emitBuiltinEvent(opts.sessionId, makeToolStarted(base, { toolId, name: toolName, input }));
  try {
    const result = await handler();
    // Media import boundary: if any block carries a localPath that
    // sits outside `<dataDir>/.codepilot-media`, copy it in BEFORE
    // emitting so `/api/media/serve` will accept it. The same helper
    // codex/runtime.ts uses for native imageGeneration events — keeps
    // every path-bearing event family honest.
    let materializedMedia = result.media;
    if (result.media && result.media.length > 0) {
      const probe = makeToolCompleted(base, {
        toolId,
        output: result.text,
        media: result.media,
      });
      const updated = materializeCodexEventMedia(probe, {
        sessionId: opts.sessionId,
        cwd: opts.workspacePath,
      });
      if (updated && updated.type === 'tool_completed') {
        materializedMedia = updated.media ? [...updated.media] : undefined;
      }
    }
    emitBuiltinEvent(
      opts.sessionId,
      makeToolCompleted(base, {
        toolId,
        output: result.text,
        ...(materializedMedia && materializedMedia.length > 0 ? { media: materializedMedia } : {}),
      }),
    );
    return result.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitBuiltinEvent(
      opts.sessionId,
      makeToolCompleted(base, { toolId, output: '', error: message }),
    );
    return `Tool execution failed: ${message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Image generation
//
// Phase 5d Phase 2 slice 2e (2026-05-17) — MEDIA_PROMPT scalar
// removed. Media capability prompt is sourced from the canonical
// MEDIA_MCP_SYSTEM_PROMPT (media_import) / MEDIA_SYSTEM_PROMPT
// (image_generation) via the Context Compiler. Bridge no longer
// holds runtime-local prompt copies.
// ─────────────────────────────────────────────────────────────────────

interface ImageGenInput {
  prompt: string;
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize?: '1K' | '2K';
  referenceImagePaths?: string[];
}

function buildImageGenerationTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Generate an image using the configured image provider. The generated image appears inline in the chat and is saved to the CodexWeb media library. Use this when the user asks you to create, draw, or generate an image. Write prompts in English for best results.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Detailed image generation prompt in English' },
        aspectRatio: {
          type: 'string',
          enum: ['1:1', '16:9', '9:16', '4:3', '3:4'],
          description: 'Aspect ratio (default 1:1)',
        },
        imageSize: { type: 'string', enum: ['1K', '2K'], description: 'Output resolution (default 1K)' },
        referenceImagePaths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of local file paths to use as style/content references.',
        },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as ImageGenInput;
      return runWithEvents(opts, 'codepilot_generate_image', input, async () => {
        const { generateSingleImage, NoImageGeneratedError } = await import('@/lib/image-generator');
        try {
          const result = await generateSingleImage({
            prompt: input.prompt,
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize,
            referenceImagePaths: input.referenceImagePaths,
            sessionId: opts.sessionId,
            cwd: opts.workspacePath,
          });
          const media: MediaBlock[] = result.images.map((img) => ({
            type: 'image' as const,
            mimeType: img.mimeType,
            localPath: img.localPath,
            mediaId: result.mediaGenerationId,
          }));
          const text = [
            `Image generated successfully (${result.elapsedMs}ms).`,
            `Local paths: ${result.images.map((img) => img.localPath).join(', ')}`,
          ].join('\n');
          return { text, media };
        } catch (err) {
          if (NoImageGeneratedError.isInstance(err)) {
            throw new Error('Image generation succeeded but no image was returned by the model. Try a different prompt.');
          }
          throw err;
        }
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Media import
// ─────────────────────────────────────────────────────────────────────

interface ImportMediaInput {
  filePath: string;
  prompt?: string;
  source?: string;
  model?: string;
  tags?: string[];
}

function buildImportMediaTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Import an existing local file (image, video, audio) into the CodexWeb media library. Use when the user wants to add a file they already have on disk into the library so it can be referenced later.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['filePath'],
      properties: {
        filePath: { type: 'string', description: 'Local file path to import.' },
        prompt: { type: 'string', description: 'Optional description / title.' },
        source: { type: 'string', description: 'Optional source label (e.g. "user-upload").' },
        model: { type: 'string', description: 'Optional model that produced the file (if AI-generated).' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as ImportMediaInput;
      return runWithEvents(opts, 'codepilot_import_media', input, async () => {
        const { importFileToLibrary } = await import('@/lib/media-saver');
        const result = importFileToLibrary(input.filePath, {
          sessionId: opts.sessionId,
          source: input.source,
          prompt: input.prompt,
          model: input.model,
          tags: input.tags,
          cwd: opts.workspacePath,
        });
        // P2 fix (smoke round, 2026-05-16) — the bridge's tool
        // DESCRIPTION promises image/video/audio support, but
        // pre-fix every imported file got `type: 'image'` regardless.
        // MediaPreview is type-discriminated (image → <img>, video
        // → <video>, audio → <audio>), so importing a .mp4 or .wav
        // landed in the wrong renderer. Infer mediaType from the
        // mimeType prefix the same way `media-saver.mimeToMediaType`
        // does — we can't reach that helper directly without
        // exporting it, but the prefix check is two lines.
        const mimeType = inferMimeFromPath(result.localPath);
        const mediaType: 'image' | 'video' | 'audio' = mediaTypeOf(mimeType);
        const block: MediaBlock = {
          type: mediaType,
          mimeType,
          localPath: result.localPath,
          mediaId: result.mediaId,
        };
        return {
          text: `File imported to media library. mediaId=${result.mediaId}, localPath=${result.localPath}, mediaType=${mediaType}`,
          media: [block],
        };
      });
    },
  });
}

function inferMimeFromPath(localPath: string): string {
  const ext = localPath.toLowerCase().slice(localPath.lastIndexOf('.'));
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.avif': return 'image/avif';
    case '.svg': return 'image/svg+xml';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.mov': return 'video/quicktime';
    case '.mkv': return 'video/x-matroska';
    case '.mp3': return 'audio/mpeg';
    case '.wav': return 'audio/wav';
    case '.ogg': return 'audio/ogg';
    case '.flac': return 'audio/flac';
    case '.aac': return 'audio/aac';
    default: return 'application/octet-stream';
  }
}

/** Mirrors `media-saver.ts mimeToMediaType` — kept inline to avoid
 *  exporting a helper from media-saver just for this caller. Drift
 *  guard: both sides default to `image` so non-AV files still render
 *  in the gallery as a fallback. */
function mediaTypeOf(mimeType: string): 'image' | 'video' | 'audio' {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'image';
}

// ─────────────────────────────────────────────────────────────────────
// Memory
//
// Phase 5d Phase 2 slice 2e (2026-05-17) — MEMORY_PROMPT scalar
// removed. Memory capability prompt is sourced from the canonical
// MEMORY_SEARCH_SYSTEM_PROMPT (memory-search-mcp.ts) via the
// Context Compiler.
// ─────────────────────────────────────────────────────────────────────

interface MemorySearchInput {
  query: string;
  tags?: string[];
  file_type?: 'all' | 'daily' | 'longterm' | 'notes';
  limit?: number;
}

function buildMemorySearchTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Search assistant workspace memory files with keyword matching and temporal decay. Supports filtering by tags (Obsidian-style #tags from YAML frontmatter) and file type.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        file_type: { type: 'string', enum: ['all', 'daily', 'longterm', 'notes'] },
        limit: { type: 'number' },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as MemorySearchInput;
      return runWithEvents(opts, 'codepilot_memory_search', input, async () => {
        if (!opts.workspacePath) {
          throw new Error('Memory search requires an active workspace; this chat does not have one bound.');
        }
        const workspace = opts.workspacePath;
        const limit = input.limit || 5;
        const { searchWorkspace } = await import('@/lib/workspace-retrieval');
        let results = searchWorkspace(workspace, input.query, { limit: limit * 3 });

        // P2 fix (smoke round, 2026-05-16) — the schema + description
        // promise `tags` and `file_type` filtering, but the pre-fix
        // bridge ignored both. Mirror `memory-search-mcp.ts` lines
        // 62-88 so the Codex bridge stays in lock-step with the SDK
        // MCP version. Without this, a user asking "search
        // file_type=daily" would get long-term notes mixed in.

        if (input.file_type && input.file_type !== 'all') {
          const isMemoryFile = (p: string) => /^memory\.md$/i.test(p);
          const ft = input.file_type;
          results = results.filter((r) => {
            if (ft === 'daily') return r.path.startsWith('memory/daily/');
            if (ft === 'longterm') return isMemoryFile(r.path);
            if (ft === 'notes') return !r.path.startsWith('memory/') && !isMemoryFile(r.path);
            return true;
          });
        }

        if (input.tags && input.tags.length > 0) {
          const tagsLower = input.tags.map((t) => t.toLowerCase().replace(/^#/, ''));
          try {
            const { loadManifest } = await import('@/lib/workspace-indexer');
            const manifest = loadManifest(workspace) as Array<{ path: string; tags?: string[] }>;
            results = results.filter((r) => {
              const entry = manifest.find((e) => e.path === r.path);
              if (!entry?.tags?.length) return false;
              const entryTagsLower = entry.tags.map((t: string) => t.toLowerCase());
              return tagsLower.some((t) => entryTagsLower.includes(t));
            });
          } catch {
            // manifest unavailable (workspace never indexed) → skip
            // tag filter rather than fail the whole search. Same
            // soft-failure stance memory-search-mcp.ts takes.
          }
        }

        const trimmed = results.slice(0, limit);
        const text = trimmed.length === 0
          ? `No memory results for "${input.query}"${input.file_type && input.file_type !== 'all' ? ` (file_type=${input.file_type})` : ''}${input.tags && input.tags.length > 0 ? ` (tags=${input.tags.join(',')})` : ''}.`
          : trimmed
              .map((r, i) => `${i + 1}. [${r.path}] (score: ${r.score.toFixed(2)})\n   ${truncate(r.snippet ?? '', 240)}`)
              .join('\n\n');
        return { text };
      });
    },
  });
}

interface MemoryGetInput {
  file_path: string;
  line_start?: number;
  line_end?: number;
}

function buildMemoryGetTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Read a specific file from the assistant workspace. Paths are relative to the workspace root (e.g. "memory.md", "memory/daily/2026-03-30.md").',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['file_path'],
      properties: {
        file_path: { type: 'string' },
        line_start: { type: 'number' },
        line_end: { type: 'number' },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as MemoryGetInput;
      return runWithEvents(opts, 'codepilot_memory_get', input, async () => {
        if (!opts.workspacePath) {
          throw new Error('Memory get requires an active workspace; this chat does not have one bound.');
        }
        // Inlined safe-read with the same boundary checks
        // `memory-search-mcp.ts` performs. Kept in lock-step via
        // the source-grep pin in `codex-builtin-no-anti-patterns.test.ts`
        // — refactoring either side without touching the other will
        // surface as a smoke divergence, not a security regression.
        const path = await import('node:path');
        const fs = await import('node:fs');
        const resolvedWorkspace = path.resolve(opts.workspacePath);
        const resolved = path.resolve(opts.workspacePath, input.file_path);
        const rel = path.relative(resolvedWorkspace, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          throw new Error('Access denied: path is outside the workspace.');
        }
        if (!fs.existsSync(resolved)) {
          return { text: `File not found: ${input.file_path}` };
        }
        // Symlink escape guard.
        const realPath = fs.realpathSync(resolved);
        const realWorkspace = fs.realpathSync(resolvedWorkspace);
        const realRel = path.relative(realWorkspace, realPath);
        if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
          throw new Error('Access denied: path resolves outside the workspace (symlink).');
        }
        let content = fs.readFileSync(resolved, 'utf-8');
        if (input.line_start || input.line_end) {
          const lines = content.split('\n');
          const start = Math.max(0, (input.line_start ?? 1) - 1);
          const end = Math.min(lines.length, input.line_end ?? lines.length);
          content = lines.slice(start, end).join('\n');
        }
        if (content.length > 3000) {
          content = content.slice(0, 3000) + '\n\n[…truncated…]';
        }
        return { text: content || '(empty file)' };
      });
    },
  });
}

interface MemoryRecentInput {
  days?: number;
}

function buildMemoryRecentTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Read the most recent assistant workspace memory snapshots (long-term memory.md summary + last few daily entries). Call this at the start of every conversation to load context.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: { days: { type: 'number', description: 'How many recent days to read (default 3).' } },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as MemoryRecentInput;
      return runWithEvents(opts, 'codepilot_memory_recent', input, async () => {
        if (!opts.workspacePath) {
          throw new Error('Memory recent requires an active workspace; this chat does not have one bound.');
        }
        const path = await import('node:path');
        const fs = await import('node:fs');
        const days = Math.max(1, input.days ?? 3);
        const parts: string[] = [];
        // Long-term memory.md summary (first 500 chars). Try both
        // case variants for cross-platform safety.
        for (const variant of ['memory.md', 'Memory.md', 'MEMORY.md']) {
          const memoryPath = path.join(opts.workspacePath, variant);
          if (fs.existsSync(memoryPath)) {
            const content = fs.readFileSync(memoryPath, 'utf-8').trim();
            const summary = content.length > 500 ? content.slice(0, 500) + '…' : content;
            if (summary.length > 0) parts.push(`## Long-term Memory\n${summary}`);
            break;
          }
        }
        // Recent daily entries.
        const dailyDir = path.join(opts.workspacePath, 'memory', 'daily');
        if (fs.existsSync(dailyDir)) {
          const files = fs
            .readdirSync(dailyDir)
            .filter((f: string) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
            .sort()
            .reverse()
            .slice(0, days);
          for (const file of files) {
            const content = fs.readFileSync(path.join(dailyDir, file), 'utf-8').trim();
            if (content.length === 0) continue;
            const truncated = content.length > 800 ? content.slice(0, 800) + '…' : content;
            const date = file.replace('.md', '');
            parts.push(`## Daily Memory: ${date}\n${truncated}`);
          }
        }
        return {
          text: parts.length > 0 ? parts.join('\n\n') : 'No recent memory entries found.',
        };
      });
    },
  });
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

// ─────────────────────────────────────────────────────────────────────
// Widget guidelines
//
// Phase 5d Phase 2 slice 2e (2026-05-17) — WIDGET_PROMPT scalar
// removed. The Harness Context Compiler emits the canonical
// WIDGET_SYSTEM_PROMPT + the widget artifactContract; bridge holds
// no local copy. The compiler is consulted by unified-adapter.ts.
// ─────────────────────────────────────────────────────────────────────

interface WidgetInput {
  modules: Array<'interactive' | 'chart' | 'mockup' | 'art' | 'diagram'>;
}

function buildWidgetGuidelinesTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Load detailed design guidelines for generating visual widgets. Call this before generating your first widget in the conversation. Available modules: interactive (HTML controls), chart (Chart.js), mockup (UI mockups), art (SVG illustrations), diagram (flowcharts / timelines / hierarchies).',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['modules'],
      properties: {
        modules: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ['interactive', 'chart', 'mockup', 'art', 'diagram'] },
        },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as WidgetInput;
      return runWithEvents(opts, 'codepilot_load_widget_guidelines', input, async () => {
        const { getGuidelines } = await import('@/lib/widget-guidelines');
        const text = getGuidelines(input.modules as string[]);
        return { text };
      });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────
// Notify + tasks
//
// Phase 5d Phase 2 slice 2e (2026-05-17) — NOTIFY_PROMPT scalar
// removed. Tasks + notify capability prompt is sourced from the
// canonical NOTIFICATION_MCP_SYSTEM_PROMPT via the Context Compiler.
// ─────────────────────────────────────────────────────────────────────

interface NotifyInput {
  title: string;
  body: string;
  priority?: 'low' | 'normal' | 'urgent';
}

function buildNotifyTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Send an immediate notification to the user. low = toast only, normal = toast + system, urgent = toast + system + Telegram.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body'],
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'urgent'] },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as NotifyInput;
      return runWithEvents(opts, 'codepilot_notify', input, async () => {
        const { sendNotification } = await import('@/lib/notification-manager');
        await sendNotification({
          title: input.title,
          body: input.body,
          priority: input.priority ?? 'normal',
        });
        return { text: `Notification sent: "${input.title}"` };
      });
    },
  });
}

interface ScheduleTaskInput {
  name: string;
  prompt: string;
  kind: 'reminder' | 'ai_task';
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  priority?: 'low' | 'normal' | 'urgent';
  notify_on_complete?: boolean;
  durable?: boolean;
}

function buildScheduleTaskTool(opts: BuiltinBridgeOpts) {
  return tool({
    description:
      'Create a scheduled task. kind=reminder shows a notification on schedule (no AI call); kind=ai_task feeds the prompt to the configured provider. Supports cron, interval, or one-off.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['name', 'prompt', 'kind', 'schedule_type', 'schedule_value'],
      properties: {
        name: { type: 'string' },
        prompt: { type: 'string' },
        kind: { type: 'string', enum: ['reminder', 'ai_task'] },
        schedule_type: { type: 'string', enum: ['cron', 'interval', 'once'] },
        schedule_value: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'normal', 'urgent'] },
        notify_on_complete: { type: 'boolean' },
        durable: { type: 'boolean' },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as ScheduleTaskInput;
      return runWithEvents(opts, 'codepilot_schedule_task', input, async () => {
        // P1 fix (smoke round, 2026-05-16) — `durable: false` MUST
        // take the session-only branch (writes into the in-process
        // map via addSessionTask), NOT POST to /api/tasks/schedule.
        // Pre-fix the bridge accepted the param then ignored it,
        // breaking parity with `notification-mcp.ts` + the AI SDK
        // builtin variant: a Codex Runtime task with durable=false
        // would have ended up persistent, surviving restarts the
        // user didn't expect, and showing up in the durable
        // dashboard. Mirror `notification-mcp.ts` lines 121-173.
        if (input.durable === false) {
          const cryptoMod = await import('node:crypto');
          const { addSessionTask, parseInterval, getNextCronTime } = await import('@/lib/task-scheduler');
          const id = cryptoMod.randomBytes(8).toString('hex');
          const now = new Date();
          let next_run: string;
          if (input.schedule_type === 'once') {
            next_run = input.schedule_value;
          } else if (input.schedule_type === 'interval') {
            next_run = new Date(now.getTime() + parseInterval(input.schedule_value)).toISOString();
          } else {
            const cronNext = getNextCronTime(input.schedule_value);
            if (!cronNext) {
              return {
                text: `Cron expression "${input.schedule_value}" has no valid occurrence within 4 years. Task not created.`,
              };
            }
            next_run = cronNext.toISOString();
          }
          const task = {
            id,
            name: input.name,
            prompt: input.prompt,
            kind: input.kind,
            schedule_type: input.schedule_type,
            schedule_value: input.schedule_value,
            next_run,
            consecutive_errors: 0,
            status: 'active' as const,
            priority: input.priority || 'normal',
            notify_on_complete: input.notify_on_complete === false ? 0 : 1,
            permanent: 0,
            // Hidden run context — closure-captured, model can't
            // override. Same rationale as the MCP variant: scheduled
            // tasks need to know which project / chat they belong
            // to so the runner re-uses the right workspace.
            origin_session_id: opts.sessionId,
            working_directory: opts.workspacePath,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          };
          addSessionTask(task);
          return {
            text: `Session task "${input.name}" scheduled (${input.kind}, non-durable). ID: ${id}, next run: ${next_run}`,
          };
        }

        const baseUrl = `http://127.0.0.1:${process.env.PORT || '3000'}`;
        const res = await fetch(`${baseUrl}/api/tasks/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            prompt: input.prompt,
            kind: input.kind,
            schedule_type: input.schedule_type,
            schedule_value: input.schedule_value,
            priority: input.priority,
            notify_on_complete: input.notify_on_complete === false ? 0 : 1,
            origin_session_id: opts.sessionId,
            working_directory: opts.workspacePath,
            // The model can't override these — they come from the
            // bridge closure, matching the SDK MCP version's hidden-
            // context contract.
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return {
          text: `Task "${input.name}" scheduled (${input.kind}). ID: ${data.task.id}, next run: ${data.task.next_run}`,
        };
      });
    },
  });
}

interface ListTasksInput {
  status?: 'active' | 'paused' | 'completed' | 'disabled' | 'all';
}

function buildListTasksTool(opts: BuiltinBridgeOpts) {
  return tool({
    description: 'List scheduled tasks. Returns id, name, schedule, status, and next run time.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['active', 'paused', 'completed', 'disabled', 'all'] },
      },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as ListTasksInput;
      return runWithEvents(opts, 'codepilot_list_tasks', input, async () => {
        const baseUrl = `http://127.0.0.1:${process.env.PORT || '3000'}`;
        const url = input.status && input.status !== 'all'
          ? `${baseUrl}/api/tasks/list?status=${input.status}`
          : `${baseUrl}/api/tasks/list`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        type TaskRow = {
          id: string; name: string; schedule_type: string; schedule_value: string;
          status: string; next_run: string; last_status?: string; durable?: boolean;
        };
        const tasks: TaskRow[] = ((data.tasks ?? []) as Omit<TaskRow, 'durable'>[]).map((t) => ({
          ...t,
          durable: true,
        }));

        // P1 fix (smoke round, 2026-05-16) — also merge session-only
        // tasks from the in-process map. Mirror notification-mcp.ts
        // lines 224-240. Without this merge, a user who scheduled a
        // non-durable task earlier in the same chat couldn't see it
        // here even though it was very much alive.
        try {
          const { getSessionTasks } = await import('@/lib/task-scheduler');
          for (const [, task] of getSessionTasks()) {
            if (input.status && input.status !== 'all' && task.status !== input.status) continue;
            tasks.push({
              id: task.id,
              name: `${task.name} (session)`,
              schedule_type: task.schedule_type,
              schedule_value: task.schedule_value,
              status: task.status,
              next_run: task.next_run,
              last_status: task.last_status,
              durable: false,
            });
          }
        } catch {
          // Best-effort: scheduler module not loaded → durable list only.
        }

        if (tasks.length === 0) {
          return { text: 'No scheduled tasks found.' };
        }
        const formatted = tasks
          .map((t, i) =>
            `${i + 1}. [${t.id}] ${t.name}\n   Type: ${t.schedule_type} (${t.schedule_value})\n   Status: ${t.status} | Next: ${t.next_run}${t.last_status ? ` | Last: ${t.last_status}` : ''}${t.durable === false ? ' | Session-only' : ''}`,
          )
          .join('\n\n');
        return { text: formatted };
      });
    },
  });
}

interface CancelTaskInput {
  task_id: string;
}

function buildCancelTaskTool(opts: BuiltinBridgeOpts) {
  return tool({
    description: 'Cancel (delete) a scheduled task by id.',
    inputSchema: jsonSchema({
      type: 'object',
      additionalProperties: false,
      required: ['task_id'],
      properties: { task_id: { type: 'string' } },
    } satisfies JSONSchema7),
    execute: async (rawInput: unknown) => {
      const input = rawInput as CancelTaskInput;
      return runWithEvents(opts, 'codepilot_cancel_task', input, async () => {
        // P1 fix (smoke round, 2026-05-16) — try the session-only
        // map first, fall through to durable DELETE if not found.
        // Mirror notification-mcp.ts lines 263-281. Pre-fix the
        // bridge only hit /api/tasks/:id, which returns 404 for
        // any in-memory session task and surfaced as a tool error
        // even though the task was very much cancellable.
        try {
          const { getSessionTasks, removeSessionTask } = await import('@/lib/task-scheduler');
          const sessionTasks = getSessionTasks();
          if (sessionTasks.has(input.task_id)) {
            removeSessionTask(input.task_id);
            return { text: `Session task ${input.task_id} cancelled.` };
          }
        } catch {
          // Scheduler module not loaded → fall through to durable.
        }

        const baseUrl = `http://127.0.0.1:${process.env.PORT || '3000'}`;
        const res = await fetch(`${baseUrl}/api/tasks/${input.task_id}`, { method: 'DELETE' });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }
        return { text: `Task ${input.task_id} cancelled.` };
      });
    },
  });
}
