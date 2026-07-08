'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { WelcomeCard } from './WelcomeCard';
import { CodexAccountCard } from './CodexAccountCard';
import { ProjectDirCard } from './ProjectDirCard';
import { useTranslation } from '@/hooks/useTranslation';
import type { SetupCardStatus } from '@/types';

interface SetupCenterProps {
  onClose: () => void;
  initialCard?: 'codex' | 'project' | 'claude' | 'provider';
}

export function SetupCenter({ onClose, initialCard }: SetupCenterProps) {
  const { t } = useTranslation();
  const [codexStatus, setCodexStatus] = useState<SetupCardStatus>('not-configured');
  const [projectStatus, setProjectStatus] = useState<SetupCardStatus>('not-configured');
  const [defaultProject, setDefaultProject] = useState<string | undefined>();
  // Snapshot of the done/skipped count at the moment SetupCenter opened.
  // Auto-close only fires when the user *made progress* this session —
  // i.e. went from N<2 to 2. Users who manually open SetupCenter at 2/2
  // keep the modal visible until they close it themselves.
  const initialCompletedCountRef = useRef<number | null>(null);

  // Single helper that every "close the setup center" path goes through.
  // Awaits the PUT so callers that immediately navigate (e.g. Codex account
  // jump to /settings/codex) can guarantee setup_completed is
  // persisted before page change — otherwise the fire-and-forget fetch can
  // be aborted by the unload and the next mount would re-open SetupCenter.
  // `keepalive: true` is belt-and-suspenders for any future path that
  // bypasses the await contract.
  const persistAndClose = useCallback(async () => {
    try {
      await fetch('/api/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: 'completed', status: 'completed' }),
        keepalive: true,
      });
    } catch {
      // Swallow — backend GET /api/setup normalization patches stale state
      // on next mount, so a failed PUT degrades gracefully.
    }
    onClose();
  }, [onClose]);

  // Load initial status
  useEffect(() => {
    Promise.all([
      fetch('/api/setup').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/codex/account', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([setupData, accountData]) => {
        const initialCodexStatus: SetupCardStatus =
          accountData?.state?.kind === 'logged_in' ? 'completed' : 'not-configured';
        const initialProjectStatus: SetupCardStatus = setupData?.project || 'not-configured';
        setCodexStatus(initialCodexStatus);
        setProjectStatus(initialProjectStatus);
        if (setupData?.defaultProject) setDefaultProject(setupData.defaultProject);
        const initial = [initialCodexStatus, initialProjectStatus]
          .filter((s: string) => s === 'completed' || s === 'skipped').length;
        initialCompletedCountRef.current = initial;
      })
      .catch(() => {});
  }, []);

  const completedCount = [codexStatus, projectStatus]
    .filter(s => s === 'completed' || s === 'skipped').length;

  // Auto-close when the user makes progress this session from not-done to
  // 2/2. `initialCompletedCountRef.current < 2` is what distinguishes an
  // onboarding flow ending from a manually-opened modal at 2/2.
  useEffect(() => {
    if (
      completedCount === 2 &&
      initialCompletedCountRef.current !== null &&
      initialCompletedCountRef.current < 2
    ) {
      const timer = setTimeout(persistAndClose, 800);
      return () => clearTimeout(timer);
    }
  }, [completedCount, persistAndClose]);

  // Scroll to initial card
  useEffect(() => {
    if (initialCard) {
      const targetCard = initialCard === 'project' ? 'project' : 'codex';
      const el = document.getElementById(`setup-card-${targetCard}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [initialCard]);

  const handleProjectStatusChange = useCallback((status: SetupCardStatus, _value?: string) => {
    setProjectStatus(status);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-card px-6 pt-6 pb-3 border-b">
          <div>
            <h2 className="text-lg font-semibold">{t('setup.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('setup.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {t('setup.progress', { completed: String(completedCount) })}
            </span>
            <Button variant="ghost" size="sm" className="text-xs" onClick={persistAndClose}>
              {t('setup.skipAndEnter')}
            </Button>
          </div>
        </div>

        {/* Cards */}
        <div className="p-6 space-y-4">
          <WelcomeCard />

          <div id="setup-card-codex">
            <CodexAccountCard
              status={codexStatus}
              onStatusChange={setCodexStatus}
              onBeforeNavigate={persistAndClose}
            />
          </div>

          <div id="setup-card-project">
            <ProjectDirCard
              status={projectStatus}
              onStatusChange={handleProjectStatusChange}
              defaultProject={defaultProject}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
