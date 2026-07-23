"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { useAppServerState } from "@/codex-web/AppServerProvider";
import {
  installWebPerformanceBrowserApi,
  recordBrowserPerformanceEntry,
  toSerializableEntry,
} from "@/lib/web-performance";

const routeStartMark = "codex.route-start";
const routeDurationMeasure = "codex.route-duration";

export function WebPerformanceObserver() {
  const pathname = usePathname();
  const appServerState = useAppServerState();
  const markedBridgeReady = useRef(false);
  const markedInitialized = useRef(false);
  const markedInteractive = useRef(false);

  useEffect(() => {
    const api = installWebPerformanceBrowserApi();
    if (!api) return;

    api.mark("codex.hydrated");
    const navigation = performance.getEntriesByType("navigation")[0];
    if (navigation) recordBrowserPerformanceEntry(toSerializableEntry(navigation));

    if (!("PerformanceObserver" in window)) return;
    const supported = PerformanceObserver.supportedEntryTypes ?? [];
    if (!supported.includes("longtask")) return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordBrowserPerformanceEntry(toSerializableEntry(entry));
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const api = window.__CODEX_WEB_PERFORMANCE__;
    if (!api) return;

    if (appServerState.connection.data === "connected" && !markedBridgeReady.current) {
      markedBridgeReady.current = true;
      api.mark("codex.bridge-ready");
    }

    if (appServerState.initialize && !markedInitialized.current) {
      markedInitialized.current = true;
      api.mark("codex.app-server-initialized");
    }

    if (appServerState.initialize && !markedInteractive.current) {
      markedInteractive.current = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => window.__CODEX_WEB_PERFORMANCE__?.mark("codex.first-interactive"));
      });
    }
  }, [appServerState.connection.data, appServerState.initialize]);

  useEffect(() => {
    const api = window.__CODEX_WEB_PERFORMANCE__;
    if (!api) return;

    api.mark(`codex.route-complete:${pathname}`);
    if (performance.getEntriesByName(routeStartMark, "mark").length === 0) return;
    performance.measure(routeDurationMeasure, routeStartMark);
    const measure = performance.getEntriesByName(routeDurationMeasure, "measure").at(-1);
    if (measure) recordBrowserPerformanceEntry(toSerializableEntry(measure));
    performance.clearMarks(routeStartMark);
    performance.clearMeasures(routeDurationMeasure);
  }, [pathname]);

  return null;
}
