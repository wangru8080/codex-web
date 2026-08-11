"use client";

/**
 * Skill marketplace — two-view inline navigation (2026-05-02 update).
 *
 * The browser owns a single state slot (`openSkill`): when null, render
 * the search + grid list; when set, render `<MarketplaceSkillDetail>`
 * inline (back button + name + readme + install). The previous version
 * opened the detail as a nested Dialog inside the marketplace Dialog,
 * which stacked overlays ("弹窗叠弹窗") — replaced with same-dialog
 * navigation here.
 *
 * Wrapper Dialog (in `src/app/plugins/page.tsx`) holds a fixed
 * `h-[80vh]` so the dialog itself never changes height when search
 * results shrink/grow or the user navigates between views.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { CheckCircle, SpinnerGap } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { useTranslation } from "@/hooks/useTranslation";
import { MarketplaceSkillDetail } from "./MarketplaceSkillDetail";
import { cn } from "@/lib/utils";
import type { MarketplaceSkill } from "@/types";

interface MarketplaceBrowserProps {
  cwd?: string;
  onInstalled: () => void;
}

export function MarketplaceBrowser({ cwd, onInstalled }: MarketplaceBrowserProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<MarketplaceSkill[]>([]);
  const [openSkill, setOpenSkill] = useState<MarketplaceSkill | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const requestSequence = useRef(0);

  const doSearch = useCallback(async (query: string) => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      params.set("limit", "20");
      const res = await fetch(`/api/skills/marketplace/search?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (requestId !== requestSequence.current) return;
      setResults(data.skills || []);
    } catch (err) {
      if (requestId !== requestSequence.current) return;
      setError((err as Error).message);
      setResults([]);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  // Initial load — fetch popular skills
  useEffect(() => {
    doSearch("");
  }, [doSearch]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, doSearch]);

  const handleInstallComplete = useCallback(() => {
    doSearch(search);
    onInstalled();
    setOpenSkill(null);
  }, [search, doSearch, onInstalled]);

  // Detail view: same dialog, replace body. Back button returns to
  // the list. The wrapper Dialog (h-[80vh]) means the height stays
  // constant during this transition.
  if (openSkill) {
    return (
      <MarketplaceSkillDetail
        skill={openSkill}
        cwd={cwd}
        onBack={() => setOpenSkill(null)}
        onInstallComplete={handleInstallComplete}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search — pinned at top so the input stays put when results
          load / change. Body below it is the only scroll region. */}
      <div className="shrink-0 px-6 pt-4 pb-3">
        <div className="relative max-w-md">
          <CodexWebIcon
            name="search"
            size="sm"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            placeholder={t("skills.marketplaceSearch")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-5">
        {/* States */}
        {loading && results.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-border/50 bg-card p-10 flex flex-col items-center text-center gap-3">
            <p className="text-sm font-medium text-status-error-foreground">
              {t("skills.marketplaceError")}
            </p>
            <p className="text-xs text-muted-foreground max-w-md">{error}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-lg border border-border/50 bg-card p-10 flex flex-col items-center text-center gap-3">
            <CodexWebIcon name="marketplace" size="xl" className="opacity-40 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{t("skills.searchNoResults")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((skill) => (
              <MarketplaceCard
                key={skill.id}
                skill={skill}
                onOpen={() => setOpenSkill(skill)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketplaceCard({
  skill,
  onOpen,
}: {
  skill: MarketplaceSkill;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${skill.name} — ${skill.source}`}
      // Clickable marketplace card — same hover wash as other clickable
      // cards. Non-clickable cards (external MCP servers) stay flat.
      className="rounded-lg bg-card border border-border/50 p-5 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium truncate min-w-0 max-w-full">
          {skill.name}
        </span>
        {skill.isInstalled && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
              "bg-status-success-muted text-status-success-foreground",
            )}
          >
            <CheckCircle size={10} />
            {t("skills.installed")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
        <span className="font-mono truncate min-w-0">{skill.source}</span>
        {skill.installs > 0 && (
          <span className="flex items-center gap-0.5 shrink-0">
            <CodexWebIcon name="download" size={12} aria-hidden />
            {skill.installs.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
