import path from 'node:path';
import type { ChatSession } from '@/types';
import { getCodexAppServer } from './app-server-manager';
import {
  CODEX_ROLLOUT_ORIGIN,
  fromCodexVirtualSessionId,
  readCodexConfig,
  toCodexVirtualSessionId,
} from './session-rollouts';

const DEFAULT_LIMIT = 50;

export interface CodexThreadListClient {
  request<TResult>(method: string, params?: unknown): Promise<TResult>;
}

interface CodexThreadListOptions {
  codexHome?: string;
  cwd: string;
  limit?: number;
}

interface CodexThreadListDeps {
  client?: CodexThreadListClient;
}

interface CodexThreadListResponse {
  data?: CodexThreadListItem[];
}

export interface CodexThreadListItem {
  id?: unknown;
  sessionId?: unknown;
  preview?: unknown;
  name?: unknown;
  modelProvider?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  recencyAt?: unknown;
  cwd?: unknown;
  path?: unknown;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), 200);
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unixSecondsToIso(value: unknown, fallback: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return new Date(value * 1000).toISOString();
}

export function titleFromCodexThread(thread: CodexThreadListItem): string {
  const name = stringOrEmpty(thread.name).trim();
  if (name) return name;
  const preview = stringOrEmpty(thread.preview).trim();
  return preview || '(no message yet)';
}

export function codexThreadToSession(thread: CodexThreadListItem): ChatSession | null {
  const threadId = stringOrEmpty(thread.id);
  if (!threadId) return null;

  const cwd = stringOrEmpty(thread.cwd);
  const modelProvider = stringOrEmpty(thread.modelProvider);
  const createdAt = unixSecondsToIso(thread.createdAt, new Date(0).toISOString());
  const updatedAt = unixSecondsToIso(thread.updatedAt ?? thread.recencyAt, createdAt);
  const title = titleFromCodexThread(thread);

  return {
    id: toCodexVirtualSessionId(threadId),
    title,
    created_at: createdAt,
    updated_at: updatedAt,
    model: '',
    system_prompt: '',
    working_directory: cwd,
    sdk_session_id: '',
    codex_thread_id: threadId,
    codex_thread_provider_id: modelProvider,
    codex_home_session_id: threadId,
    codex_home_model_provider: modelProvider,
    project_name: path.basename(cwd) || cwd,
    source: 'user',
    origin: CODEX_ROLLOUT_ORIGIN,
    read_only: true,
    codex_session_id: threadId,
    model_provider: modelProvider,
    status: 'active',
    mode: 'code',
    provider_name: 'Codex',
    provider_id: 'codex_account',
    runtime_pin: 'codex_runtime',
    sdk_cwd: cwd,
    runtime_status: 'ready',
    runtime_updated_at: updatedAt,
    runtime_error: '',
    permission_profile: 'request_approval',
  };
}

export async function listCodexThreadSessions(
  options: CodexThreadListOptions,
  deps: CodexThreadListDeps = {},
): Promise<ChatSession[]> {
  const limit = clampLimit(options.limit);
  const config = await readCodexConfig(options.codexHome);
  const client = deps.client ?? (await getCodexAppServer()).client;
  const result = await client.request<CodexThreadListResponse>('thread/list', {
    cursor: null,
    limit,
    sortKey: 'updated_at',
    sortDirection: null,
    modelProviders: config.modelProvider ? [config.modelProvider] : null,
    sourceKinds: null,
    archived: false,
    cwd: options.cwd,
    useStateDbOnly: false,
    searchTerm: null,
  });

  return (result.data ?? [])
    .map(codexThreadToSession)
    .filter((session): session is ChatSession => session !== null)
    .slice(0, limit);
}

export async function getCodexThreadSession(
  id: string,
  options: CodexThreadListOptions,
  deps: CodexThreadListDeps = {},
): Promise<ChatSession | null> {
  const sessionId = fromCodexVirtualSessionId(id);
  const sessions = await listCodexThreadSessions({
    ...options,
    limit: 200,
  }, deps);
  return sessions.find((session) => session.codex_session_id === sessionId) ?? null;
}
