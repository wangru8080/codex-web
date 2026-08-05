"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { HookEventName } from "@/codex/protocol/generated/v2/HookEventName";
import type { HookMetadata } from "@/codex/protocol/generated/v2/HookMetadata";
import type { HookSource } from "@/codex/protocol/generated/v2/HookSource";
import type { HooksListEntry } from "@/codex/protocol/generated/v2/HooksListEntry";
import { useAppServerActions, useAppServerSelector } from "@/codex-web/AppServerProvider";
import { utf8FromBase64, utf8ToBase64 } from "@/codex-web/app-server-files";
import { buildHookEnabledEdit, buildHookTrustEdit, hookNeedsReview } from "@/codex-web/hooks-config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { CaretDown, CaretRight } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { cn } from "@/lib/utils";

const HOOKS_DOCS_URL = "https://learn.chatgpt.com/docs/hooks";

const EVENT_LABELS: Record<HookEventName, string> = {
  preToolUse: "PreToolUse",
  permissionRequest: "PermissionRequest",
  postToolUse: "PostToolUse",
  preCompact: "PreCompact",
  postCompact: "PostCompact",
  sessionStart: "SessionStart",
  userPromptSubmit: "UserPromptSubmit",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  stop: "Stop",
};

function sourceKey(source: HookSource): "user" | "project" | "plugin" | "managed" {
  if (source === "user") return "user";
  if (source === "project") return "project";
  if (source === "plugin") return "plugin";
  return "managed";
}

