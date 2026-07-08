import { getCodexAppServer } from './app-server-manager';
import {
  fromCodexVirtualSessionId,
  toCodexVirtualSessionId,
} from './session-rollouts';
import type { Message, MessageContentBlock, MessagesResponse } from '@/types';

const DEFAULT_LIMIT = 50;
const MAX_DISPLAY_STRING_LENGTH = 20_000;

export interface CodexThreadTranscriptClient {
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
}

interface CodexThreadTranscriptDeps {
  client?: CodexThreadTranscriptClient;
}

interface CodexThreadReadResponse {
  thread?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unixSecondsToIso(value: unknown, fallback: string): string {
  const seconds = numberOrNull(value);
  if (seconds === null || seconds <= 0) return fallback;
  return new Date(seconds * 1000).toISOString();
}

function itemType(item: Record<string, unknown>): string {
  return stringOrEmpty(item.type || item.kind);
}

function camelOrSnake(item: Record<string, unknown>, camel: string, snake: string): unknown {
  return item[camel] ?? item[snake];
}

function textFromContent(content: unknown, role: 'user' | 'assistant'): string {
  if (typeof content === 'string') return content;
  const record = asRecord(content);
  if (record) {
    const text = stringOrEmpty(record.text);
    return text || stringOrEmpty(record.content);
  }
  if (!Array.isArray(content)) return '';

  const wanted = role === 'user'
    ? new Set(['input_text', 'text'])
    : new Set(['output_text', 'text']);
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      const rec = asRecord(block);
      if (!rec) return '';
      const type = stringOrEmpty(rec.type);
      if (type && !wanted.has(type)) return '';
      return stringOrEmpty(rec.text || rec.content);
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

function textFromSummaryValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        const rec = asRecord(entry);
        return rec ? stringOrEmpty(rec.text || rec.content) : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  const rec = asRecord(value);
  return rec ? stringOrEmpty(rec.text || rec.content) : '';
}

function truncateDisplayString(value: string): string {
  if (value.length <= MAX_DISPLAY_STRING_LENGTH) return value;
  const omitted = value.length - MAX_DISPLAY_STRING_LENGTH;
  return `${value.slice(0, MAX_DISPLAY_STRING_LENGTH)}\n… 已省略 ${omitted} 个字符`;
}

function sanitizeForDisplay(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncateDisplayString(value);
  if (depth > 6) return '[省略过深的工具输出]';
  if (Array.isArray(value)) return value.map((item) => sanitizeForDisplay(item, depth + 1));
  const rec = asRecord(value);
  if (!rec) return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(rec)) {
    const lowerKey = key.toLowerCase();
    if (
      typeof entry === 'string' &&
      entry.length > 500 &&
      (lowerKey === 'data' || lowerKey === 'base64' || lowerKey.includes('image') || lowerKey.includes('screenshot'))
    ) {
      sanitized[key] = `[已省略大体积 ${key}，长度 ${entry.length}]`;
      continue;
    }
    sanitized[key] = sanitizeForDisplay(entry, depth + 1);
  }
  return sanitized;
}

function stringify(value: unknown): string {
  const sanitized = sanitizeForDisplay(value);
  if (typeof sanitized === 'string') return sanitized;
  try {
    return JSON.stringify(sanitized);
  } catch {
    return String(sanitized);
  }
}

function commandText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((part) => stringify(part)).join(' ');
  }
  return stringify(value);
}

function pushText(blocks: MessageContentBlock[], type: 'text' | 'codex_process_text', text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (type === 'text') {
    blocks.push({ type: 'text', text: trimmed });
  } else {
    blocks.push({ type: 'codex_process_text', text: trimmed });
  }
}

