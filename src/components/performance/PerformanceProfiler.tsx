"use client";

import { Profiler } from "react";

import {
  isWebPerformanceCollectionEnabled,
  recordBrowserProfilerCommit,
} from "@/lib/web-performance";

export function PerformanceProfiler({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const enabled =
    typeof window !== "undefined"
    && isWebPerformanceCollectionEnabled(window.location.search);

  if (!enabled) return children;
  return (
    <Profiler id={id} onRender={recordBrowserProfilerCommit}>
      {children}
    </Profiler>
  );
}
