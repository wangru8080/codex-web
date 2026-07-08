'use client';

import { XCircle, X } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorBannerAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost';
}

interface ErrorBannerProps {
  message: string;
  description?: string;
  actions?: ErrorBannerAction[];
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({ message, description, actions, onDismiss, className }: ErrorBannerProps) {
  return (
    <div className={cn(
      'flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm',
      className
    )}>
      <XCircle size={16} className="shrink-0 text-destructive mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-destructive">{message}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        {actions && actions.length > 0 && (
          <div className="flex gap-2 mt-1.5">
            {actions.map((action, i) => (
              <Button
                key={i}
                variant={action.variant || 'outline'}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
