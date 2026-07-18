"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Thread } from "@/codex/protocol/generated/v2/Thread";
import { useAppServerActions, useAppServerState } from "@/codex-web/AppServerProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import { cn } from "@/lib/utils";

type TaskFilter = "all" | "named" | "unnamed";
type DeleteTarget =
  | { type: "thread"; ids: string[] }
  | { type: "project"; ids: string[] }
  | { type: "all"; ids: string[] };

type ArchivedProjectGroup = {
  cwd: string;
  name: string;
  threads: Thread[];
};

export function ArchivedThreadsSection() {
  const { t, locale } = useTranslation();
  const connection = useAppServerState().connection.data;
  const { listThreads, unarchiveThread, deleteThread } = useAppServerActions();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const loadArchivedThreads = useCallback(async () => {
    if (connection !== "connected") {
      setLoading(connection !== "failed");
      if (connection === "failed") setError(t("archived.loadFailed"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data: Thread[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const response = await listThreads({
          archived: true,
          cursor,
          limit: 100,
          sortKey: "recency_at",
          sortDirection: "desc",
        });
        data.push(...response.data);
        cursor = response.nextCursor;
        if (cursor && seenCursors.has(cursor)) break;
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      setThreads(data);
    } catch {
      setError(t("archived.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [connection, listThreads, t]);

  useEffect(() => {
    void loadArchivedThreads();
  }, [loadArchivedThreads]);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    for (const thread of threads) {
      projects.set(thread.cwd, projectName(thread.cwd, t("archived.noProject")));
    }
    return [...projects.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [locale, t, threads]);

  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = threads.filter((thread) => {
      const selectedCwd = projectFilter === "__no_project__" ? "" : projectFilter;
      if (projectFilter !== "all" && thread.cwd !== selectedCwd) return false;
      if (taskFilter === "named" && !thread.name) return false;
      if (taskFilter === "unnamed" && thread.name) return false;
      if (!normalizedQuery) return true;
      const searchable = [
        thread.name,
        thread.preview,
        thread.cwd,
        projectName(thread.cwd, t("archived.noProject")),
      ].filter(Boolean).join(" ").toLocaleLowerCase(locale);
      return searchable.includes(normalizedQuery);
    });

    const byProject = new Map<string, Thread[]>();
    for (const thread of filtered) {
      const current = byProject.get(thread.cwd) ?? [];
      current.push(thread);
      byProject.set(thread.cwd, current);
    }
    return [...byProject.entries()].map<ArchivedProjectGroup>(([cwd, projectThreads]) => ({
      cwd,
      name: projectName(cwd, t("archived.noProject")),
      threads: projectThreads.sort((a, b) => threadTimestamp(b) - threadTimestamp(a)),
    })).sort((a, b) => threadTimestamp(b.threads[0]) - threadTimestamp(a.threads[0]));
  }, [locale, projectFilter, query, t, taskFilter, threads]);

  const runForIds = useCallback(async (
    ids: string[],
    action: (threadId: string) => Promise<unknown>,
  ) => {
    setError(null);
    setPendingIds((current) => new Set([...current, ...ids]));
    const completed = new Set<string>();
    try {
      for (const id of ids) {
        await action(id);
        completed.add(id);
      }
      setThreads((current) => current.filter((thread) => !completed.has(thread.id)));
    } catch {
      setThreads((current) => current.filter((thread) => !completed.has(thread.id)));
      setError(t("archived.actionFailed"));
    } finally {
      setPendingIds((current) => {
        const next = new Set(current);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    }
  }, [t]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const ids = deleteTarget.ids;
    setDeleteTarget(null);
    await runForIds(ids, deleteThread);
  }, [deleteTarget, deleteThread, runForIds]);

  const deleteTitle = deleteTarget?.type === "thread"
    ? t("archived.deleteOneTitle")
    : deleteTarget?.type === "project"
      ? t("archived.deleteProjectTitle")
      : t("archived.deleteAllTitle");

  const hasFilters = query.trim() !== "" || taskFilter !== "all" || projectFilter !== "all";

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-normal">{t("archived.title")}</h2>
        {threads.length > 0 && (
          <Button
            type="button"
            variant="destructive"
            className="gap-2"
            onClick={() => setDeleteTarget({ type: "all", ids: threads.map((thread) => thread.id) })}
          >
            <CodexWebIcon name="delete" size="sm" aria-hidden />
            {t("archived.deleteAll")}
          </Button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_180px_220px]">
        <div className="relative">
          <CodexWebIcon
            name="search"
            size="md"
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("archived.searchPlaceholder")}
            className="h-10 pl-10"
          />
        </div>
        <Select value={taskFilter} onValueChange={(value) => setTaskFilter(value as TaskFilter)}>
          <SelectTrigger className="h-10 w-full">
            <CodexWebIcon name="filter" size="sm" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("archived.allTasks")}</SelectItem>
            <SelectItem value="named">{t("archived.namedTasks")}</SelectItem>
            <SelectItem value="unnamed">{t("archived.unnamedTasks")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-10 w-full">
            <CodexWebIcon name="folder" size="sm" aria-hidden />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("archived.allProjects")}</SelectItem>
            {projectOptions.map(([cwd, name]) => (
              <SelectItem key={cwd || "no-project"} value={cwd || "__no_project__"}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-muted-foreground">
          <CodexWebIcon name="loading" size="lg" className="animate-spin" aria-hidden />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <CodexWebIcon name="archive" size="xl" aria-hidden />
          <p className="text-sm">{hasFilters ? t("archived.noResults") : t("archived.empty")}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.cwd || "no-project"} className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-0.5">
                <div className="flex min-w-0 items-center gap-2">
                  <CodexWebIcon name="folder" size="md" className="shrink-0" aria-hidden />
                  <h3 className="truncate text-sm font-semibold">{group.name}</h3>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{t("archived.taskCount", { count: group.threads.length })}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t("chatList.moreActions")}>
                        <CodexWebIcon name="more" size="sm" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteTarget({ type: "project", ids: group.threads.map((thread) => thread.id) })}
                      >
                        <CodexWebIcon name="delete" size="sm" aria-hidden />
                        {t("archived.deleteProject")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                {group.threads.map((thread, index) => {
                  const pending = pendingIds.has(thread.id);
                  return (
                    <div
                      key={thread.id}
                      className={cn(
                        "flex items-center gap-4 px-4 py-3",
                        index > 0 && "border-t border-border/60",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {thread.name || thread.preview || t("archived.untitled")}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatThreadDate(thread, locale)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        aria-label={t("chatList.deleteConversation")}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ type: "thread", ids: [thread.id] })}
                      >
                        <CodexWebIcon name={pending ? "loading" : "delete"} size="sm" className={pending ? "animate-spin" : undefined} aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => void runForIds([thread.id], unarchiveThread)}
                      >
                        {t("archived.unarchive")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t("archived.deleteWarning")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function projectName(cwd: string, fallback: string): string {
  if (!cwd) return fallback;
  return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
}

function threadTimestamp(thread: Thread | undefined): number {
  if (!thread) return 0;
  return (thread.recencyAt ?? thread.updatedAt ?? thread.createdAt) * 1000;
}

function formatThreadDate(thread: Thread, locale: string): string {
  return new Date(threadTimestamp(thread)).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
