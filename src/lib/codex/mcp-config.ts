/**
 * Codex MCP config builder.
 *
 * Maps CodexWeb `MCPServerConfig` → Codex native `config.mcp_servers`
 * entries, and builds the entry for the in-process CodexWeb Memory MCP
 * (served as a streamable-HTTP Next route — see
 * `src/app/api/codex/mcp/memory/route.ts`).
 *
 * Phase 8 Phase 1. Validated against Codex 0.133 in
 * `docs/research/codex-mcp-injection-poc/`:
 *   - stdio → { command, args, env }   (Phase 0 main run)
 *   - http  → { url, http_headers }    (streamable_http; poc-streamable-http.mjs)
 *   - sse   → UNSUPPORTED — Codex has no native SSE transport; its
 *             `McpServerTransportConfig` (codex-rs/config/src/mcp_types.rs)
 *             is only `Stdio` + `StreamableHttp`.
 *
 * Codex picks the transport by SHAPE, not a `type` field: an entry with
 * `command` is stdio; an entry with `url` is streamable_http. So these
 * builders emit one or the other, never a `type` discriminator.
 *
 * Security: the produced config can end up in persisted thread metadata,
 * so `redactCodexMcpConfigForLog` MUST be used before logging — it strips
 * stdio `env` values and `http_headers` values. The Memory MCP entry
 * itself never carries secrets (only a workspace path + session id).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import type { MCPServerConfig } from '@/types';

export interface CodexStdioMcpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Spawn cwd. Lets a stdio wrapper resolve its own deps regardless of
   *  where Codex launches it (Phase 0 finding: node resolves from the
   *  entry file location, but an explicit cwd is belt-and-suspenders). */
  cwd?: string;
}

export interface CodexStreamableHttpMcpServer {
  url: string;
  http_headers?: Record<string, string>;
  /** Codex reads the bearer token from this env var name (never inline). */
  bearer_token_env_var?: string;
}

export type CodexMcpServerEntry = CodexStdioMcpServer | CodexStreamableHttpMcpServer;
export type CodexMcpServersConfig = Record<string, CodexMcpServerEntry>;

export interface UnsupportedMcpServer {
  name: string;
  reason: string;
}

export interface BuildCodexMcpServersResult {
  /** Servers that mapped cleanly to a Codex transport. */
  servers: CodexMcpServersConfig;
  /** Servers we refused to map, with a user-facing reason. Surfaced so the
   *  capability matrix / Settings can explain "why not callable" instead of
   *  silently dropping a configured server. */
  unsupported: UnsupportedMcpServer[];
}

export function isStdioEntry(e: CodexMcpServerEntry): e is CodexStdioMcpServer {
  return 'command' in e;
}

/**
 * Map a CodexWeb user MCP server map → Codex `mcp_servers`.
 *
 * Disabled servers (`enabled === false`) are skipped silently. A server
 * whose transport can't be mapped (sse; or missing command/url) is NOT
 * silently dropped — it lands in `unsupported` with a reason.
 */
export function buildCodexMcpServersConfig(
  input: Record<string, MCPServerConfig>,
): BuildCodexMcpServersResult {
  const servers: CodexMcpServersConfig = {};
  const unsupported: UnsupportedMcpServer[] = [];

  for (const [name, config] of Object.entries(input ?? {})) {
    if (config.enabled === false) continue;
    const transport = config.type ?? 'stdio';

    switch (transport) {
      case 'stdio': {
        if (!config.command || config.command.trim() === '') {
          unsupported.push({ name, reason: 'stdio server is missing a command' });
          continue;
        }
        const entry: CodexStdioMcpServer = { command: config.command };
        if (config.args && config.args.length > 0) entry.args = [...config.args];
        if (config.env && Object.keys(config.env).length > 0) entry.env = { ...config.env };
        servers[name] = entry;
        break;
      }
      case 'http': {
        if (!config.url || config.url.trim() === '') {
          unsupported.push({ name, reason: 'http server is missing a url' });
          continue;
        }
        const entry: CodexStreamableHttpMcpServer = { url: config.url };
        if (config.headers && Object.keys(config.headers).length > 0) {
          entry.http_headers = { ...config.headers };
        }
        servers[name] = entry;
        break;
      }
      case 'sse': {
        unsupported.push({
          name,
          reason:
            'Codex MCP injection has no native SSE transport (stdio + streamable HTTP only). Use type "http" for a streamable-HTTP server.',
        });
        break;
      }
      default: {
        unsupported.push({ name, reason: `unknown transport "${String(transport)}"` });
      }
    }
  }

  return { servers, unsupported };
}

/** Codex `mcp_servers` keys for CodexWeb built-in MCP servers. The key is
 *  also the route path segment (see `/api/codex/mcp/[server]`). */
