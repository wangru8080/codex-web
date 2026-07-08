'use client';

import { Component, type ReactNode } from 'react';
import { useTranslation } from '@/hooks/useTranslation';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class WidgetErrorBoundaryInner extends Component<Props & { errorLabel: string; showCodeLabel: string }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.warn('[WidgetErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-lg border border-status-error-border bg-status-error-muted p-3 text-sm">
          <p className="font-medium text-status-error-foreground">{this.props.errorLabel}</p>
          {this.state.error && (
            <p className="mt-1 text-xs text-muted-foreground">{this.state.error.message}</p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

export function WidgetErrorBoundary({ children, fallback }: Props) {
  const { t } = useTranslation();
  return (
    <WidgetErrorBoundaryInner
      errorLabel={t('widget.error')}
      showCodeLabel={t('widget.showCode')}
      fallback={fallback}
    >
      {children}
    </WidgetErrorBoundaryInner>
  );
}
