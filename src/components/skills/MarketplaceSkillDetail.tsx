"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ArrowSquareOut, CheckCircle, SpinnerGap } from "@/components/ui/icon";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { InstallProgressDialog } from "./InstallProgressDialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { MarketplaceSkill } from "@/types";

/**
 * Marketplace skill detail — inline panel rendered inside the
 * MarketplaceBrowser. Replaces the old nested-Dialog pattern (Dialog
 * inside Dialog) with same-dialog navigation: clicking a card swaps
 * the browser body from list-grid to this panel; the back button
 * returns to the list. The marketplace Dialog wrapper stays open
 * throughout — no stacked overlays, no "弹窗叠弹窗".
 *
 * The inner `<InstallProgressDialog>` is intentionally still a
 * Dialog: it's a transient progress indicator (not navigation), and
 * stacking it briefly during install is the standard pattern.
 */

interface MarketplaceSkillDetailProps {
  skill: MarketplaceSkill;
  onBack: () => void;
  onInstallComplete: () => void;
}

export function MarketplaceSkillDetail({
  skill,
  onBack,
  onInstallComplete,
}: MarketplaceSkillDetailProps) {
  const { t } = useTranslation();
  const [showProgress, setShowProgress] = useState(false);
  const [progressAction, setProgressAction] = useState<"install" | "uninstall">("install");
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setReadme(null);
    setReadmeLoading(true);

    const fetchReadme = async () => {
      try {
        const params = new URLSearchParams({
          source: skill.source,
          skillId: skill.skillId,
        });
        const res = await fetch(`/api/skills/marketplace/readme?${params}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setReadme(data.content || null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setReadmeLoading(false);
      }
    };

    fetchReadme();
    return () => { cancelled = true; };
  }, [skill]);

  const handleInstall = () => {
    setProgressAction("install");
    setShowProgress(true);
  };

  const handleUninstall = () => {
    setProgressAction("uninstall");
    setShowProgress(true);
  };

  const githubUrl = skill.source.includes("/")
    ? `https://github.com/${skill.source}`
    : null;

  // Strip YAML front matter from readme for display
  const displayContent = readme
    ? readme.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim()
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-border/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 mb-2 h-7 gap-1.5"
        >
          <CodexWebIcon name="back" size="sm" aria-hidden />
          {t("skills.marketplaceBack" as TranslationKey)}
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-base font-medium break-all">{skill.name}</h3>
          {skill.isInstalled && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0",
                "bg-status-success-muted text-status-success-foreground",
              )}
            >
              <CheckCircle size={10} />
              {t("skills.installed")}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed pt-1 flex items-center gap-2 flex-wrap">
          <span className="font-mono break-all">{skill.source}</span>
          {githubUrl && (
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="GitHub"
            >
              <ArrowSquareOut size={12} />
            </a>
          )}
          {skill.installs > 0 && (
            <span className="flex items-center gap-0.5 shrink-0">
              <CodexWebIcon name="download" size={12} aria-hidden />
              {skill.installs.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <section className="flex-1 min-h-0 px-6 py-4 flex flex-col">
        <h5 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5 shrink-0">
          {t("skills.contentHeading" as TranslationKey)}
        </h5>
        <div className="flex-1 min-h-0 overflow-y-auto rounded-md bg-muted/40 p-4">
          {readmeLoading ? (
            <div className="flex items-center justify-center py-6">
              <SpinnerGap size={18} className="animate-spin text-muted-foreground" />
            </div>
          ) : displayContent ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_code]:break-words [&_a]:break-all [&_img]:max-w-full">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {t("skills.noReadme")}
            </p>
          )}
        </div>
      </section>

      <div className="shrink-0 flex justify-end px-6 py-3 border-t border-border/50">
        {skill.isInstalled ? (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={handleUninstall}
          >
            <CodexWebIcon name="delete" size="sm" aria-hidden />
            {t("skills.uninstall")}
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5" onClick={handleInstall}>
            <CodexWebIcon name="download" size="sm" aria-hidden />
            {t("skills.install")}
          </Button>
        )}
      </div>

      <InstallProgressDialog
        open={showProgress}
        onOpenChange={setShowProgress}
        action={progressAction}
        source={skill.source}
        skillName={skill.name}
        onComplete={onInstallComplete}
      />
    </div>
  );
}
