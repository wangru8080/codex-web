"use client";

/**
 * Skills manager — embeddable into the ExtensionsPage.
 *
 * Phase 2D.4 P2 (2026-05-01) restructure: this component no longer owns
 * its own page chrome (title / description / segmented control / search
 * box / Create button). The unified `/plugins` shell renders all of
 * those and pushes data in via props. SkillsManager focuses purely on
 * grouped card rendering + detail dialog + delete.
 *
 * - Each source group (global / project / installed / plugin / sdk)
 *   renders as a heading + count, followed by a 2-col card grid.
 * - Cards use the canonical Settings chrome from `docs/design.md`
 *   (`rounded-lg bg-card border border-border/50 p-5`, no shadow).
 * - Click → `<SkillDetailDialog>` shows description + read-only
 *   markdown body + Delete (when editable).
 *
 * Marketplace browsing was moved out of this component into a dialog
 * triggered from the ExtensionsPage Create dropdown — keeping the body
 * a single grid surface instead of a nested tab-in-tab layout.
 */

import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Plus, SpinnerGap, Lock } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { SkillDetailDialog } from "./SkillDetailDialog";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SkillItem, SkillSource } from "./SkillListItem";
import type { SkillMetadata } from "@/codex/protocol/generated/v2/SkillMetadata";
import { useAppServerActions, useAppServerState } from "@/codex-web/AppServerProvider";
import { useRouter } from "next/navigation";

interface SkillsManagerProps {
  /**
   * Active workspace directory used to scan project-level skills and to
   * compute editability. ExtensionsPage resolves this from PanelContext
   * (or the recent-session fallback) and passes it down.
   */
  cwd?: string;
  /**
   * Active chat session id, used to resolve providerId for the SDK
   * commands cache. Falls back to 'env' on the server when omitted.
   */
  sessionId?: string;
  /**
   * Free-text filter from the parent's search input. Empty string =
   * show everything.
   */
  search?: string;
  /**
   * Notification when the parent should re-render anything that depends
   * on group counts (e.g. the global filter pill labels). Optional.
   */
  onCountsChange?: (counts: Record<SkillSource, number>) => void;
  /**
   * Optional handler for the "create new skill" action. When omitted
   * the empty-state still falls back to a no-op.
   */
  onCreateSkill?: () => void;
}

/** Imperative API the parent uses to refresh the list after an external
 *  action (CreateSkillDialog success, Marketplace install). */
export interface SkillsManagerHandle {
  refresh: () => Promise<void>;
}

