'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CaretDown } from '@/components/ui/icon';
// LockOpen removed — both lock/lock-open render via CodexWebIcon
// `permission` alias; the open state just gets a red color override.
import { CodexWebIcon } from '@/components/ui/semantic-icon';

interface ChatPermissionSelectorProps {
  sessionId?: string;
  permissionProfile: 'default' | 'full_access';
  onPermissionChange: (profile: 'default' | 'full_access') => void;
}

export function ChatPermissionSelector({
  sessionId,
  permissionProfile,
  onPermissionChange,
}: ChatPermissionSelectorProps) {
  const { t } = useTranslation();
  const [showWarning, setShowWarning] = useState(false);

  const handleSelect = (profile: 'default' | 'full_access') => {
    if (profile === 'full_access' && permissionProfile !== 'full_access') {
      setShowWarning(true);
      return;
    }
    applyChange(profile);
  };

  const applyChange = async (profile: 'default' | 'full_access') => {
    // No sessionId yet (new chat) — local-only update
    if (!sessionId) {
      onPermissionChange(profile);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_profile: profile }),
      });
      if (!res.ok) {
        console.warn(`[ChatPermissionSelector] PATCH failed: ${res.status}`);
        return;
      }
      onPermissionChange(profile);
    } catch (err) {
      console.warn('[ChatPermissionSelector] PATCH error:', err);
    }
  };

  const isFullAccess = permissionProfile === 'full_access';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'h-7 rounded-md',
              isFullAccess
                // full_access is a dangerous override — keep the chip
                // visible at full weight. Override ghost's hover so the
                // chip doesn't flash to neutral accent.
                ? 'text-xs font-medium border-status-error-foreground/30 bg-status-error-muted text-status-error-foreground hover:bg-status-error-muted hover:text-status-error-foreground'
                // Default permission sits at the same muted-foreground
                // grey as the mode select beside it; the only weight
                // difference is `font-normal` (vs the mode select's
                // `font-medium`). Going faded was too much — the user
                // still needs to read the label without squinting.
                : 'text-xs font-normal text-muted-foreground',
            )}
          >
            {isFullAccess ? (
              <CodexWebIcon name="permission" size={12} className="text-status-error-foreground" aria-hidden />
            ) : (
              <CodexWebIcon name="permission" size={12} aria-hidden />
            )}
            <span>
              {isFullAccess ? t('permission.fullAccess') : t('permission.default')}
            </span>
            <CaretDown size={10} className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[240px]">
          <DropdownMenuItem onClick={() => handleSelect('default')} className="items-start py-2">
            <CodexWebIcon name="permission" size="sm" className="mt-0.5" aria-hidden />
            <div className="flex flex-col items-start gap-0.5">
              <span>{t('permission.default')}</span>
              <span className="text-[11px] text-muted-foreground leading-tight">
                {t('permission.defaultDesc' as TranslationKey)}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleSelect('full_access')} className="items-start py-2">
            <CodexWebIcon name="permission" size="sm" className="mt-0.5 text-status-error-foreground" aria-hidden />
            <div className="flex flex-col items-start gap-0.5">
              <span className="text-status-error-foreground">{t('permission.fullAccess')}</span>
              <span className="text-[11px] text-status-error-foreground/70 leading-tight">
                {t('permission.fullAccessDesc' as TranslationKey)}
              </span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('permission.fullAccess')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('permission.fullAccessWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setShowWarning(false);
                applyChange('full_access');
              }}
            >
              {t('permission.fullAccess')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