export function HooksSection() {
  const { t } = useTranslation();
  const connection = useAppServerSelector((state) => state.connection.data);
  const appServer = useAppServerActions();
  const [entry, setEntry] = useState<HooksListEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewSource, setReviewSource] = useState<ReturnType<typeof sourceKey> | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (connection !== "connected") return null;
    setLoading(true);
    setError(null);
    try {
      const response = await appServer.listHooks({});
      const next = response.data[0] ?? { cwd: "", hooks: [], warnings: [], errors: [] };
      setEntry(next);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.hooksLoadError"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [appServer, connection, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => {
    const result = new Map<ReturnType<typeof sourceKey>, HookMetadata[]>();
    for (const hook of entry?.hooks ?? []) {
      const key = sourceKey(hook.source);
      result.set(key, [...(result.get(key) ?? []), hook]);
    }
    return [...result.entries()];
  }, [entry]);

  const reviewHooks = reviewSource
    ? groups.find(([key]) => key === reviewSource)?.[1] ?? []
    : [];

  const sourceLabel = useCallback((source: ReturnType<typeof sourceKey>) => {
    const key = source === "user"
      ? "settings.hooksUserConfig"
      : source === "project"
        ? "settings.hooksProjectConfig"
        : source === "plugin"
          ? "settings.hooksPluginConfig"
          : "settings.hooksManagedConfig";
    return t(key as TranslationKey);
  }, [t]);

  const trust = useCallback(async (hooks: HookMetadata[]) => {
    const pending = hooks.filter(hookNeedsReview);
    if (pending.length === 0) return;
    setBusyKey("trust");
    setError(null);
    try {
      await appServer.writeConfigEdits([buildHookTrustEdit(pending)]);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.hooksSaveError"));
    } finally {
      setBusyKey(null);
    }
  }, [appServer, reload, t]);

  const toggle = useCallback(async (hook: HookMetadata, enabled: boolean) => {
    setBusyKey(hook.key);
    setError(null);
    try {
      await appServer.writeConfigEdits([buildHookEnabledEdit(hook.key, enabled)]);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.hooksSaveError"));
    } finally {
      setBusyKey(null);
    }
  }, [appServer, reload, t]);

  const openEditor = useCallback(async (path: string) => {
    setReviewSource(null);
    setEditorPath(path);
    setEditorDraft("");
    setEditorError(null);
    setEditorLoading(true);
    try {
      const response = await appServer.readFile(path);
      setEditorDraft(utf8FromBase64(response.dataBase64));
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : t("settings.hooksLoadError"));
    } finally {
      setEditorLoading(false);
    }
  }, [appServer, t]);

  const saveEditor = useCallback(async () => {
    if (!editorPath) return;
    setEditorSaving(true);
    setEditorError(null);
    try {
      await appServer.writeFile(editorPath, utf8ToBase64(editorDraft));
      const checked = await reload();
      if (!checked || checked.errors.length > 0 || checked.warnings.length > 0) {
        setEditorError([
          t("settings.hooksConfigInvalid"),
          ...(checked?.warnings ?? []),
          ...(checked?.errors.map((item) => `${item.path}: ${item.message}`) ?? []),
        ].join("\n"));
        return;
      }
      setEditorPath(null);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : t("settings.hooksSaveError"));
    } finally {
      setEditorSaving(false);
    }
  }, [appServer, editorDraft, editorPath, reload, t]);

  return (
    <div className="mx-auto max-w-5xl space-y-8" data-source-breadcrumb="app-server.hooks/list">
      <header className="relative">
        <h2 className="text-2xl font-semibold tracking-tight">{t("settings.hooks")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("settings.hooksDescription")}{" "}
          <a href={HOOKS_DOCS_URL} target="_blank" rel="noreferrer" className="text-primary hover:underline">
            {t("settings.hooksLearnMore")}
          </a>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0"
          onClick={() => void reload()}
          disabled={loading || connection !== "connected"}
          title={t("settings.hooksReload")}
          aria-label={t("settings.hooksReload")}
        >
          <CodexWebIcon name={loading ? "loading" : "refresh"} className={loading ? "animate-spin" : undefined} aria-hidden />
        </Button>
      </header>

      {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      {(entry?.warnings.length ?? 0) > 0 && (
        <div className="rounded-lg border border-status-warning-border bg-status-warning-muted px-4 py-3 text-sm text-status-warning-foreground">
          {entry?.warnings.join("；")}
        </div>
      )}
      {(entry?.errors.length ?? 0) > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {entry?.errors.map((item) => <p key={`${item.path}:${item.message}`}>{item.path}: {item.message}</p>)}
        </div>
      )}

      {!loading && groups.length === 0 ? (
        <div className="rounded-2xl border border-border px-6 py-5">
          <p className="font-semibold">{t("settings.hooksEmptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.hooksEmptyDescription")}</p>
        </div>
      ) : (
        <section className="space-y-4">
          <h3 className="text-base font-semibold">{t("settings.hooksFromConfig")}</h3>
          {groups.map(([source, hooks]) => {
            const pending = hooks.filter(hookNeedsReview).length;
            return (
              <button
                key={source}
                type="button"
                className="flex w-full items-center gap-4 rounded-2xl border border-border bg-card px-6 py-5 text-left hover:bg-accent/40"
                onClick={() => setReviewSource(source)}
              >
                <CodexWebIcon name={source === "managed" ? "permission" : "settings"} size="lg" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{sourceLabel(source)}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t("settings.hooksCount", { count: hooks.length })}</span>
                </span>
                {pending > 0 && (
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-status-warning-foreground">
                    <CodexWebIcon name="warning" className="text-status-warning-foreground" aria-hidden />
                    {t("settings.hooksPendingReview", { count: pending })}
                  </span>
                )}
                <CaretRight size={18} className="text-muted-foreground" />
              </button>
            );
          })}
        </section>
      )}

      <Dialog open={reviewSource !== null} onOpenChange={(open) => !open && setReviewSource(null)}>
        <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b px-7 py-6">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <CodexWebIcon name="settings" size="lg" aria-hidden />
              {reviewSource ? sourceLabel(reviewSource) : ""}
            </DialogTitle>
            <DialogDescription>{t("settings.hooksAllProjects")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-6">
            {reviewHooks.some(hookNeedsReview) && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-status-warning-border bg-status-warning-muted px-4 py-3 text-sm text-status-warning-foreground">
                <CodexWebIcon name="warning" className="text-status-warning-foreground" aria-hidden />
                <span className="flex-1">{t("settings.hooksSecurityWarning")}</span>
                <Button size="sm" variant="outline" onClick={() => void trust(reviewHooks)} disabled={busyKey !== null}>
                  {t("settings.hooksTrustAll")}
                </Button>
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border">
              {reviewHooks.map((hook, index) => (
                <HookRow
                  key={hook.key}
                  hook={hook}
                  index={reviewHooks.slice(0, index).filter((candidate) => candidate.eventName === hook.eventName).length}
                  showEventHeader={index === 0 || reviewHooks[index - 1]?.eventName !== hook.eventName}
                  busy={busyKey !== null}
                  onTrust={() => void trust([hook])}
                  onToggle={(enabled) => void toggle(hook, enabled)}
                  onOpenConfig={() => void openEditor(hook.sourcePath)}
                />
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editorPath !== null} onOpenChange={(open) => !open && setEditorPath(null)}>
        <DialogContent className="w-[min(90vw,960px)] max-w-none">
          <DialogHeader>
            <DialogTitle className="break-all pr-8">{editorPath}</DialogTitle>
            <DialogDescription>{t("settings.hooksOpenConfig")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={editorDraft}
            onChange={(event) => setEditorDraft(event.target.value)}
            disabled={editorLoading || editorSaving}
            className="min-h-[420px] resize-y overflow-x-hidden whitespace-pre-wrap break-words font-mono text-sm"
            aria-label={t("settings.hooksOpenConfig")}
          />
          {editorError && <p className="whitespace-pre-wrap text-sm text-destructive">{editorError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorPath(null)} disabled={editorSaving}>
              {t("settings.hooksCancel")}
            </Button>
            <Button type="button" onClick={() => void saveEditor()} disabled={editorLoading || editorSaving}>
              {t("settings.hooksSave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HookRow({
  hook,
  index,
  showEventHeader,
  busy,
  onTrust,
  onToggle,
  onOpenConfig,
}: {
  hook: HookMetadata;
  index: number;
  showEventHeader: boolean;
  busy: boolean;
  onTrust: () => void;
  onToggle: (enabled: boolean) => void;
  onOpenConfig: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const needsReview = hookNeedsReview(hook);
  const eventDescription = t(`settings.hooksEvent.${hook.eventName}` as TranslationKey);
  const matcher = hook.matcher ?? "—";
  const statusMessage = hook.statusMessage ?? "—";

  return (
    <div className={cn("border-b last:border-b-0", expanded && "bg-accent/20")}>
      {showEventHeader && (
        <div className="flex items-center gap-4 px-5 py-4">
          <CodexWebIcon name="hook" size="lg" className="text-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{EVENT_LABELS[hook.eventName]}</p>
            <p className="text-sm text-muted-foreground">{eventDescription}</p>
          </div>
          {needsReview && <CodexWebIcon name="warning" className="text-status-warning-foreground" aria-hidden />}
        </div>
      )}
      <div className={cn("flex min-h-14 items-center gap-2.5 bg-muted/20 px-5 py-2", showEventHeader && "border-t")}>
        <span className="min-w-0 flex-1 font-medium">{t("settings.hooksHandler", { count: index + 1 })}</span>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={onOpenConfig} title={t("settings.hooksOpenConfig")} aria-label={t("settings.hooksOpenConfig")}>
          <CodexWebIcon name="external" size="sm" aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => setExpanded((value) => !value)} aria-label={eventDescription}>
          <CaretDown size={18} className={cn("transition-transform", expanded && "rotate-180")} />
        </Button>
        {needsReview ? (
          <Button type="button" size="sm" variant="outline" className="h-9 rounded-full px-3" onClick={onTrust} disabled={busy || hook.isManaged}>
            <TrustIcon />
            {t("settings.hooksTrust")}
          </Button>
        ) : (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm text-muted-foreground">
            <TrustIcon />
            {hook.isManaged ? t("settings.hooksManaged") : t("settings.hooksTrust")}
          </span>
        )}
        <Switch
          checked={hook.enabled && !needsReview}
          onCheckedChange={onToggle}
          disabled={busy || hook.isManaged || needsReview}
          aria-label={`${EVENT_LABELS[hook.eventName]} ${t("settings.hooksTrust")}`}
          title={needsReview ? t("settings.hooksUntrusted") : undefined}
        />
      </div>
      {expanded && (
        <div className="mx-5 mb-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-5 gap-y-3 rounded-xl border bg-background/70 px-4 py-4 text-sm leading-6">
          <span className="text-muted-foreground">{t("settings.hooksProcessor")}</span><span>{hook.handlerType}</span>
          <span className="text-muted-foreground">{t("settings.hooksCommand")}</span><code className="break-all whitespace-pre-wrap">{hook.command ?? t("settings.hooksNoCommand")}</code>
          <span className="text-muted-foreground">{t("settings.hooksMatcher")}</span><code>{matcher}</code>
          <span className="text-muted-foreground">{t("settings.hooksTimeout")}</span><span>{t("settings.hooksSeconds", { count: Number(hook.timeoutSec) })}</span>
          <span className="text-muted-foreground">{t("settings.hooksStatusMessage")}</span><span>{statusMessage}</span>
          {needsReview && <><span className="text-muted-foreground">{t("settings.hooksTrust")}</span><span className="text-status-warning-foreground">{hook.trustStatus === "modified" ? t("settings.hooksModified") : t("settings.hooksUntrusted")}</span></>}
        </div>
      )}
    </div>
  );
}

function TrustIcon() {
  return (
    <span className="relative inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
      <CodexWebIcon name="permission" size={16} className="absolute inset-0" />
      <CodexWebIcon name="success" size={8} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-current" strokeWidth={2.5} />
    </span>
  );
}
