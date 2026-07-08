'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { SetupCard } from './SetupCard';
import { FolderPicker } from '@/components/chat/FolderPicker';
import { useTranslation } from '@/hooks/useTranslation';
import { useNativeFolderPicker } from '@/hooks/useNativeFolderPicker';
import type { SetupCardStatus } from '@/types';

interface ProjectDirCardProps {
  status: SetupCardStatus;
  onStatusChange: (status: SetupCardStatus, value?: string) => void;
  defaultProject?: string;
}

export function ProjectDirCard({ status, onStatusChange, defaultProject }: ProjectDirCardProps) {
  const { t } = useTranslation();
  const { isElectron, openNativePicker } = useNativeFolderPicker();
  const [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string>(defaultProject || '');

  // Sync selectedPath when defaultProject prop arrives asynchronously
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (defaultProject && !selectedPath) {
      setSelectedPath(defaultProject);
    }
  }, [defaultProject, selectedPath]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    fetch('/api/setup/recent-projects')
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setRecentProjects(data.projects || []))
      .catch(() => {});
  }, []);

  const handleSelect = useCallback(async (path: string) => {
    setSelectedPath(path);
    onStatusChange('completed', path);
    // Persist
    localStorage.setItem('codepilot:last-working-directory', path);
    // Notify other components (e.g. /chat page) that a project directory was selected
    window.dispatchEvent(new CustomEvent('project-directory-changed', { detail: { path } }));
    try {
      await fetch('/api/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: 'project', status: 'completed', value: path }),
      });
    } catch { /* ignore */ }
  }, [onStatusChange]);

  const handleBrowse = useCallback(async () => {
    if (isElectron) {
      const path = await openNativePicker({ title: t('folderPicker.title') });
      if (path) handleSelect(path);
    } else {
      setFolderPickerOpen(true);
    }
  }, [isElectron, openNativePicker, t, handleSelect]);

  const handleSkip = useCallback(async () => {
    onStatusChange('skipped');
    try {
      await fetch('/api/setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card: 'project', status: 'skipped' }),
      });
    } catch { /* ignore */ }
  }, [onStatusChange]);

  const description = status === 'completed'
    ? `${t('setup.project.selected')}: ${selectedPath}`
    : t('setup.project.description');

  return (
    <>
      <SetupCard
        title={t('setup.project.title')}
        description={description}
        status={status}
        onSkip={status === 'not-configured' ? handleSkip : undefined}
      >
        {status === 'completed' ? (
          <p className="text-xs font-mono truncate">{selectedPath}</p>
        ) : (
          <div className="space-y-3">
            {recentProjects.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">{t('setup.project.recentProjects')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {recentProjects.map(p => {
                    const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
                    return (
                      <Button
                        key={p}
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px] font-mono"
                        onClick={() => handleSelect(p)}
                        title={p}
                      >
                        {name}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
            <Button size="sm" className="text-xs" onClick={handleBrowse}>
              {t('setup.project.selectDirectory')}
            </Button>
          </div>
        )}
      </SetupCard>

      <FolderPicker
        open={folderPickerOpen}
        onOpenChange={setFolderPickerOpen}
        onSelect={handleSelect}
      />
    </>
  );
}
