"use client";

import { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { List, SpinnerGap } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { McpServerList, type McpRuntimeStatus } from "@/components/plugins/McpServerList";
import { McpServerEditor } from "@/components/plugins/McpServerEditor";
import { McpServerDetailDialog } from "@/components/plugins/McpServerDetailDialog";
import { ConfigEditor } from "@/components/plugins/ConfigEditor";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { MCPServer } from "@/types";
import { useAppServerActions, useAppServerSelector } from "@/codex-web/AppServerProvider";
import { mcpServersFromConfig, mcpServersFromConfigValue, mcpServersToConfigValue } from "@/codex-web/mcp-config-adapter";
import type { McpServerStatus } from "@/codex/protocol/generated/v2/McpServerStatus";

type MCPServerWithSource = MCPServer & { _source?: string };

interface McpManagerProps {
  /**
   * `standalone` (default) renders the full page chrome — title /
   * description / add button / list+json tabs / runtime-status section.
   * Used by the legacy `/mcp` redirect surface (kept for one cycle).
   *
   * `embedded` strips the page-level chrome and renders only the
   * installed-server grid + runtime status. The
   * unified `/plugins` ExtensionsPage owns the surrounding layout
   * (title, search, create dropdown, more-menu) and triggers add /
   * JSON editing through the imperative ref.
   */
  variant?: "standalone" | "embedded";
  /**
   * Reports the configured MCP server count to the host page so the
   * unified filter pill can display "MCP (N)".
   */
  onCountChange?: (count: number) => void;
  /**
   * Free-text filter from the unified ExtensionsPage search box.
   * Filters the user-installed server list by name + command/url.
   * Empty string = show everything.
   */
  search?: string;
}

export interface McpManagerHandle {
  /** Open the editor in add-server mode (used by ExtensionsPage's create dropdown). */
  addServer: () => void;
  /** Re-fetch the server list — called after McpJsonConfigDialog saves so the
   *  installed grid + count pill reflect external edits without a tab switch. */
  refresh: () => Promise<void>;
}

export const McpManager = forwardRef<McpManagerHandle, McpManagerProps>(function McpManager(
  { variant = "standalone", onCountChange, search = "" },
  ref,
) {
  const { t } = useTranslation();
  const { refreshConfig, writeMcpServers, listMcpServerStatus, reloadMcpServers } = useAppServerActions();
  const connectionData = useAppServerSelector((state) => state.connection.data);
  const mcpStartupByName = useAppServerSelector((state) => state.mcpStartupByName);
  const [servers, setServers] = useState<Record<string, MCPServerWithSource>>({});
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | undefined>();
  const [editingServer, setEditingServer] = useState<MCPServer | undefined>();
  const [tab, setTab] = useState<"list" | "json">("list");
  const [error, setError] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<McpRuntimeStatus[]>([]);
  const [runtimeLoading, setRuntimeLoading] = useState(false);

  // Detail dialog (card click) — shared by built-in cards (read-only)
  // and user-installed cards (read + edit + delete in same dialog).
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailName, setDetailName] = useState<string | null>(null);
  const [detailServer, setDetailServer] = useState<MCPServer | null>(null);
  // Reflect the JSON-tab PUT in flight so the ConfigEditor SaveButton
  // can render the saving state instead of silently letting users
  // double-click and fire multiple requests.
  const [jsonSaving, setJsonSaving] = useState(false);

  function handleOpenDetail(name: string, server: MCPServer) {
    setDetailName(name);
    setDetailServer(server);
    setDetailOpen(true);
  }

  const fetchServers = useCallback(async () => {
    try {
      setError(null);
      const config = await refreshConfig();
      setServers(mcpServersFromConfig(config));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshConfig]);

  const fetchRuntimeStatus = useCallback(async () => {
    setRuntimeLoading(true);
    try {
      const inventory = await listMcpServerStatus({ detail: "full", limit: 100 });
      setRuntimeStatus(inventory.map(mcpRuntimeStatusFromInventory));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeLoading(false);
    }
  }, [listMcpServerStatus]);

  useEffect(() => {
    if (connectionData !== "connected") return;
    void fetchServers();
    void fetchRuntimeStatus();
  }, [connectionData, fetchServers, fetchRuntimeStatus]);

  const handleReload = useCallback(async () => {
    await reloadMcpServers();
    await Promise.all([fetchServers(), fetchRuntimeStatus()]);
  }, [fetchRuntimeStatus, fetchServers, reloadMcpServers]);

  const effectiveRuntimeStatus = useMemo(() => {
    const inventory = new Map(runtimeStatus.map((status) => [status.name, status]));
    return Object.entries(servers).map(([name, server]) => {
      const current = inventory.get(name);
      const startup = mcpStartupByName[name]?.data;
      if (server.enabled === false) return { name, status: "disabled" as const };
      if (startup?.status === "failed" || startup?.status === "cancelled") {
        return { ...current, name, status: "failed" as const, error: startup.error || startup.status };
      }
      if (startup?.status === "starting") return { ...current, name, status: "pending" as const };
      return current ?? { name, status: "pending" as const };
    });
  }, [mcpStartupByName, runtimeStatus, servers]);

  // Add-server flow: open the standalone editor Dialog. Edit flow no
  // longer routes through here — clicking a card opens the detail
  // dialog which has its own in-place edit view (see handleOpenDetail
  // above and McpServerDetailDialog).
  function handleAdd() {
    setEditingName(undefined);
    setEditingServer(undefined);
    setEditorOpen(true);
  }

  // Save handler used by BOTH the add Editor (toolbar entry) and the
  // detail-dialog edit view (card click). When the latter calls in,
  // `editingName` is undefined — we infer the rename path from the
  // current servers map instead.
  const persistSave = useCallback(async (originalName: string | undefined, name: string, server: MCPServer) => {
    const updated: Record<string, MCPServerWithSource> = { ...servers };
    if (originalName && originalName !== name) delete updated[originalName];
    updated[name] = server;
    try {
      await writeMcpServers(updated);
      setServers(updated);
      await fetchRuntimeStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [servers, writeMcpServers, fetchRuntimeStatus]);

  const handlePersistentToggle = useCallback(async (name: string, enabled: boolean) => {
    const updated = { ...servers };
    updated[name] = { ...updated[name], enabled };
    setServers(updated);
    try {
      await writeMcpServers(updated);
      await fetchRuntimeStatus();
    } catch (err) {
      console.error('Failed to toggle MCP server:', err);
      // Revert on failure
      fetchServers();
    }
  }, [servers, fetchServers, fetchRuntimeStatus, writeMcpServers]);

  async function handleDelete(name: string) {
    try {
      const updated = { ...servers };
      delete updated[name];
      await writeMcpServers(updated);
      setServers(updated);
    } catch (err) {
      console.error("Failed to delete MCP server:", err);
    }
  }

  // Editor Dialog (toolbar add) save handler — bridges to persistSave
  // with `editingName` as the "original" key so rename works the same
  // way it always did. Add-mode passes editingName=undefined.
  async function handleAddEditorSave(name: string, server: MCPServer) {
    await persistSave(editingName, name, server);
  }

  async function handleJsonSave(jsonStr: string) {
    setJsonSaving(true);
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const next = mcpServersFromConfigValue(parsed);
      await writeMcpServers(next);
      setServers(next);
      await fetchRuntimeStatus();
    } catch (err) {
      console.error("Failed to save MCP config:", err);
    } finally {
      setJsonSaving(false);
    }
  }

  const serverCount = Object.keys(servers).length;

  // Report only user-configured MCP servers. Built-in capabilities are
  // hidden in the Codex-only Web UI, so an empty config shows MCP (0).
  useEffect(() => {
    if (loading) return;
    onCountChange?.(serverCount);
  }, [serverCount, loading, onCountChange]);

  // Imperative API for ExtensionsPage's create dropdown + JSON dialog
  // post-save refresh. Exposed via forwardRef so the parent can trigger
  // add-server / re-fetch the server list without us rendering our own
  // page chrome.
  useImperativeHandle(
    ref,
    () => ({
      addServer: () => handleAdd(),
      refresh: fetchServers,
    }),
    [fetchServers],
  );

  const isEmbedded = variant === "embedded";

  // Filter user-installed servers by search (name + command/url) so the
  // ExtensionsPage search box scopes to the MCP tab data. Runtime status
  // is intentionally not filtered — it's a debugging surface, not part
  // of the "browse" list.
  const query = search.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!query) return servers;
    const out: Record<string, MCPServerWithSource> = {};
    for (const [name, server] of Object.entries(servers)) {
      if (name.toLowerCase().includes(query)) { out[name] = server; continue; }
      const command = (server as { command?: string }).command;
      const url = (server as { url?: string }).url;
      if ((command && command.toLowerCase().includes(query)) ||
          (url && url.toLowerCase().includes(query))) {
        out[name] = server;
      }
    }
    return out;
  }, [servers, query]);
  const filteredServerCount = Object.keys(filteredServers).length;

  // Body shared by both variants — installed list + runtime status.
  // Kept in a named const so the standalone branch can wrap it in the
  // legacy List/JSON Tabs without duplication.
  const bodyContent = useMemo(
    () => (
      <>
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 mb-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {query && !loading && filteredServerCount === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t('plugins.search.noResults' as TranslationKey)}
          </p>
        )}

        {/* Hide the 已安装 section entirely when a search filters
            everything out — otherwise an empty header sits above the
            runtime status block and reads as broken. */}
        {(filteredServerCount > 0 || (!query && !loading)) && (
          <>
            <header className="mb-3">
              <div className="flex items-center gap-2">
                <CodexWebIcon name="disk" size="sm" className="text-muted-foreground" aria-hidden />
                <h4 className="text-sm font-medium">
                  {t('mcp.installed.sectionTitle' as TranslationKey)}
                </h4>
                <span className="text-xs text-muted-foreground">
                  ({filteredServerCount}
                  {query && filteredServerCount !== serverCount ? ` / ${serverCount}` : ""}
                  )
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                {t('mcp.installed.sectionDescription' as TranslationKey)}
              </p>
            </header>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                <SpinnerGap size={16} className="animate-spin" />
                <p className="text-sm">{t('mcp.loadingServers')}</p>
              </div>
            ) : (
              <McpServerList
                servers={filteredServers}
                onOpenDetail={handleOpenDetail}
                onToggleEnabled={handlePersistentToggle}
                runtimeStatus={effectiveRuntimeStatus}
                startupStatus={mcpStartupByName}
                onReload={handleReload}
              />
            )}
          </>
        )}

        {/* Runtime status: live SDK runtime view of external servers. */}
        <div className="mt-8">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <CodexWebIcon name="mcp" size="md" className="text-muted-foreground" aria-hidden />
              <h4 className="text-sm font-medium">{t('mcp.runtimeStatus' as TranslationKey)}</h4>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={fetchRuntimeStatus}
              disabled={runtimeLoading}
            >
              {runtimeLoading ? <SpinnerGap size={12} className="animate-spin" /> : <CodexWebIcon name="refresh" size={12} aria-hidden />}
              {t('mcp.refresh' as TranslationKey)}
            </Button>
          </div>

          {effectiveRuntimeStatus.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {t('mcp.noRuntimeStatus' as TranslationKey)}
            </p>
          ) : (
            <div className="space-y-1.5">
              {effectiveRuntimeStatus.map((s) => (
                <div key={s.name} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${
                      s.status === 'connected' ? 'bg-status-success' :
                      s.status === 'failed' ? 'bg-status-error' :
                      s.status === 'pending' ? 'bg-primary' :
                      s.status === 'disabled' ? 'bg-gray-400' :
                      'bg-status-warning'
                    }`} />
                    <span className="text-xs font-medium truncate">{s.name}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {s.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    ),
    // Re-render whenever any of the surfaces below change. We intentionally
    // skip `t` (locale-pinned) and the handler refs (stable enough).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [error, filteredServers, loading, effectiveRuntimeStatus, runtimeLoading, serverCount, filteredServerCount, search, query, mcpStartupByName, handleReload],
  );

  if (isEmbedded) {
    // No header / no list-vs-json tabs / no add button — ExtensionsPage owns those.
    return (
      <>
        {bodyContent}
        <McpServerEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          name={editingName}
          server={editingServer}
          onSave={handleAddEditorSave}
        />
        <McpServerDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          name={detailName}
          server={detailServer}
          runtime={detailName ? effectiveRuntimeStatus.find((s) => s.name === detailName) ?? null : null}
          onSave={(name, server) => persistSave(name, name, server)}
          onDelete={handleDelete}
          onToggleEnabled={handlePersistentToggle}
        />
      </>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Fixed header */}
      <div className="shrink-0 px-6 pt-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {t('extensions.mcpServers')}
              {serverCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({serverCount})
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('mcp.managerDesc' as TranslationKey)}
            </p>
          </div>
          <Button size="sm" className="gap-1" onClick={handleAdd}>
            <CodexWebIcon name="plus" size="sm" aria-hidden />
            {t('mcp.addServer')}
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-6">

      <Tabs value={tab} onValueChange={(v) => setTab(v as "list" | "json")}>
        <TabsList>
          <TabsTrigger value="list" className="gap-1.5">
            <List size={14} />
            {t('mcp.listTab')}
          </TabsTrigger>
          <TabsTrigger value="json" className="gap-1.5">
            <CodexWebIcon name="code" size="sm" aria-hidden />
            {t('mcp.jsonTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          {/* User-installed servers — same Settings card chrome and
              two-col grid as the built-in section above, with a header
              that mirrors the same name + count layout. */}
          <header className="mb-3">
            <div className="flex items-center gap-2">
              <CodexWebIcon name="disk" size="sm" className="text-muted-foreground" aria-hidden />
              <h4 className="text-sm font-medium">
                {t('mcp.installed.sectionTitle' as TranslationKey)}
              </h4>
              <span className="text-xs text-muted-foreground">
                ({serverCount})
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              {t('mcp.installed.sectionDescription' as TranslationKey)}
            </p>
          </header>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
              <SpinnerGap size={16} className="animate-spin" />
              <p className="text-sm">{t('mcp.loadingServers')}</p>
            </div>
          ) : (
            <McpServerList
              servers={servers}
              onOpenDetail={handleOpenDetail}
              onToggleEnabled={handlePersistentToggle}
              runtimeStatus={effectiveRuntimeStatus}
              startupStatus={mcpStartupByName}
              onReload={handleReload}
            />
          )}
        </TabsContent>

        <TabsContent value="json" className="mt-4">
          {Object.values(servers).some(s => s._source === 'claude.json') && (
            <p className="text-xs text-muted-foreground mb-2">
              Servers from ~/.claude.json are managed by Claude CLI and not shown here.
              Use the list tab to edit or delete them.
            </p>
          )}
          <ConfigEditor
            value={JSON.stringify(mcpServersToConfigValue(servers), null, 2)}
            onSave={handleJsonSave}
            saving={jsonSaving}
            label={t('mcp.serverConfig')}
          />
        </TabsContent>
      </Tabs>

      {/* Runtime Status Section */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CodexWebIcon name="mcp" size="md" className="text-muted-foreground" aria-hidden />
            <h4 className="text-sm font-medium">{t('mcp.runtimeStatus' as TranslationKey)}</h4>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={fetchRuntimeStatus}
            disabled={runtimeLoading}
          >
            {runtimeLoading ? <SpinnerGap size={12} className="animate-spin" /> : <CodexWebIcon name="refresh" size={12} aria-hidden />}
            {t('mcp.refresh' as TranslationKey)}
          </Button>
        </div>

        {effectiveRuntimeStatus.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            {t('mcp.noRuntimeStatus' as TranslationKey)}
          </p>
        ) : (
          <div className="space-y-1.5">
            {effectiveRuntimeStatus.map((s) => (
              <div key={s.name} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${
                    s.status === 'connected' ? 'bg-status-success' :
                    s.status === 'failed' ? 'bg-status-error' :
                    s.status === 'pending' ? 'bg-primary' :
                    s.status === 'disabled' ? 'bg-gray-400' :
                    'bg-status-warning'
                  }`} />
                  <span className="text-xs font-medium truncate">{s.name}</span>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {s.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      <McpServerEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        name={editingName}
        server={editingServer}
        onSave={handleAddEditorSave}
      />
      <McpServerDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        name={detailName}
        server={detailServer}
        runtime={detailName ? effectiveRuntimeStatus.find((s) => s.name === detailName) ?? null : null}
        onSave={(name, server) => persistSave(name, name, server)}
        onDelete={handleDelete}
        onToggleEnabled={handlePersistentToggle}
      />
      </div>
    </div>
  );
});

function mcpRuntimeStatusFromInventory(server: McpServerStatus): McpRuntimeStatus {
  return {
    name: server.name,
    status: server.serverInfo
      ? "connected"
      : server.authStatus === "notLoggedIn"
        ? "needs-auth"
        : "pending",
    serverInfo: server.serverInfo
      ? { name: server.serverInfo.name, version: server.serverInfo.version }
      : undefined,
    tools: Object.values(server.tools).filter((tool): tool is NonNullable<typeof tool> => !!tool).map((tool) => ({
      name: tool.name,
      description: tool.description ?? undefined,
    })),
    authStatus: server.authStatus,
    resourceCount: server.resources.length,
    resourceTemplateCount: server.resourceTemplates.length,
  };
}
