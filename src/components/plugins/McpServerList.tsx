'use client';

import { Button } from '@/components/ui/button';
import { SpinnerGap, WifiHigh } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/hooks/useTranslation';
import { showToast } from '@/hooks/useToast';
import type { TranslationKey } from '@/i18n';
import type { MCPServer } from '@/types';
import { cn } from '@/lib/utils';
import { useState, useCallback } from 'react';
import type { McpStartupByName } from '@/codex-web/mcp-startup-adapter';

/**
 * Runtime status carried alongside each user-installed server. Mirrors
 * the SDK `McpServerStatus` type but kept narrow — we only consume
 * status, optional serverInfo, and tools when connected.
 */
export interface McpRuntimeStatus {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
  serverInfo?: { name: string; version: string };
  tools?: { name: string; description?: string }[];
  authStatus?: string;
  resourceCount?: number;
  resourceTemplateCount?: number;
  error?: string;
}

interface McpServerListProps {
  servers: Record<string, MCPServer>;
  onOpenDetail: (name: string, server: MCPServer) => void;
  onToggleEnabled?: (name: string, enabled: boolean) => void;
  runtimeStatus?: McpRuntimeStatus[];
  startupStatus?: McpStartupByName;
  onReload?: () => Promise<void>;
}

function getServerTypeInfo(server: MCPServer): { label: string; iconKind: 'wifi' | 'web' | 'disk'; color: string } {
  const type = server.type || 'stdio';
  switch (type) {
    case 'sse':
      return { label: 'SSE', iconKind: 'wifi', color: 'text-primary' };
    case 'http':
      return { label: 'HTTP', iconKind: 'web', color: 'text-status-success-foreground' };
    default:
      return { label: 'stdio', iconKind: 'disk', color: 'text-muted-foreground' };
  }
}

// Status pill in design.md dialect: rounded-full, optional dot, muted
// background tone. Returns null when there's no runtime info to surface.
function getStatusPill(status: McpRuntimeStatus['status']) {
  switch (status) {
    case 'connected':
      return { label: 'Connected', tone: 'bg-status-success-muted text-status-success-foreground', dot: 'bg-status-success-foreground' };
    case 'failed':
      return { label: 'Failed', tone: 'bg-status-error-muted text-status-error-foreground', dot: 'bg-status-error-foreground' };
    case 'needs-auth':
      return { label: 'Auth Required', tone: 'bg-status-warning-muted text-status-warning-foreground', dot: 'bg-status-warning-foreground' };
    case 'pending':
      return { label: 'Pending', tone: 'bg-primary/10 text-primary', dot: 'bg-primary' };
    case 'disabled':
      return { label: 'Disabled', tone: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };
    default:
      return null;
  }
}

