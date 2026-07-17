import type { ConfigReadResponse } from "@/codex/protocol/generated/v2/ConfigReadResponse";
import type { MCPServer } from "@/types";

type UnknownRecord = Record<string, unknown>;

export function mcpServersFromConfig(config: ConfigReadResponse | null | undefined): Record<string, MCPServer> {
  const root = readRecord(config?.config);
  return mcpServersFromConfigValue(readRecord(root.mcp_servers));
}

export function mcpServersFromConfigValue(rawServers: Record<string, unknown>): Record<string, MCPServer> {
  const servers: Record<string, MCPServer> = {};

  for (const [name, value] of Object.entries(rawServers)) {
    const raw = readRecord(value);
    if (!Object.keys(raw).length) continue;
    const { http_headers } = raw;
    const rest = Object.fromEntries(
      Object.entries(raw).filter(([key, item]) => MCP_CONFIG_KEYS.has(key) && item !== null && item !== undefined),
    );
    const server: MCPServer = {
      ...rest,
      type: typeof raw.url === "string" ? "http" : "stdio",
    } as MCPServer;
    if (isStringRecord(http_headers)) server.headers = http_headers;
    servers[name] = server;
  }

  return servers;
}

export function mcpServersToConfigValue(servers: Record<string, MCPServer>): Record<string, UnknownRecord> {
  const result: Record<string, UnknownRecord> = {};
  for (const [name, server] of Object.entries(servers)) {
    const { type: _type, headers, ...rest } = server;
    const allowed = Object.fromEntries(
      Object.entries(rest).filter(([key, value]) => MCP_CONFIG_KEYS.has(key) && value !== null && value !== undefined),
    );
    result[name] = {
      ...allowed,
      ...(headers && Object.keys(headers).length ? { http_headers: headers } : {}),
    };
  }
  return result;
}

const MCP_CONFIG_KEYS = new Set([
  "command", "args", "env", "env_vars", "cwd", "enabled", "required",
  "experimental_environment", "startup_timeout_sec", "tool_timeout_sec",
  "enabled_tools", "disabled_tools", "scopes", "oauth_resource", "url",
  "bearer_token_env_var", "env_http_headers",
]);

function readRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function isStringRecord(value: unknown): value is Record<string, string> {
  const record = readRecord(value);
  return Object.keys(record).length > 0 && Object.values(record).every((item) => typeof item === "string");
}
