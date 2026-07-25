'use client';

import { useId, useState } from 'react';

import { CaretDown } from '@/components/ui/icon';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { usePanel } from '@/hooks/usePanel';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { cn } from '@/lib/utils';
import type { TurnFileChangeSummary } from '@/codex-web/file-change-summary';

export function ComposerFileChanges({ summary }: { summary: TurnFileChangeSummary | null }) {
  const { t } = useTranslation();
  const { setPreviewSource } = usePanel();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  if (!summary) return null;

  return (
    <div
      className="relative mb-2 flex justify-center"
      data-testid="composer-file-changes"
      data-source-breadcrumb={summary.sourceBreadcrumb}
    >
      {expanded && (
        <div
          id={panelId}
          className="absolute bottom-full z-30 mb-2 max-h-64 w-full max-w-lg overflow-y-auto rounded-lg border border-border/70 bg-popover p-1.5 shadow-[var(--shadow-diffuse)]"
        >
          {summary.files.map((file) => (
            <button
              key={file.path}
              type="button"
              disabled={!file.diff}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                setPreviewSource({
                  kind: 'inline-diff',
                  diff: file.diff,
                  virtualName: file.path.split(/[/\\]/).pop() || file.path,
                });
                setExpanded(false);
              }}
            >
              <CodexWebIcon name="edit" size={12} className="shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
                {file.path}
              </span>
              <span className="shrink-0 text-xs text-emerald-600 dark:text-emerald-400">
                +{file.additions}
              </span>
              <span className="shrink-0 text-xs text-rose-600 dark:text-rose-400">
                -{file.deletions}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={t('composer.fileChanges.open' as TranslationKey)}
        className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/95 px-3.5 text-xs text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="truncate">
          {t('composer.fileChanges.summary' as TranslationKey, { count: summary.fileCount })}
        </span>
        <span className="shrink-0 text-emerald-600 dark:text-emerald-400">+{summary.additions}</span>
        <span className="shrink-0 text-rose-600 dark:text-rose-400">-{summary.deletions}</span>
        <CaretDown
          size={12}
          aria-hidden
          className={cn('shrink-0 transition-transform', expanded && 'rotate-180')}
        />
      </button>
    </div>
  );
}
