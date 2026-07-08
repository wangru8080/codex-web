"use client";

import { useEffect } from "react";

/**
 * Client-side Sentry initialization component.
 * Must be rendered in the client tree (inside a "use client" boundary).
 * No-ops gracefully when NEXT_PUBLIC_SENTRY_DSN is not set.
 */
export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;

    // Check user opt-out
    try {
      if (localStorage.getItem("codepilot:sentry-disabled") === "true") return;
    } catch {
      /* ignore */
    }

    // Dynamic import to avoid bundling Sentry when DSN is absent
    import("@sentry/browser").then((Sentry) => {
      if (Sentry.isInitialized()) return;
      Sentry.init({
        dsn,
        environment: process.env.NODE_ENV,
        release: `codepilot@${process.env.NEXT_PUBLIC_APP_VERSION}`,
        tracesSampleRate: 0,
        beforeBreadcrumb(breadcrumb) {
          if (breadcrumb.category === "ui.input") return null;
          return breadcrumb;
        },
        ignoreErrors: [
          // Expected/non-actionable errors — don't waste Sentry quota
          'AbortError',
          'Operation aborted',
          'The operation was aborted',
          'signal is aborted',
          'prompt() is not supported',        // Electron doesn't support window.prompt
          'ResizeObserver loop',               // Browser quirk, not a real error
          /^Object \[object Object\] has no method/,  // Sentry's own frontend bug
        ],
        beforeSend(event) {
          // Respect opt-out
          try {
            if (localStorage.getItem("codepilot:sentry-disabled") === "true") return null;
          } catch {
            /* ignore */
          }
          // Strip auth headers
          if (event.request?.headers) {
            delete event.request.headers["x-api-key"];
            delete event.request.headers["authorization"];
            delete event.request.headers["anthropic-api-key"];
          }
          // Add useful context tags
          event.tags = {
            ...event.tags,
            platform: navigator.platform,
            electron: typeof window !== 'undefined' && 'electronAPI' in window ? 'yes' : 'no',
          };
          return event;
        },
      });
    }).catch(() => {
      /* Sentry not available */
    });
  }, []);

  return null;
}