export const SkillsManager = forwardRef<SkillsManagerHandle, SkillsManagerProps>(function SkillsManager(
  { cwd, sessionId, search = "", onCountsChange, onCreateSkill },
  ref,
) {
  const { t } = useTranslation();
  const router = useRouter();
  const { listSkills, setSkillEnabled, readFile, removeFileTree } = useAppServerActions();
  const { skillsRevision, connection } = useAppServerState();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [openSkill, setOpenSkill] = useState<SkillItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const response = await listSkills({
        ...(cwd ? { cwds: [cwd] } : {}),
        forceReload: true,
      });
      const byPath = new Map<string, SkillItem>();
      for (const entry of response.data) {
        for (const skill of entry.skills) byPath.set(skill.path, skillItemFromMetadata(skill));
      }
      setSkills([...byPath.values()]);
    } catch (fetchError) {
      setSkills([]);
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }, [cwd, listSkills]);

  useEffect(() => {
    if (connection.data !== "connected") return;
    void fetchSkills();
  }, [connection.data, fetchSkills, skillsRevision]);

  useImperativeHandle(ref, () => ({ refresh: fetchSkills }), [fetchSkills]);

  const handleDelete = useCallback(
    async (skill: SkillItem) => {
      if (skill.scope !== "user" && skill.scope !== "repo") return;
      const skillDirectory = skill.filePath.replace(/[\\/]SKILL\.md$/i, "");
      await removeFileTree(skillDirectory);
      setOpenSkill(null);
      await fetchSkills();
    },
    [fetchSkills, removeFileTree],
  );

  const handleToggle = useCallback(async (skill: SkillItem, enabled: boolean) => {
    setSkills((current) => current.map((item) =>
      item.filePath === skill.filePath ? { ...item, enabled } : item
    ));
    setOpenSkill((current) => current?.filePath === skill.filePath ? { ...current, enabled } : current);
    try {
      await setSkillEnabled({ path: skill.filePath, name: null, enabled });
      await fetchSkills();
    } catch {
      await fetchSkills();
    }
  }, [fetchSkills, setSkillEnabled]);

  const handleOpen = useCallback(async (skill: SkillItem) => {
    setOpenSkill(skill);
    try {
      const response = await readFile(skill.filePath);
      const content = decodeBase64Utf8(response.dataBase64);
      setOpenSkill((current) => current?.filePath === skill.filePath ? { ...current, content } : current);
    } catch {
      // 详情仍展示 metadata，正文读取错误由空状态收口。
    }
  }, [readFile]);

  const handleTry = useCallback((skill: SkillItem) => {
    const params = new URLSearchParams({
      skill: skill.name,
      skillPath: skill.filePath,
      skillLabel: skill.displayName || skill.name,
      skillDescription: skill.shortDescription || skill.description,
    });
    router.push(`/chat?${params.toString()}`);
  }, [router]);

  const filtered = search
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase()),
      )
    : skills;

  // Picker source order: global → project → installed → plugin → sdk.
  const groups: Array<{
    source: SkillSource;
    labelKey: TranslationKey;
    items: SkillItem[];
  }> = [
    { source: "global", labelKey: "skills.source.global", items: filtered.filter((s) => s.source === "global") },
    { source: "project", labelKey: "skills.source.project", items: filtered.filter((s) => s.source === "project") },
    { source: "installed", labelKey: "skills.source.installed", items: filtered.filter((s) => s.source === "installed") },
    { source: "plugin", labelKey: "skills.source.plugin", items: filtered.filter((s) => s.source === "plugin") },
    { source: "sdk", labelKey: "skills.source.sdk", items: filtered.filter((s) => s.source === "sdk") },
  ];

  // Counts include filtered set (so the parent's filter pill matches
  // what the body renders). Suppress while still loading so a cold
  // visit to /plugins#cli doesn't briefly mount Skills with skills=[],
  // ship a 0-count to the host, and freeze "Skills 0" on the pill
  // until the user actually visits Skills (Phase 2D.4 P2 round 2,
  // 2026-05-02).
  useEffect(() => {
    if (!onCountsChange || loading) return;
    const next = {
      global: groups[0].items.length,
      project: groups[1].items.length,
      installed: groups[2].items.length,
      plugin: groups[3].items.length,
      sdk: groups[4].items.length,
    };
    onCountsChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, loading]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          {t("skills.loadingSkills")}
        </span>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="space-y-4">
        {error && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!error && (
          <SkillsEmptyState
            onCreate={onCreateSkill}
            hasSearch={!!search}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-8">
        {groups.map((group) =>
          group.items.length === 0 ? null : (
            <section key={group.source}>
              <header className="mb-3">
                <h4 className="text-sm font-medium">
                  {t(group.labelKey)}
                  <span className="text-xs text-muted-foreground ml-2">
                    ({group.items.length})
                  </span>
                </h4>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {group.items.map((skill) => (
                  <SkillCard
                    key={skill.filePath || `${skill.source}:${skill.installedSource ?? "default"}:${skill.name}`}
                    skill={skill}
                    onOpen={() => void handleOpen(skill)}
                    onToggle={(enabled) => void handleToggle(skill, enabled)}
                  />
                ))}
              </div>
            </section>
          ),
        )}
      </div>

      <SkillDetailDialog
        skill={openSkill}
        onClose={() => setOpenSkill(null)}
        onDelete={handleDelete}
        onToggle={(skill, enabled) => void handleToggle(skill, enabled)}
        onTry={handleTry}
      />
    </>
  );
});