function pushTool(
  blocks: MessageContentBlock[],
  input: { id: string; name: string; input: unknown; output?: unknown; failed?: boolean },
): void {
  blocks.push({ type: 'tool_use', id: input.id, name: input.name, input: input.input });
  if (input.output !== undefined) {
    blocks.push({
      type: 'tool_result',
      tool_use_id: input.id,
      content: stringify(input.output),
      is_error: input.failed || undefined,
    });
  }
}

function threadItemToAssistantBlocks(
  item: Record<string, unknown>,
  fallbackId: string,
  agentTextType: 'text' | 'codex_process_text' = 'text',
): { blocks: MessageContentBlock[]; processCount: number } {
  const type = itemType(item);
  const blocks: MessageContentBlock[] = [];

  if (type === 'agentMessage' || type === 'agent_message') {
    pushText(blocks, agentTextType, stringOrEmpty(item.text || item.content));
    return { blocks, processCount: agentTextType === 'codex_process_text' && blocks.length > 0 ? 1 : 0 };
  }

  if (type === 'reasoning' || type === 'plan') {
    const text = [
      textFromSummaryValue(item.summary),
      textFromSummaryValue(item.content),
      stringOrEmpty(item.text),
    ].filter(Boolean).join('\n');
    pushText(blocks, 'codex_process_text', text);
    return { blocks, processCount: blocks.length > 0 ? 1 : 0 };
  }

  if (type === 'commandExecution' || type === 'command_execution') {
    const id = stringOrEmpty(item.id) || fallbackId;
    const command = camelOrSnake(item, 'command', 'command');
    const output = camelOrSnake(item, 'aggregatedOutput', 'aggregated_output') ?? item.output;
    const status = stringOrEmpty(item.status);
    const exitCode = numberOrNull(camelOrSnake(item, 'exitCode', 'exit_code'));
    pushTool(blocks, {
      id,
      name: 'exec_command',
      input: {
        cmd: commandText(command),
        cwd: stringOrEmpty(item.cwd),
      },
      output,
      failed: status === 'failed' || (exitCode !== null && exitCode !== 0),
    });
    return { blocks, processCount: 1 };
  }

  if (type === 'mcpToolCall' || type === 'mcp_tool_call' || type === 'dynamicToolCall' || type === 'dynamic_tool_call') {
    const id = stringOrEmpty(item.id || item.callId || item.call_id) || fallbackId;
    const server = stringOrEmpty(item.server || item.serverName || item.server_name);
    const tool = stringOrEmpty(item.tool || item.toolName || item.tool_name || item.name) || 'tool_call';
    const name = server ? `${server}.${tool}` : tool;
    const output = item.result ?? item.output ?? item.error;
    pushTool(blocks, {
      id,
      name,
      input: item.arguments ?? item.input ?? {},
      output,
      failed: item.error !== undefined || stringOrEmpty(item.status) === 'failed',
    });
    return { blocks, processCount: 1 };
  }

  if (type === 'fileChange' || type === 'file_change') {
    const id = stringOrEmpty(item.id) || fallbackId;
    pushTool(blocks, {
      id,
      name: 'apply_patch',
      input: item.changes ?? item.diff ?? item,
      output: item.summary ?? item.status,
      failed: stringOrEmpty(item.status) === 'failed',
    });
    return { blocks, processCount: 1 };
  }

  const fallbackText = stringOrEmpty(item.text || item.message || item.summary);
  pushText(blocks, 'codex_process_text', fallbackText);
  return { blocks, processCount: blocks.length > 0 ? 1 : 0 };
}

function normalizeThreadResponse(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  if (!direct) return null;
  return asRecord((direct as CodexThreadReadResponse).thread) ?? direct;
}

async function readThread(
  client: CodexThreadTranscriptClient,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return normalizeThreadResponse(await client.request('thread/read', {
      threadId,
      includeTurns: true,
    }));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return normalizeThreadResponse(await client.request('thread/read', {
      thread_id: threadId,
      include_turns: true,
    }));
  }
}

