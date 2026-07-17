"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CodexWebIcon, type CodexWebIconName } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";


interface NavRailProps {
  chatListOpen: boolean;
  onToggleChatList: () => void;
  hasUpdate?: boolean;
  readyToInstall?: boolean;
}

// Codex 专用 Web 版只保留核心入口：对话、插件、设置。Gallery /
// Bridge / Provider 等旧产品面保留兼容重定向，但不再出现在主导航。
const navItems: ReadonlyArray<{ href: string; label: string; icon: CodexWebIconName }> = [
  { href: "/chat", label: "Chats", icon: "chat" },
  { href: "/plugins", label: "Plugins", icon: "plugin" },
] as const;

export function NavRail({ onToggleChatList, hasUpdate, readyToInstall }: NavRailProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const navLabelKeys: Record<string, TranslationKey> = {
    'Chats': 'nav.chats',
    'Plugins': 'nav.plugins',
  };
  const isChatRoute = pathname === "/chat" || pathname.startsWith("/chat/");
  const isSettingsActive = pathname === "/settings" || pathname.startsWith("/settings/");

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center bg-sidebar/80 backdrop-blur-xl pb-3 pt-10">
      {/* Nav icons */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map((item) => {
          const isActive =
            item.href === "/chat"
              ? pathname === "/chat" || pathname.startsWith("/chat/")
              : pathname === item.href || pathname.startsWith(item.href + "/") || pathname.startsWith(item.href + "?");

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                {item.href === "/chat" ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-9 w-9",
                      isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                    )}
                    onClick={() => {
                      if (!isChatRoute) {
                        // Navigate to chat page first, then open chat list
                        router.push("/chat");
                        onToggleChatList();
                      } else {
                        onToggleChatList();
                      }
                    }}
                  >
                    <CodexWebIcon name={item.icon} size="md" strokeWidth={isActive ? 2 : undefined} className="text-inherit" aria-hidden />
                    <span className="sr-only">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</span>
                  </Button>
                ) : (
                  <div className="relative">
                    <Button
                      asChild
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-9 w-9",
                        isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                      )}
                    >
                      <Link href={item.href}>
                        <CodexWebIcon name={item.icon} size="md" strokeWidth={isActive ? 2 : undefined} className="text-inherit" aria-hidden />
                        <span className="sr-only">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</span>
                      </Link>
                    </Button>
                  </div>
                )}
              </TooltipTrigger>
              <TooltipContent side="right">{t(navLabelKeys[item.label] ?? item.label as TranslationKey)}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* Bottom: settings */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="relative">
              <Button
                asChild
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9",
                  isSettingsActive && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <Link href="/settings">
                  <CodexWebIcon name="settings" size="md" strokeWidth={isSettingsActive ? 2 : undefined} className="text-inherit" aria-hidden />
                  <span className="sr-only">{t('nav.settings')}</span>
                </Link>
              </Button>
              {hasUpdate && (
                <span className={cn(
                  "absolute top-0.5 right-0.5 h-2 w-2 rounded-full",
                  readyToInstall ? "bg-status-success animate-pulse" : "bg-primary"
                )} />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{t('nav.settings')}</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