export function McpServerList({ servers, onOpenDetail, onToggleEnabled, runtimeStatus, startupStatus, onReload }: McpServerListProps) {
  const { t } = useTranslation();
  const entries = Object.entries(servers);
  const [reconnecting, setReconnecting] = useState<Set<string>>(new Set());

  const handleReconnect = useCallback(async (serverName: string) => {
    if (!onReload) return;
    setReconnecting(prev => new Set(prev).add(serverName));
    try {
      await onReload();
    } catch (err) {
      showToast({
        type: 'error',
        message: `${t('mcp.reconnect' as TranslationKey)} · ${serverName}: ${(err as Error).message}`,
      });
    } finally {
      setReconnecting(prev => {
        const next = new Set(prev);
        next.delete(serverName);
        return next;
      });
    }
  }, [onReload, t]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <CodexWebIcon name="disk" size={40} className="mb-3 opacity-50" aria-hidden />
        <p className="text-sm">{t('mcp.noServers')}</p>
        <p className="text-xs mt-1">
          {t('mcp.noServersDesc')}
        </p>
      </div>
    );
  }

  // Build a lookup for runtime status by server name
  const statusByName = new Map<string, McpRuntimeStatus>();
  if (runtimeStatus) {
    for (const s of runtimeStatus) {
      statusByName.set(s.name, s);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {entries.map(([name, server]) => {
        const typeInfo = getServerTypeInfo(server);
        const runtime = statusByName.get(name);
        const statusPill = runtime ? getStatusPill(runtime.status) : null;
        const isReconnecting = reconnecting.has(name);
        const isDisabled = server.enabled === false;
        const toolCount = runtime?.tools?.length ?? 0;

        const commandLine = server.url
          ? server.url
          : `${server.command} ${server.args?.join(' ') || ''}`;

        return (
          <div
            key={name}
            role="button"
            tabIndex={0}
            onClick={() => onOpenDetail(name, server)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpenDetail(name, server);
              }
            }}
            aria-label={`${name} — ${typeInfo.label}`}
            data-source-breadcrumb={startupStatus?.[name]?.source ?? 'app-server.mcpServerStatus/list'}
            // Same chrome as built-in cards (rounded-lg + soft border + p-5 + hover wash)
            // so the two MCP card families read as one continuous catalogue.
            className={cn(
              "rounded-lg bg-card border border-border/50 p-5 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isDisabled && "opacity-50 hover:bg-card",
            )}
          >
            {/* Identity row: switch + name + inline pills (transport / status / tool count) */}
            <div className="flex items-center gap-2 flex-wrap">
              {onToggleEnabled && (
                <Switch
                  size="sm"
                  checked={!isDisabled}
                  onCheckedChange={(checked) => onToggleEnabled(name, checked)}
                  // Stop propagation so toggling the switch doesn't open
                  // the detail dialog.
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <span className="text-sm font-medium font-mono truncate min-w-0 max-w-full">
                {name}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {typeInfo.iconKind === 'wifi' ? (
                  <WifiHigh size={10} className={typeInfo.color} />
                ) : typeInfo.iconKind === 'web' ? (
                  <CodexWebIcon name="web_simple" size={10} className={typeInfo.color} aria-hidden />
                ) : (
                  <CodexWebIcon name="disk" size={10} className={typeInfo.color} aria-hidden />
                )}
                {typeInfo.label}
              </span>
              {statusPill ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    statusPill.tone,
                  )}
                >
                  <span className={cn("size-1.5 rounded-full", statusPill.dot)} />
                  {statusPill.label}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t('mcp.configured')}
                </span>
              )}
              {toolCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {t('mcp.toolCount' as TranslationKey).replace('{count}', String(toolCount))}
                </span>
              )}
            </div>

            {/* Command / URL — mono, clipped at 2 lines so cards stay aligned. */}
            <p
              className="text-xs font-mono text-muted-foreground mt-2 leading-relaxed line-clamp-2 break-all"
              title={commandLine}
            >
              {commandLine}
            </p>

            {runtime?.serverInfo && (
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {runtime.serverInfo.name} v{runtime.serverInfo.version}
              </p>
            )}
            {runtime?.error && (
              <p className="text-[10px] text-status-error-foreground mt-1.5 break-words">
                {runtime.error}
              </p>
            )}

            {/* Reconnect / Enable — only when runtime status calls for it.
                Edit / Delete moved into the detail dialog (card click). */}
            {(runtime?.status === 'failed' || runtime?.status === 'disabled') && (
              <div className="flex items-center gap-1 mt-3 -mb-1 -mr-1 self-end">
                {runtime?.status === 'failed' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 relative"
                    disabled={isReconnecting}
                    onClick={(e) => { e.stopPropagation(); handleReconnect(name); }}
                    title={t('mcp.reconnectPreviewTooltip' as TranslationKey)}
                    aria-label={`${t('mcp.reconnect' as TranslationKey)} ${name} (${t('common.preview' as TranslationKey)})`}
                  >
                    {isReconnecting ? (
                      <SpinnerGap size={14} className="animate-spin" />
                    ) : (
                      <CodexWebIcon name="refresh" size="sm" aria-hidden />
                    )}
                    <span
                      className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-status-warning"
                      aria-hidden="true"
                    />
                  </Button>
                )}
                {runtime?.status === 'disabled' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={(e) => { e.stopPropagation(); onToggleEnabled?.(name, true); }}
                  >
                    {t('mcp.enable' as TranslationKey)}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
