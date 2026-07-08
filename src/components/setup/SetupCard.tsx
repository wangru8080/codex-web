'use client';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CheckCircle, Minus, Warning, Circle } from '@/components/ui/icon';
import type { SetupCardStatus } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

const STATUS_CONFIG = {
  'not-configured': { icon: Circle, color: 'text-muted-foreground', label: 'Not configured' },
  'completed': { icon: CheckCircle, color: 'text-status-success', label: 'Completed' },
  'skipped': { icon: Minus, color: 'text-muted-foreground/60', label: 'Skipped' },
  'needs-fix': { icon: Warning, color: 'text-status-warning', label: 'Needs attention' },
};

interface SetupCardProps {
  title: string;
  description: string;
  status: SetupCardStatus;
  icon?: React.ReactNode;
  onSkip?: () => void;
  skipLabel?: string;
  children: React.ReactNode;
}

export function SetupCard({ title, description, status, icon, onSkip, skipLabel, children }: SetupCardProps) {
  const { t } = useTranslation();
  const statusCfg = STATUS_CONFIG[status];
  const StatusIcon = statusCfg.icon;

  return (
    <div className={cn(
      'rounded-lg border bg-card p-4 space-y-3',
      status === 'completed' && 'border-status-success/30',
      status === 'needs-fix' && 'border-status-warning/30',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {icon && <div className="mt-0.5">{icon}</div>}
          <div>
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusIcon size={16} className={statusCfg.color} />
          <span className={cn('text-xs', statusCfg.color)}>{statusCfg.label}</span>
        </div>
      </div>

      {status !== 'completed' && status !== 'skipped' && (
        <div className="space-y-3">
          {children}
          {onSkip && (
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={onSkip}>
              {skipLabel || t('setup.claude.skip')}
            </Button>
          )}
        </div>
      )}

      {(status === 'completed' || status === 'skipped') && (
        <div className="text-xs text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
