'use client';

import { useTranslation } from '@/hooks/useTranslation';
import { MonolithIcon } from '@/components/brand/MonolithIcon';

export function WelcomeCard() {
  const { t } = useTranslation();
  const version = process.env.NEXT_PUBLIC_APP_VERSION || '0.0.0';

  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
      <MonolithIcon className="h-12 w-12 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-medium">{t('setup.welcome.title')}</h3>
        <p className="text-xs text-muted-foreground">{t('setup.welcome.description')}</p>
        <p className="text-[10px] text-muted-foreground/50">v{version}</p>
      </div>
    </div>
  );
}
