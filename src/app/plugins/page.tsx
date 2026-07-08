"use client";

/**
 * Extensions page (`/plugins`) — Phase 2D.4 P2 round 6 IA refactor
 * (2026-05-02).
 *
 * 双层页头：
 *   第 1 行：只保留 Skills / MCP 两个 Tabs，并展示各自可见数量。
 *   第 2 行：当前 tab 的操作栏，左侧搜索，右侧放当前 tab 的主操作。
 *
 * 页面级标题和描述已移除：这里是左侧导航进入的内页，`nav.plugins`
 * 已经说明当前位置，重复标题和说明会增加噪声。
 *
 * 过滤条件存放在 `window.location.hash`，用于让 Skills/MCP 深链直接
 * 落到对应视图。
 *
 * SkillsManager 的会话上下文（cwd / sessionId）：
 *   1. 优先使用 `usePanel()`，从聊天会话进入时会被填充。
 *   2. 回退到 `/api/chat/sessions[0]`（按 updated_at DESC 排序）。
 *   3. 当这些 props 变化时，SkillsManager 会重新拉取数据。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  MagnifyingGlass,
  Plus,
  Code,
  Storefront,
} from "@/components/ui/icon";
import { CodexWebIcon, type CodexWebIconName } from "@/components/ui/semantic-icon";
import { SkillsManager, type SkillsManagerHandle } from "@/components/skills/SkillsManager";
import { CreateSkillDialog } from "@/components/skills/CreateSkillDialog";
import { MarketplaceBrowser } from "@/components/skills/MarketplaceBrowser";
import { McpManager, type McpManagerHandle } from "@/components/plugins/McpManager";
import type { SkillSource } from "@/components/skills/SkillListItem";
import { McpJsonConfigDialog } from "@/components/plugins/McpJsonConfigDialog";
import { useTranslation } from "@/hooks/useTranslation";
import { useTabFromHash } from "@/hooks/useTabFromHash";
import { usePanel } from "@/hooks/usePanel";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TranslationKey } from "@/i18n";

const PLUGIN_FILTERS = ["skills", "mcp"] as const;
type PluginFilter = (typeof PLUGIN_FILTERS)[number];

interface RecentSessionContext {
  cwd?: string;
  sessionId?: string;
}

const FILTER_META: Record<PluginFilter, { labelKey: TranslationKey; icon: CodexWebIconName }> = {
  skills: { labelKey: "plugins.tab.skills", icon: "skill" },
  mcp: { labelKey: "plugins.tab.mcp", icon: "mcp" },
};

export default function ExtensionsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useTabFromHash<PluginFilter>({
    validTabs: PLUGIN_FILTERS,
    defaultTab: "skills",
  });

  const { workingDirectory, sessionId } = usePanel();
  const panelCwd = workingDirectory || undefined;
  const panelSessionId = sessionId || undefined;

  // 冷启动或刷新时，回退读取最近会话上下文。
  const [fallback, setFallback] = useState<RecentSessionContext>({});
  const needsFallback = !panelCwd || !panelSessionId;
  useEffect(() => {
    if (!needsFallback) return;
    let cancelled = false;
    fetch("/api/chat/sessions")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data) ? data : data.sessions;
        if (!Array.isArray(list) || list.length === 0) return;
        const latest = list[0];
        setFallback({
          cwd: typeof latest?.working_directory === "string" && latest.working_directory ? latest.working_directory : undefined,
          sessionId: typeof latest?.id === "string" && latest.id ? latest.id : undefined,
        });
      })
      .catch(() => { /* best effort */ });
    return () => { cancelled = true; };
  }, [needsFallback]);

  const cwd = panelCwd ?? fallback.cwd;
  const activeSessionId = panelSessionId ?? fallback.sessionId;

  // 搜索按 tab 作用域过滤。切换 tab 时清空搜索词，避免用户因为上一个
  // 列表的查询条件而看到“0 results”。这里按 React 的“props 变化时重置
  // state”模式在 render 期间调整，避免一帧旧搜索词闪烁。
  const [search, setSearch] = useState("");
  const [prevFilter, setPrevFilter] = useState(filter);
  if (filter !== prevFilter) {
    setPrevFilter(filter);
    setSearch("");
  }

  // 每个 tab 的数量由对应 manager 上报。宿主缓存最近一次数量，避免切换
  // tab 时标签短暂回到未知状态。`undefined` 表示尚未知道，标签不渲染数量。
  const [skillsCount, setSkillsCount] = useState<number | undefined>(undefined);
  const [mcpCount, setMcpCount] = useState<number | undefined>(undefined);
  const handleSkillsCounts = (counts: Record<SkillSource, number>) => {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    setSkillsCount(total);
  };
  const filterCounts: Record<PluginFilter, number | undefined> = {
    skills: skillsCount,
    mcp: mcpCount,
  };

  // 操作栏通过 ref 触发各 manager 内部流程，避免 manager 自己再渲染入口按钮。
  const skillsRef = useRef<SkillsManagerHandle>(null);
  const mcpRef = useRef<McpManagerHandle>(null);

  const [createSkillOpen, setCreateSkillOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [jsonConfigOpen, setJsonConfigOpen] = useState(false);

  const handleCreateSkill = async (
    name: string,
    scope: "global" | "project",
    content: string,
  ) => {
    const res = await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content, scope, cwd: cwd || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to create skill");
    }
    skillsRef.current?.refresh();
  };

  // Body picker：单 tab 视图只渲染当前 manager。
  const body = useMemo(() => {
    if (filter === "skills") {
      return (
        <SkillsManager
          ref={skillsRef}
          cwd={cwd}
          sessionId={activeSessionId}
          search={search}
          onCreateSkill={() => setCreateSkillOpen(true)}
          onCountsChange={handleSkillsCounts}
        />
      );
    }
    return <McpManager ref={mcpRef} variant="embedded" onCountChange={setMcpCount} search={search} />;
  }, [filter, cwd, activeSessionId, search]);

  return (
    <div className="flex h-full flex-col">
      {/* 双层页头：第 1 行是 Tabs，第 2 行是当前 tab 的搜索和主操作。 */}
      <header className="shrink-0 px-6 pt-4 pb-3 space-y-3">
        {/* 第 1 行：只使用 Tabs 根节点和触发器，主体根据 `filter` 单独渲染。 */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as PluginFilter)}>
          <TabsList>
            {PLUGIN_FILTERS.map((key) => {
              const meta = FILTER_META[key];
              const count = filterCounts[key];
              return (
                <TabsTrigger key={key} value={key}>
                  <CodexWebIcon name={meta.icon} size="md" className="text-inherit" aria-hidden />
                  {t(meta.labelKey)}
                  {typeof count === "number" && (
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {/* 第 2 行：左侧搜索，右侧主操作，窄屏时允许换行。 */}
        <CurrentTabToolbar
          filter={filter}
          search={search}
          onSearchChange={setSearch}
          onNewSkill={() => setCreateSkillOpen(true)}
          onOpenMarketplace={() => setMarketplaceOpen(true)}
          onAddMcp={() => mcpRef.current?.addServer()}
          onOpenMcpJson={() => setJsonConfigOpen(true)}
        />
      </header>

      {/* Body — single scroll container shared across filters */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{body}</div>

      <CreateSkillDialog
        open={createSkillOpen}
        onOpenChange={setCreateSkillOpen}
        onCreate={handleCreateSkill}
      />

      <MarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        onInstalled={() => skillsRef.current?.refresh()}
      />

      <McpJsonConfigDialog
        open={jsonConfigOpen}
        onOpenChange={setJsonConfigOpen}
        onSaved={() => mcpRef.current?.refresh()}
      />
    </div>
  );
}

/**
 * 当前 tab 的操作栏：搜索框填充左侧空间，操作按钮靠右，窄屏时按钮换行。
 */
function CurrentTabToolbar({
  filter,
  search,
  onSearchChange,
  onNewSkill,
  onOpenMarketplace,
  onAddMcp,
  onOpenMcpJson,
}: {
  filter: PluginFilter;
  search: string;
  onSearchChange: (value: string) => void;
  onNewSkill: () => void;
  onOpenMarketplace: () => void;
  onAddMcp: () => void;
  onOpenMcpJson: () => void;
}) {
  const { t } = useTranslation();

  const placeholderKey: TranslationKey =
    filter === "skills" ? "plugins.search.placeholder.skills" : "plugins.search.placeholder.mcp";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative flex-1 min-w-[180px] max-w-md">
        <MagnifyingGlass
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
        <Input
          placeholder={t(placeholderKey)}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9 h-8 text-sm"
        />
      </div>

      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        {filter === "skills" && (
          <>
            <Button size="sm" className="h-8 gap-1.5" onClick={onNewSkill}>
              <Plus size={14} />
              {t("plugins.create.newSkill" as TranslationKey)}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenMarketplace}>
              <Storefront size={14} />
              {t("skills.marketplace" as TranslationKey)}
            </Button>
          </>
        )}
        {filter === "mcp" && (
          <>
            <Button size="sm" className="h-8 gap-1.5" onClick={onAddMcp}>
              <Plus size={14} />
              {t("plugins.create.addMcp" as TranslationKey)}
            </Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onOpenMcpJson}>
              <Code size={14} />
              {t("plugins.more.mcpJson" as TranslationKey)}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function MarketplaceDialog({
  open,
  onOpenChange,
  onInstalled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstalled: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height (h-[80vh]) so the dialog never resizes when the
          search list shrinks/grows or the user navigates into a skill
          detail. The wrapper title stays visible across both views;
          the back button inside the detail panel returns to list. */}
      <DialogContent className="sm:max-w-3xl h-[80vh] flex flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="text-base font-medium">
            {t("skills.marketplace" as TranslationKey)}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("skills.marketplaceDescription" as TranslationKey)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MarketplaceBrowser onInstalled={onInstalled} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
