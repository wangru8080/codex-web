"use client";

import React, { useState } from "react";
import { WarningCircle } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** Number of auto-recovery attempts for DOM errors */
  domRetries: number;
}

/** DOM operation errors that can often be recovered by re-rendering */
const DOM_ERROR_PATTERNS = [
  'insertBefore',
  'removeChild',
  'appendChild',
  'replaceChild',
  'is not a child of this node',
];

const CHUNK_LOAD_ERROR_PATTERNS = [
  'failed to load chunk',
  'loading chunk',
  'chunkloaderror',
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'unable to preload css',
];

const CHUNK_RELOAD_STORAGE_KEY = 'codepilot:chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

export function isRecoverableDomError(message: string): boolean {
  return DOM_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function isChunkLoadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function claimChunkReloadAttempt(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now = Date.now(),
): boolean {
  try {
    const previous = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY) ?? 0);
    if (Number.isFinite(previous) && previous > 0 && now - previous < CHUNK_RELOAD_COOLDOWN_MS) {
      return false;
    }
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/* ── Fallback UI (functional, so it can use hooks) ──────────── */

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex h-full w-full items-center justify-center bg-background p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <WarningCircle size={24} />
        </div>

        <h2 className="text-lg font-semibold text-foreground">
          {t("error.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("error.description")}
        </p>

        {error && (
          <Button
            variant="link"
            size="sm"
            onClick={() => setShowDetails((s) => !s)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showDetails ? t("error.hideDetails") : t("error.showDetails")}
          </Button>
        )}
        {showDetails && error && (
          <pre className="max-h-40 w-full overflow-auto rounded-md border border-border/50 bg-muted/30 p-3 text-left text-xs text-muted-foreground">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        )}

        <div className="flex gap-2">
          <Button onClick={onReset}>
            {t("error.tryAgain")}
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
            {t("error.reloadApp")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Error Boundary (class component, required by React) ────── */

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, domRetries: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const msg = error.message || '';
    const isDomError = isRecoverableDomError(msg);

    // A deployment can replace .next while a tab is still open. In that case
    // Next tries to fetch a route chunk that no longer exists and a hard
    // reload is enough to pick up the new build. Only do this once per minute
    // so a partially deployed build cannot trap the page in a reload loop.
    if (typeof window !== 'undefined' && isChunkLoadError(msg)) {
      let shouldReload = false;
      try {
        shouldReload = claimChunkReloadAttempt(window.sessionStorage);
      } catch {
        // Some privacy modes throw when sessionStorage is accessed.
      }
      if (shouldReload) {
        console.warn('[ErrorBoundary] Route chunk missing after an app update; reloading:', msg);
        window.location.reload();
        return;
      }
    }

    // Auto-recover from DOM errors (hydration mismatch, stale node refs)
    // by clearing the error state and letting React re-render cleanly.
    // Max 2 retries to prevent infinite loops.
    if (isDomError && this.state.domRetries < 2) {
      console.warn("[ErrorBoundary] DOM operation error, scheduling recovery:", msg);
      this.recoveryTimer = setTimeout(() => {
        this.recoveryTimer = null;
        this.setState((prev) => ({
          hasError: false,
          error: null,
          domRetries: prev.domRetries + 1,
        }));
      }, 0);
      return;
    }

    console.error("[ErrorBoundary] Uncaught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
    // Report to Sentry if available
    import('@sentry/browser').then((Sentry) => {
      Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
    }).catch(() => { /* Sentry not available */ });
  }

  componentWillUnmount() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback error={this.state.error} onReset={this.handleReset} />
      );
    }
    return this.props.children;
  }
}
