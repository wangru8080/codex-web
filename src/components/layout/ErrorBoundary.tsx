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
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, domRetries: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const msg = error.message || '';
    const isDomError = DOM_ERROR_PATTERNS.some(p => msg.includes(p));

    // Auto-recover from DOM errors (hydration mismatch, stale node refs)
    // by clearing the error state and letting React re-render cleanly.
    // Max 2 retries to prevent infinite loops.
    if (isDomError && this.state.domRetries < 2) {
      console.warn("[ErrorBoundary] DOM operation error, auto-recovering:", msg);
      this.setState(prev => ({ hasError: false, error: null, domRetries: prev.domRetries + 1 }));
      return;
    }

    console.error("[ErrorBoundary] Uncaught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
    // Report to Sentry if available
    import('@sentry/browser').then((Sentry) => {
      Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack } } });
    }).catch(() => { /* Sentry not available */ });
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
