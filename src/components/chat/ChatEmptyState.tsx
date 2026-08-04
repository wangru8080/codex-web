'use client';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';

interface ChatEmptyStateProps {
  hasDirectory: boolean;
  hasProvider: boolean;
  onSelectFolder: () => void;
  recentProjects?: string[];
  onSelectProject?: (path: string) => void;
}

export function ChatEmptyState({
  hasDirectory,
  hasProvider,
  onSelectFolder,
  recentProjects,
  onSelectProject,
}: ChatEmptyStateProps) {
  const { t } = useTranslation();

  if (hasDirectory && hasProvider) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{t('chat.empty.ready')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-6">
        <Card className="cursor-pointer">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CodexWebIcon name="folder_open" size="lg" className="text-primary" aria-hidden />
              <CardTitle className="text-base">{t('chat.empty.projectChat.title')}</CardTitle>
            </div>
            <CardDescription>{t('chat.empty.projectChat.description')}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button size="sm" className="gap-1.5" onClick={onSelectFolder}>
              <CodexWebIcon name="folder_open" size="sm" aria-hidden />
              {t('chat.empty.selectFolder')}
            </Button>
          </CardFooter>
        </Card>

        {/* Provider setup prompt */}
        {!hasProvider && (
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium">{t('chat.empty.noProvider')}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.assign('/settings/codex')}
            >
              {t('chat.empty.openSetup')}
            </Button>
          </div>
        )}

        {/* Recent projects */}
        {recentProjects && recentProjects.length > 0 && onSelectProject && (
          <div className="space-y-2 text-center">
            <p className="text-xs text-muted-foreground">{t('chat.empty.recentProjects')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {recentProjects.slice(0, 5).map(p => {
                const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                return (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    className="h-8 max-w-48 rounded-lg bg-background px-3 text-xs font-medium shadow-xs"
                    onClick={() => onSelectProject(p)}
                    title={p}
                  >
                    <CodexWebIcon name="folder" size="sm" aria-hidden />
                    <span className="truncate">{name}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
