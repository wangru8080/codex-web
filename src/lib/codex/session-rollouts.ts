import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ChatSession, Message, MessageContentBlock, MessagesResponse } from '@/types';

export const CODEX_SESSION_ID_PREFIX = 'codex:' as const;
export const CODEX_ROLLOUT_ORIGIN = 'codex_rollout' as const;

const DEFAULT_LIMIT = 50;

export interface CodexConfigSnapshot {
  codexHome: string;
  modelProvider: string | null;
}

export interface CodexRolloutMeta {
  sessionId: string;
  timestamp: string;
  cwd: string;
  modelProvider: string;
  filePath: string;
  model: string;
  updatedAt: string;
}

interface ListOptions {
  codexHome?: string;
  cwd?: string;
  limit?: number;
}

interface MessageOptions extends ListOptions {
  before?: number;
}

function defaultCodexHome(): string {
  return process.env.CODEX_HOME || path.join(homedir(), '.codex');
}

function sessionsRoot(codexHome: string): string {
  return path.join(codexHome, 'sessions');
}

export function isCodexVirtualSessionId(id: string): boolean {
  return id.startsWith(CODEX_SESSION_ID_PREFIX);
}

export function toCodexVirtualSessionId(sessionId: string): string {
  return isCodexVirtualSessionId(sessionId) ? sessionId : `${CODEX_SESSION_ID_PREFIX}${sessionId}`;
}

export function fromCodexVirtualSessionId(id: string): string {
  return isCodexVirtualSessionId(id) ? id.slice(CODEX_SESSION_ID_PREFIX.length) : id;
}

export async function readCodexConfig(codexHome = defaultCodexHome()): Promise<CodexConfigSnapshot> {
  const configPath = path.join(codexHome, 'config.toml');
  try {
    const raw = await readFile(configPath, 'utf8');
    const match = raw.match(/^\s*model_provider\s*=\s*["']([^"']+)["']\s*$/m);
    return { codexHome, modelProvider: match?.[1] ?? null };
  } catch {
    return { codexHome, modelProvider: null };
  }
}

async function safeRealPath(input: string): Promise<string> {
  try {
    return await realpath(input);
  } catch {
    return path.resolve(input);
  }
}

async function sameCwd(a: string, b: string): Promise<boolean> {
  const [ra, rb] = await Promise.all([safeRealPath(a), safeRealPath(b)]);
  return ra === rb;
}

async function collectJsonlFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const resolved = path.resolve(full);
        const resolvedRoot = path.resolve(root);
        if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) continue;
        out.push(resolved);
      }
    }
  }
  await walk(root);
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

function payloadOf(line: Record<string, unknown>): Record<string, unknown> {
  return asRecord(line.payload) ?? line;
}

function withLineTimestamp(payload: Record<string, unknown>, line: Record<string, unknown>): Record<string, unknown> {
  return typeof line.timestamp === 'string'
    ? { ...payload, __codex_timestamp: line.timestamp }
    : payload;
}