export const CODEX_MEMORY_MCP_SERVER_NAME = 'codepilot_memory';
export const CODEX_WIDGET_MCP_SERVER_NAME = 'codepilot_widget';
export const CODEX_TASKS_MCP_SERVER_NAME = 'codepilot_tasks';
// Per-capability mutation-level split (Codex review next slice, 2026-05-28).
// Each capability is exposed under TWO server names: a safe-read MCP
// (auto_accept on elicitation) and a mutating MCP (user_approval). Codex's
// elicitation params identify the SERVER, not the individual tool, so
// per-tool policy isn't possible from a single server entry — splitting by
// server is the cleanest way to give read tools auto-accept while keeping
// writes behind the user's approval card.
export const CODEX_DASHBOARD_READ_MCP_SERVER_NAME = 'codepilot_dashboard_read';
export const CODEX_DASHBOARD_WRITE_MCP_SERVER_NAME = 'codepilot_dashboard_write';
export const CODEX_CLI_TOOLS_READ_MCP_SERVER_NAME = 'codepilot_cli_tools_read';
export const CODEX_CLI_TOOLS_WRITE_MCP_SERVER_NAME = 'codepilot_cli_tools_write';

/** Header the Memory MCP route reads to scope memory reads to a workspace. */
export const MEMORY_MCP_WORKSPACE_HEADER = 'x-codepilot-workspace-path';
/** Header used to associate a chat session. */
export const MEMORY_MCP_SESSION_HEADER = 'x-codepilot-session-id';
/** Base path serving CodexWeb built-in MCP servers over streamable HTTP;
 *  the server name is appended (e.g. /api/codex/mcp/codepilot_memory). */
export const CODEX_MCP_ROUTE_BASE = '/api/codex/mcp';

/**
 * Build the Codex `mcp_servers` entry for the CodexWeb Memory MCP.
 *
 * The Memory MCP is an in-process Claude-SDK server (`memory-search-mcp.ts`)
 * that can't be spawned as a subprocess; instead we expose it as a
 * streamable-HTTP route on CodexWeb's own Next server (already running in
 * dev AND packaged Electron) and point Codex at it. The workspace path
 * travels in a header (not a secret), mirroring the provider-proxy
 * injection pattern.
 */
