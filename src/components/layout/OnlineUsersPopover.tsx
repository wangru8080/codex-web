"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { useAppServerActions } from "@/codex-web/AppServerProvider";
import type { BrokerOnlineUser } from "@/codex-web/broker-presence";
import { Input } from "@/components/ui/input";
import { SpinnerGap, Users } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

const PAGE_SIZE = 50;

export function OnlineUsersPopover({ onlineUsers }: { onlineUsers: number }) {
  const { t } = useTranslation();
  const { listOnlineUsers } = useAppServerActions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<BrokerOnlineUser[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const fetchPage = useCallback(async (cursor: string | null, replace: boolean) => {
    const sequence = requestSequence.current;
    setLoading(true);
    try {
      const page = await listOnlineUsers({ query, limit: PAGE_SIZE, cursor });
      if (sequence !== requestSequence.current) return;
      setItems((current) => replace ? page.items : [...current, ...page.items]);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : t("topBar.onlineUsersLoadFailed" as TranslationKey));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [listOnlineUsers, query, t]);

  useEffect(() => {
    if (!open) return;
    requestSequence.current += 1;
    setItems([]);
    setTotal(0);
    setNextCursor(null);
    setError(null);
    const timer = setTimeout(() => void fetchPage(null, true), query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [fetchPage, onlineUsers, open, query]);

  const loadNextPage = useCallback(() => {
    if (!loading && nextCursor) void fetchPage(nextCursor, false);
  }, [fetchPage, loading, nextCursor]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) requestSequence.current += 1;
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-online-user-count={onlineUsers}
          aria-label={t("topBar.onlineUsers" as TranslationKey, { count: onlineUsers })}
          className="flex h-7 min-w-[62px] shrink-0 items-center justify-center gap-1.5 rounded-full border border-border bg-background/80 px-2 text-xs font-medium tabular-nums text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Users size={14} aria-hidden />
          <span>{onlineUsers}</span>
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(24rem,calc(100vw-1rem))] gap-0 overflow-hidden rounded-lg p-0"
        data-online-user-list
      >
        <div className="border-b border-border px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">
              {t("topBar.onlineUsersTitle" as TranslationKey)}
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">{onlineUsers}</span>
          </div>
          <Input
            data-online-user-search
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("topBar.onlineUsersSearch" as TranslationKey)}
            aria-label={t("topBar.onlineUsersSearch" as TranslationKey)}
            className="mt-3 h-8 rounded-md bg-muted/60 text-sm"
          />
        </div>

        <div className="h-80 min-h-0">
          {items.length === 0 && !loading ? (
            <div className="flex h-full items-center justify-center px-4 text-sm text-muted-foreground">
              {error
                ? t("topBar.onlineUsersLoadFailed" as TranslationKey)
                : t("topBar.onlineUsersEmpty" as TranslationKey)}
            </div>
          ) : (
            <Virtuoso
              data={items}
              endReached={loadNextPage}
              itemContent={(_, user) => <OnlineUserRow user={user} />}
              components={{
                Footer: () => loading ? (
                  <div className="flex h-10 items-center justify-center text-muted-foreground">
                    <SpinnerGap size={16} className="animate-spin" aria-hidden />
                  </div>
                ) : null,
              }}
            />
          )}
        </div>

        <div
          className="border-t border-border px-3 py-2 text-xs tabular-nums text-muted-foreground"
          data-online-user-loaded={items.length}
          data-online-user-total={total}
        >
          {t("topBar.onlineUsersLoaded" as TranslationKey, {
            loaded: items.length,
            total,
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function OnlineUserRow({ user }: { user: BrokerOnlineUser }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-14 items-center gap-2.5 border-b border-border/60 px-3 last:border-b-0"
      data-online-user-email={user.email}
    >
      <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={user.email}>{user.email}</div>
        <div className="truncate text-xs text-muted-foreground">
          {user.id} · {user.osUser}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-muted-foreground">
        <div>{user.activeTurns > 0
          ? t("topBar.onlineUserActiveTurns" as TranslationKey, { count: user.activeTurns })
          : t("topBar.onlineUserIdle" as TranslationKey)}</div>
        {user.connections > 1 && (
          <div>{t("topBar.onlineUserConnections" as TranslationKey, { count: user.connections })}</div>
        )}
      </div>
    </div>
  );
}