function timestampMsOf(payload: Record<string, unknown>): number | null {
  if (typeof payload.__codex_timestamp !== 'string') return null;
  const ms = Date.parse(payload.__codex_timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function extractText(content: unknown, role: 'user' | 'assistant'): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const wanted = role === 'user'
    ? new Set(['input_text', 'text'])
    : new Set(['output_text', 'text']);
  return content
    .map((block) => {
      const rec = asRecord(block);
      if (!rec || typeof rec.type !== 'string' || !wanted.has(rec.type)) return '';
      return typeof rec.text === 'string' ? rec.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

function stripUserContextEnvelope(text: string): string {
  const requestMarker = '## My request for Codex:';
  const requestIndex = text.indexOf(requestMarker);
  if (requestIndex >= 0) {
    return text.slice(requestIndex + requestMarker.length).trim();
  }

  const withoutRuntimeContext = text
    .replace(/^# AGENTS\.md instructions for [\s\S]*?<\/INSTRUCTIONS>/gm, '')
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/g, '')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/g, '')
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/g, '')
    .replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/g, '')
    .trim();

  if (!withoutRuntimeContext || withoutRuntimeContext === '# Context from my IDE setup:') return '';
  return withoutRuntimeContext;
}

function extractUserDisplayText(content: unknown): string {
  return stripUserContextEnvelope(extractText(content, 'user')).trim();
}

function extractAssistantBlocks(content: unknown): MessageContentBlock[] {
  const text = extractText(content, 'assistant').trim();
  return text ? [{ type: 'text', text }] : [];
}

function extractAssistantProcessBlock(content: unknown): MessageContentBlock[] {
  const text = extractText(content, 'assistant').trim();
  return text ? [{ type: 'codex_process_text', text }] : [];
}

function parseToolInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeBlocks(blocks: MessageContentBlock[]): string {
  return JSON.stringify(blocks);
}

export function normalizeCodexRolloutPayloadsForDisplay(
  payloads: Array<Record<string, unknown>>,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let assistantBlocks: MessageContentBlock[] = [];
  let assistantStartedAtMs: number | null = null;
  let assistantEndedAtMs: number | null = null;
  let assistantElapsedMs: number | null = null;
  let assistantProcessCount = 0;

  const resetAssistant = () => {
    assistantBlocks = [];
    assistantStartedAtMs = null;
    assistantEndedAtMs = null;
    assistantElapsedMs = null;
    assistantProcessCount = 0;
  };

  const noteAssistantActivity = (payload: Record<string, unknown>) => {
    const ms = timestampMsOf(payload);
    if (ms === null) return;
    assistantStartedAtMs = assistantStartedAtMs ?? ms;
    assistantEndedAtMs = ms;
  };

  const flushAssistant = () => {
    if (assistantBlocks.length === 0) {
      resetAssistant();
      return;
    }

    const derivedElapsedMs =
      assistantElapsedMs ??
      (assistantStartedAtMs !== null && assistantEndedAtMs !== null && assistantEndedAtMs >= assistantStartedAtMs
        ? assistantEndedAtMs - assistantStartedAtMs
        : null);
    const hasProcessBlocks = assistantBlocks.some((block) => block.type === 'tool_use' || block.type === 'tool_result');
    if (derivedElapsedMs !== null || assistantProcessCount > 0 || hasProcessBlocks) {
      const summary: MessageContentBlock = { type: 'codex_summary' };
      if (derivedElapsedMs !== null) summary.elapsed_ms = derivedElapsedMs;
      if (assistantProcessCount > 0) summary.process_count = assistantProcessCount;
      assistantBlocks.unshift(summary);
    }

    messages.push({ role: 'assistant', content: serializeBlocks(assistantBlocks) });
    resetAssistant();
  };

  for (const payload of payloads) {
    if (payload.type === 'message') {
      if (payload.role === 'user') {
        flushAssistant();
        const text = extractUserDisplayText(payload.content);
        if (text) {
          messages.push({ role: 'user', content: serializeBlocks([{ type: 'text', text }]) });
        }
        continue;
      }
      if (payload.role === 'assistant') {
        noteAssistantActivity(payload);
        const phase = typeof payload.phase === 'string' ? payload.phase : null;
        if (phase && phase !== 'final_answer') {
          assistantBlocks.push(...extractAssistantProcessBlock(payload.content));
          assistantProcessCount += 1;
          continue;
        }
        assistantBlocks.push(...extractAssistantBlocks(payload.content));
      }
      continue;
    }

    if (payload.type === 'function_call') {
      noteAssistantActivity(payload);
      const callId =
        typeof payload.call_id === 'string'
          ? payload.call_id
          : typeof payload.id === 'string'
            ? payload.id
            : `codex-call-${messages.length}-${assistantBlocks.length}`;
      assistantBlocks.push({
        type: 'tool_use',
        id: callId,
        name: typeof payload.name === 'string' && payload.name ? payload.name : 'function_call',
        input: parseToolInput(payload.arguments),
      });
      continue;
    }

    if (payload.type === 'function_call_output') {
      noteAssistantActivity(payload);
      const callId =
        typeof payload.call_id === 'string'
          ? payload.call_id
          : typeof payload.id === 'string'
            ? payload.id
            : `codex-call-${messages.length}-${assistantBlocks.length}`;
      assistantBlocks.push({
        type: 'tool_result',
        tool_use_id: callId,
        content: stringifyToolOutput(payload.output),
        is_error: payload.status === 'failed',
      });
      continue;
    }

    if (payload.type === 'task_complete') {
      noteAssistantActivity(payload);
      const durationMs = numberOrNull(payload.duration_ms);
      if (durationMs !== null && durationMs >= 0) {
        assistantElapsedMs = durationMs;
      }
    }
  }

  flushAssistant();
  return messages;
}

async function scanRolloutLines<T>(
  filePath: string,
  visit: (line: string) => T | undefined,
): Promise<T | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const result = visit(line);
        if (result !== undefined) {
          lines.close();
          stream.destroy();
          return result;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
    return null;
  } catch {
    return null;
  }
}

