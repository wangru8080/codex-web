"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import {
  SETTINGS_NAV_ITEMS,
  pathnameToSettingsSection,
} from "@/components/settings/nav-config";

interface SettingsSidebarProps {
  open: boolean;
}

/**
 * Settings sidebar — replaces ChatListPanel when on /settings route.
 * Top: Back button → returns to previous view (chat).
 * Below: section navigation (one entry per /settings/<section> route).
 *
 * Memory contract: nav items are <Link prefetch={false}> so dev only
 * compiles the section a user actually clicks into. Active state is
 * derived from pathname, not hash; legacy /settings#section hash entries
 * are redirected to the new path by the /settings root page on mount.
 *
 * v6 fix (P2): nav items live in `@/components/settings/nav-config`,
 * shared with `src/app/settings/layout.tsx` (the mobile horizontal
 * nav). Previously each file kept its own literal and diverging adds
 * (Tasks here, not there) caused a hydration mismatch.
 */
export function SettingsSidebar({ open }: SettingsSidebarProps) {
  const pathname = usePathname();
  const { t } = useTranslation();

  const activeSection = pathnameToSettingsSection(pathname || "/settings");

  if (!open) return null;

  // Phase 7c-B — surface chrome (data-platform-sidebar attribute, bg
  // token, backdrop-filter, overflow-hidden, width inset) moved to
  // <CardSurface kind="sidebar" variant="settings"> in AppShell.
  return (
    <div className="flex h-full w-full flex-col">
      {/* Round 33 — back button moved out to UnifiedTopBar's
          /settings branch so it lives in the same tab bar as the
          sidebar-toggle button, not inside the sidebar card. Saves
          ~52px of vertical space at the top of the sidebar and
          collapses the navigation tighter to the topbar. */}

      {/* Section navigation */}
      <div className="p-2 flex flex-col gap-0.5">
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <div key={item.id} className={item.groupI18nKey ? "mt-5" : undefined}>
              {item.groupI18nKey && (
                <div className="px-3 pb-1.5 text-xs font-medium text-muted-foreground/70">
                  {t(item.groupI18nKey)}
                </div>
              )}
              <Link
                href={item.href}
                prefetch={false}
                className={cn(
                  "group inline-flex items-center w-full justify-start gap-2 h-9 px-3 rounded-xl text-[13px]",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground font-normal hover:bg-sidebar-accent/60",
                )}
              >
                <CodexWebIcon
                  name={item.icon}
                  size="md"
                  strokeWidth={isActive ? 2 : undefined}
                  className="text-inherit"
                  aria-hidden
                />
                {t(item.i18nKey)}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
