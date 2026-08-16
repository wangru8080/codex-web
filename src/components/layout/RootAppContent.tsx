"use client";

import { usePathname } from "next/navigation";

import { AppServerProvider } from "@/codex-web/AppServerProvider";
import { AppShell } from "@/components/layout/AppShell";
import { PerformanceProfiler } from "@/components/performance/PerformanceProfiler";
import { WebPerformanceObserver } from "@/components/performance/WebPerformanceObserver";

export function RootAppContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname === "/workspace/terminal" || pathname === "/workspace/preview") return children;
  return (
    <AppServerProvider>
      <WebPerformanceObserver />
      <PerformanceProfiler id="AppShell">
        <AppShell>{children}</AppShell>
      </PerformanceProfiler>
    </AppServerProvider>
  );
}