async function readRolloutPayloadsForDisplay(filePath: string): Promise<Array<Record<string, unknown>>> {
  const payloads: Array<Record<string, unknown>> = [];
  await scanRolloutLines(filePath, (line) => {
    if (!line.trim()) return undefined;
    const parsed = parseJsonLine(line);
    if (!parsed) return undefined;
    if (parsed.type === 'response_item') {
      payloads.push(withLineTimestamp(payloadOf(parsed), parsed));
      return undefined;
    }
    if (parsed.type === 'event_msg') {
      const payload = payloadOf(parsed);
      if (payload.type === 'task_complete') {
        payloads.push(withLineTimestamp(payload, parsed));
      }
    }
    return undefined;
  });
  return payloads;
}

async function parseRolloutMeta(filePath: string): Promise<CodexRolloutMeta | null> {
  let meta: Record<string, unknown> | null = null;
  let model = '';
  await scanRolloutLines(filePath, (line) => {
    if (!line.trim()) return undefined;
    const parsed = parseJsonLine(line);
    if (!parsed) return undefined;
    if (parsed.type === 'session_meta') {
      meta = payloadOf(parsed);
      return undefined;
    }
    if (parsed.type === 'turn_context') {
      const payload = payloadOf(parsed);
      if (!model && typeof payload.model === 'string') model = payload.model;
    }
    return meta && model ? true : undefined;
  });
  const parsedMeta = meta as Record<string, unknown> | null;
  if (!parsedMeta) return null;
  const sessionId = typeof parsedMeta.session_id === 'string'
    ? parsedMeta.session_id
    : typeof parsedMeta.id === 'string'
      ? parsedMeta.id
      : '';
  const cwd = typeof parsedMeta.cwd === 'string' ? parsedMeta.cwd : '';
  const modelProvider = typeof parsedMeta.model_provider === 'string' ? parsedMeta.model_provider : '';
  const timestamp = typeof parsedMeta.timestamp === 'string' ? parsedMeta.timestamp : '';
  if (!sessionId || !cwd) return null;
  let updatedAt = timestamp || new Date().toISOString();
  try {
    updatedAt = new Date((await stat(filePath)).mtimeMs).toISOString();
  } catch {
    updatedAt = timestamp || updatedAt;
  }
  return { sessionId, cwd, modelProvider, timestamp, filePath, model, updatedAt };
}

async function firstUserTitle(filePath: string): Promise<string> {
  const title = await scanRolloutLines(filePath, (line) => {
    if (!line.trim()) return undefined;
    const parsed = parseJsonLine(line);
    if (!parsed || parsed.type !== 'response_item') return undefined;
    const payload = payloadOf(parsed);
    if (payload.type !== 'message' || payload.role !== 'user') return undefined;
    const text = extractUserDisplayText(payload.content).trim().replace(/\s+/g, ' ');
    if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text;
    return undefined;
  });
  return title || 'Codex 会话';
}

