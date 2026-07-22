"use client";

import { usePathname } from "next/navigation";

import { AppServerProvider } from "@/codex-web/AppServerProvider";
import { AppShell } from "@/components/layout/AppShell";

export function RootAppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return children;
  return (
    <AppServerProvider>
      <AppShell>{children}</AppShell>
    </AppServerProvider>
  );
}