export function codexThreadToMessages(thread: unknown, sessionId: string): Message[] {
  const rec = asRecord(thread);
  const turns = Array.isArray(rec?.turns) ? rec.turns : [];
  const messages: Message[] = [];
  let rowid = 1;

  for (const rawTurn of turns) {
    const turn = asRecord(rawTurn);
    if (!turn) continue;
    const startedAt = unixSecondsToIso(
      camelOrSnake(turn, 'startedAt', 'started_at'),
      new Date(0).toISOString(),
    );
    const durationMs = numberOrNull(camelOrSnake(turn, 'durationMs', 'duration_ms'));
    const items = Array.isArray(turn.items) ? turn.items : [];
    const assistantItems: Record<string, unknown>[] = [];

    const flushAssistant = () => {
      const assistantBlocks: MessageContentBlock[] = [];
      let processCount = 0;
      const lastAgentIndex = assistantItems.reduce((lastIndex, item, index) => {
        const type = itemType(item);
        return type === 'agentMessage' || type === 'agent_message' ? index : lastIndex;
      }, -1);

      assistantItems.forEach((item, index) => {
        const type = itemType(item);
        const agentTextType =
          (type === 'agentMessage' || type === 'agent_message') && index !== lastAgentIndex
            ? 'codex_process_text'
            : 'text';
        const converted = threadItemToAssistantBlocks(item, `${sessionId}-tool-${rowid}-${assistantBlocks.length}`, agentTextType);
        assistantBlocks.push(...converted.blocks);
        processCount += converted.processCount;
      });

      if (assistantBlocks.length === 0) {
        assistantItems.length = 0;
        return;
      }
      const hasProcess = assistantBlocks.some((block) => (
        block.type === 'codex_process_text' ||
        block.type === 'tool_use' ||
        block.type === 'tool_result'
      ));
      if (hasProcess) {
        const summary: MessageContentBlock = { type: 'codex_summary' };
        if (durationMs !== null && durationMs >= 0) summary.elapsed_ms = durationMs;
        if (processCount > 0) summary.process_count = processCount;
        assistantBlocks.unshift(summary);
      }
      messages.push({
        id: `${sessionId}-${rowid}`,
        session_id: toCodexVirtualSessionId(sessionId),
        role: 'assistant',
        content: JSON.stringify(assistantBlocks),
        created_at: startedAt,
        token_usage: null,
        _rowid: rowid,
      } as Message);
      rowid += 1;
      assistantItems.length = 0;
    };

    for (const rawItem of items) {
      const item = asRecord(rawItem);
      if (!item) continue;
      const type = itemType(item);
      if (type === 'userMessage' || type === 'user_message') {
        flushAssistant();
        const text = stripUserContextEnvelope(textFromContent(item.content, 'user')).trim();
        if (!text) continue;
        messages.push({
          id: `${sessionId}-${rowid}`,
          session_id: toCodexVirtualSessionId(sessionId),
          role: 'user',
          content: JSON.stringify([{ type: 'text', text } satisfies MessageContentBlock]),
          created_at: startedAt,
          token_usage: null,
          _rowid: rowid,
        } as Message);
        rowid += 1;
        continue;
      }

      assistantItems.push(item);
    }

    flushAssistant();
  }

  return messages;
}

export async function getCodexThreadMessages(
  id: string,
  options: { limit?: number; before?: number } = {},
  deps: CodexThreadTranscriptDeps = {},
): Promise<MessagesResponse> {
  const sessionId = fromCodexVirtualSessionId(id);
  const client = deps.client ?? (await getCodexAppServer()).client;
  const thread = await readThread(client, sessionId);
  if (!thread) return { messages: [], hasMore: false };

  const messages = codexThreadToMessages(thread, sessionId);
  const before = options.before;
  const filtered = before ? messages.filter((message) => (message._rowid ?? 0) < before) : messages;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 500);
  const page = filtered.slice(-limit);
  return { messages: page, hasMore: filtered.length > page.length };
}