function metaToSession(meta: CodexRolloutMeta, title: string): ChatSession {
  const createdAt = meta.timestamp || meta.updatedAt;
  return {
    id: toCodexVirtualSessionId(meta.sessionId),
    title,
    created_at: createdAt,
    updated_at: meta.updatedAt,
    model: meta.model,
    system_prompt: '',
    working_directory: meta.cwd,
    sdk_session_id: '',
    codex_thread_id: meta.sessionId,
    codex_thread_provider_id: meta.modelProvider,
    project_name: path.basename(meta.cwd) || meta.cwd,
    source: 'user',
    origin: CODEX_ROLLOUT_ORIGIN,
    read_only: true,
    codex_session_id: meta.sessionId,
    model_provider: meta.modelProvider,
    status: 'active',
    mode: 'code',
    provider_name: 'Codex',
    provider_id: 'codex_account',
    runtime_pin: 'codex_runtime',
    sdk_cwd: meta.cwd,
    runtime_status: 'ready',
    runtime_updated_at: meta.updatedAt,
    runtime_error: '',
    permission_profile: 'request_approval',
  };
}

async function matchingMetas(options: ListOptions): Promise<CodexRolloutMeta[]> {
  const config = await readCodexConfig(options.codexHome);
  const root = sessionsRoot(config.codexHome);
  const files = await collectJsonlFiles(root);
  const metas = new Map<string, CodexRolloutMeta>();
  for (const file of files) {
    const meta = await parseRolloutMeta(file);
    if (!meta) continue;
    if (config.modelProvider && meta.modelProvider !== config.modelProvider) continue;
    if (options.cwd && !(await sameCwd(meta.cwd, options.cwd))) continue;
    const previous = metas.get(meta.sessionId);
    if (!previous || meta.updatedAt > previous.updatedAt) {
      metas.set(meta.sessionId, meta);
    }
  }
  return Array.from(metas.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listCodexRolloutSessions(options: ListOptions = {}): Promise<ChatSession[]> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 200);
  const metas = await matchingMetas(options);
  const sessions: ChatSession[] = [];
  for (const meta of metas.slice(0, limit)) {
    sessions.push(metaToSession(meta, await firstUserTitle(meta.filePath)));
  }
  return sessions;
}

export async function getCodexRolloutSession(id: string, options: ListOptions = {}): Promise<ChatSession | null> {
  const sessionId = fromCodexVirtualSessionId(id);
  const metas = await matchingMetas(options);
  const meta = metas.find((m) => m.sessionId === sessionId);
  return meta ? metaToSession(meta, await firstUserTitle(meta.filePath)) : null;
}

export async function getCodexRolloutMeta(id: string, options: ListOptions = {}): Promise<CodexRolloutMeta | null> {
  const sessionId = fromCodexVirtualSessionId(id);
  const metas = await matchingMetas(options);
  return metas.find((m) => m.sessionId === sessionId) ?? null;
}

export async function getCodexRolloutMessages(id: string, options: MessageOptions = {}): Promise<MessagesResponse> {
  const sessionId = fromCodexVirtualSessionId(id);
  const metas = await matchingMetas(options);
  const meta = metas.find((m) => m.sessionId === sessionId);
  if (!meta) return { messages: [], hasMore: false };
  const payloads = await readRolloutPayloadsForDisplay(meta.filePath);

  const messages: Message[] = [];
  let rowid = 1;
  for (const normalized of normalizeCodexRolloutPayloadsForDisplay(payloads)) {
    messages.push({
      id: `${sessionId}-${rowid}`,
      session_id: toCodexVirtualSessionId(sessionId),
      role: normalized.role,
      content: normalized.content,
      created_at: meta.timestamp || meta.updatedAt,
      token_usage: null,
      _rowid: rowid,
    } as Message);
    rowid += 1;
  }

  const before = options.before;
  const filtered = before ? messages.filter((m) => ((m as Message & { _rowid?: number })._rowid ?? 0) < before) : messages;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 500);
  const page = filtered.slice(-limit);
  return { messages: page, hasMore: filtered.length > page.length };
}