export function buildCodexMemoryMcpConfig(opts: {
  /** Absolute URL CodexWeb's Next server is reachable at from Codex. */
  baseUrl: string;
  /** Assistant workspace whose memory files the tools read. */
  workspacePath: string;
  /** Optional chat session id (telemetry / future scoping). */
  sessionId?: string;
  /** Override the `mcp_servers` key (default `codepilot_memory`). */
  serverName?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const name = opts.serverName ?? CODEX_MEMORY_MCP_SERVER_NAME;
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {
    [MEMORY_MCP_WORKSPACE_HEADER]: opts.workspacePath,
  };
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  return { name, entry: { url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${name}`, http_headers } };
}

/**
 * Build the Codex `mcp_servers` entry for the CodexWeb Widget MCP
 * (`codepilot_load_widget_guidelines` — static read-only guidelines text,
 * served by the same `/api/codex/mcp/[server]` route). No workspace header:
 * the widget server reads no files, so it isn't workspace-scoped.
 */
export function buildCodexWidgetMcpConfig(opts: {
  baseUrl: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {};
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  const entry: CodexStreamableHttpMcpServer = {
    url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${CODEX_WIDGET_MCP_SERVER_NAME}`,
  };
  if (Object.keys(http_headers).length > 0) entry.http_headers = http_headers;
  return { name: CODEX_WIDGET_MCP_SERVER_NAME, entry };
}

/**
 * Build the Codex `mcp_servers` entry for the CodexWeb Tasks/Notify MCP
 * (`codepilot_schedule_task` / `cancel_task` / `notify` / `list_tasks`).
 * Like Memory it carries workspace + session headers (the route's
 * `createNotificationMcpServer` scopes tasks by sessionId + working dir).
 * Mutating/side-effecting → its tool-call approval is `user_approval`
 * (see builtin-mcp-servers.ts), NOT auto-accepted.
 */
export function buildCodexTasksMcpConfig(opts: {
  baseUrl: string;
  workspacePath: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {
    [MEMORY_MCP_WORKSPACE_HEADER]: opts.workspacePath,
  };
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  return {
    name: CODEX_TASKS_MCP_SERVER_NAME,
    entry: { url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${CODEX_TASKS_MCP_SERVER_NAME}`, http_headers },
  };
}

/**
 * Build a Codex `mcp_servers` entry for a workspace-scoped built-in MCP
 * route (memory / dashboard read+write). Carries workspace + session
 * headers; the route's `authorize` checks the workspace against the
 * configured assistant workspace.
 */
function buildWorkspaceScopedConfig(opts: {
  serverName: string;
  baseUrl: string;
  workspacePath: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {
    [MEMORY_MCP_WORKSPACE_HEADER]: opts.workspacePath,
  };
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  return {
    name: opts.serverName,
    entry: { url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${opts.serverName}`, http_headers },
  };
}

/** Codex `mcp_servers` entry for the safe-read Dashboard MCP
 *  (list / refresh). auto_accept on elicitation. */
export function buildCodexDashboardReadMcpConfig(opts: {
  baseUrl: string;
  workspacePath: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  return buildWorkspaceScopedConfig({ ...opts, serverName: CODEX_DASHBOARD_READ_MCP_SERVER_NAME });
}

/** Codex `mcp_servers` entry for the mutating Dashboard MCP
 *  (pin / update / remove). user_approval on elicitation. */
export function buildCodexDashboardWriteMcpConfig(opts: {
  baseUrl: string;
  workspacePath: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  return buildWorkspaceScopedConfig({ ...opts, serverName: CODEX_DASHBOARD_WRITE_MCP_SERVER_NAME });
}

/** Codex `mcp_servers` entry for the safe-read CLI tools MCP
 *  (list / check_updates). auto_accept on elicitation. No workspace
 *  scope: CLI tools are system-wide. */
export function buildCodexCliToolsReadMcpConfig(opts: {
  baseUrl: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {};
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  const entry: CodexStreamableHttpMcpServer = {
    url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${CODEX_CLI_TOOLS_READ_MCP_SERVER_NAME}`,
  };
  if (Object.keys(http_headers).length > 0) entry.http_headers = http_headers;
  return { name: CODEX_CLI_TOOLS_READ_MCP_SERVER_NAME, entry };
}

/** Codex `mcp_servers` entry for the mutating CLI tools MCP
 *  (install / add / remove / update). user_approval on elicitation. */
export function buildCodexCliToolsWriteMcpConfig(opts: {
  baseUrl: string;
  sessionId?: string;
}): { name: string; entry: CodexStreamableHttpMcpServer } {
  const trimmed = opts.baseUrl.replace(/\/+$/, '');
  const http_headers: Record<string, string> = {};
  if (opts.sessionId && opts.sessionId.length > 0) {
    http_headers[MEMORY_MCP_SESSION_HEADER] = opts.sessionId;
  }
  const entry: CodexStreamableHttpMcpServer = {
    url: `${trimmed}${CODEX_MCP_ROUTE_BASE}/${CODEX_CLI_TOOLS_WRITE_MCP_SERVER_NAME}`,
  };
  if (Object.keys(http_headers).length > 0) entry.http_headers = http_headers;
  return { name: CODEX_CLI_TOOLS_WRITE_MCP_SERVER_NAME, entry };
}

/** Recursively sort object keys so equal configs hash identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Stable fingerprint of an `mcp_servers` config, for deciding whether a
 * resumed Codex thread still matches the current MCP wiring. Key order and
 * undefined/empty config both fold to a deterministic value. Returns a
 * short hex digest (not the raw config), so it never leaks secrets.
 */
export function fingerprintCodexMcpConfig(config: CodexMcpServersConfig | undefined): string {
  if (!config || Object.keys(config).length === 0) return 'none';
  const canonical = JSON.stringify(canonicalize(config));
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Log-safe view of an `mcp_servers` config: stdio `env` values and
 * streamable-HTTP `http_headers` values are replaced with `[redacted]`.
 * Use this before logging/persisting anything human-visible — the real
 * config (with secrets) only ever goes to Codex over the local channel.
 */
export function redactCodexMcpConfigForLog(config: CodexMcpServersConfig): CodexMcpServersConfig {
  const out: CodexMcpServersConfig = {};
  for (const [name, entry] of Object.entries(config)) {
    if (isStdioEntry(entry)) {
      out[name] = {
        ...entry,
        ...(entry.env ? { env: redactValues(entry.env) } : {}),
      };
    } else {
      out[name] = {
        ...entry,
        ...(entry.http_headers ? { http_headers: redactValues(entry.http_headers) } : {}),
      };
    }
  }
  return out;
}

function redactValues(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(rec)) out[k] = '[redacted]';
  return out;
}

/**
 * True iff both paths resolve (realpath) to the same location. Normalizes
 * trailing slashes and symlinks (e.g. macOS `/tmp` → `/private/tmp`). A
 * non-existent path → false.
 *
 * Shared by the runtime injection gate (decide whether the current cwd IS
 * the assistant workspace → inject Memory MCP) and the Memory MCP route
 * (authorize the requested workspace header). Using the SAME comparison in
 * both keeps "should inject" and "is authorized" in agreement, so a raw
 * string-equality drift (trailing slash / symlink) can't make the runtime
 * inject a workspace the route then 403s.
 */
export function sameRealPath(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}