function SkillCard({
  skill,
  onOpen,
  onToggle,
}: {
  skill: SkillItem;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const editable = skill.editable !== false;
  const readOnlyReasonKey: TranslationKey | null =
    skill.readOnlyReason === "sdk"
      ? "skills.readOnlyReason.sdk"
      : skill.readOnlyReason === "file_not_writable"
        ? "skills.readOnlyReason.fileNotWritable"
        : skill.readOnlyReason === "out_of_cwd"
          ? "skills.readOnlyReason.outOfCwd"
          : null;

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
      aria-label={`/${skill.name} — ${skill.description}`}
      data-source-breadcrumb="app-server.skills/list"
      className="rounded-lg bg-card border border-border/50 p-5 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-3">
        <SkillIcon skill={skill} />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium truncate block">
            {skill.displayName || skill.name}
          </span>
        {!editable && readOnlyReasonKey && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            title={t(readOnlyReasonKey)}
          >
            <Lock size={10} />
            {t(readOnlyReasonKey)}
          </span>
        )}
          {(skill.shortDescription || skill.description) && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
              {skill.shortDescription || skill.description}
            </p>
          )}
        </div>
        <Switch
          checked={skill.enabled !== false}
          onCheckedChange={onToggle}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${skill.enabled === false ? t('skills.enable') : t('skills.disable')} ${skill.displayName || skill.name}`}
        />
      </div>
    </div>
  );
}

function SkillIcon({ skill }: { skill: SkillItem }) {
  const { readFile } = useAppServerActions();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!skill.iconSmall) return;
    let cancelled = false;
    readFile(skill.iconSmall).then((response) => {
      if (cancelled) return;
      setSrc(`data:${mimeTypeForPath(skill.iconSmall!)};base64,${response.dataBase64}`);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [readFile, skill.iconSmall]);

  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted/60">
      {src ? <img src={src} alt="" className="size-8 object-contain" /> : <CodexWebIcon name="skill" size="lg" className="text-primary" aria-hidden />}
    </div>
  );
}

function skillItemFromMetadata(skill: SkillMetadata): SkillItem {
  const source: SkillSource = skill.scope === "user"
    ? "global"
    : skill.scope === "repo"
      ? "project"
      : "sdk";
  return {
    name: skill.name,
    description: skill.description,
    shortDescription: skill.interface?.shortDescription || skill.shortDescription,
    displayName: skill.interface?.displayName || skill.name,
    content: "",
    source,
    filePath: skill.path,
    editable: skill.scope === "user" || skill.scope === "repo",
    readOnlyReason: skill.scope === "system" || skill.scope === "admin" ? "sdk" : undefined,
    enabled: skill.enabled,
    scope: skill.scope,
    iconSmall: skill.interface?.iconSmall,
    iconLarge: skill.interface?.iconLarge,
    brandColor: skill.interface?.brandColor,
    defaultPrompt: skill.interface?.defaultPrompt,
  };
}

function decodeBase64Utf8(value: string): string {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function SkillsEmptyState({
  onCreate,
  hasSearch,
}: {
  onCreate?: () => void;
  hasSearch: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/50 bg-card p-10 flex flex-col items-center text-center gap-3">
      <CodexWebIcon name="skill" size="xl" className="opacity-40 text-muted-foreground" />
      <div className="text-sm font-medium">{t("skills.noSkillsFound")}</div>
      {!hasSearch && onCreate && (
        <Button variant="default" size="sm" className="gap-1.5 mt-1" onClick={onCreate}>
          <Plus size={14} weight="bold" />
          {t("skills.newSkill")}
        </Button>
      )}
    </div>
  );
}
