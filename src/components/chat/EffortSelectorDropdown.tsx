'use client';

import { useRef, useState, useEffect } from 'react';
import { CaretDown } from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import {
  CommandList,
  CommandListItem,
  CommandListGroup,
} from '@/components/patterns';

interface EffortSelectorDropdownProps {
  selectedEffort: string;
  onEffortChange: (effort: string) => void;
  supportedEffortLevels?: string[];
}

export function EffortSelectorDropdown({
  selectedEffort,
  onEffortChange,
  supportedEffortLevels,
}: EffortSelectorDropdownProps) {
  const { t } = useTranslation();
  const effortMenuRef = useRef<HTMLDivElement>(null);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);

  // The dropdown always surfaces an 'auto' option first. When selected, the
  // caller interprets it as "no explicit effort" and sends undefined to the
  // backend, letting Claude Code's per-model default apply (xhigh for Opus
  // 4.7, high for Sonnet, etc.). Without this, the button could display
  // a specific level (e.g. 'High') while the request actually sent
  // undefined, which user-visibly lied about what was being paid for.
  const baseLevels = supportedEffortLevels || ['low', 'medium', 'high', 'xhigh', 'max'];
  const levels = ['auto', ...baseLevels];

  // Close effort menu on outside click
  useEffect(() => {
    if (!effortMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (effortMenuRef.current && !effortMenuRef.current.contains(e.target as Node)) {
        setEffortMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [effortMenuOpen]);

  return (
    <div className="relative" ref={effortMenuRef}>
      <PromptInputButton
        onClick={() => setEffortMenuOpen((prev) => !prev)}
      >
        <span className="text-xs">{t(`messageInput.effort.${selectedEffort}` as TranslationKey)}</span>
        <CaretDown size={10} className={cn("transition-transform duration-200", effortMenuOpen && "rotate-180")} />
      </PromptInputButton>

      {effortMenuOpen && (
        <CommandList className="w-36 mb-1.5 rounded-lg">
          <CommandListGroup label={t('messageInput.effort.label' as TranslationKey)}>
            <div className="py-0.5">
              {levels.map((level) => (
                <CommandListItem
                  key={level}
                  active={selectedEffort === level}
                  onClick={() => {
                    onEffortChange(level);
                    setEffortMenuOpen(false);
                  }}
                >
                  {/* Round 16: removed trailing `&#10003;` checkmark.
                      `active` prop styles the row already; the
                      duplicate glyph was redundant and pushed the row
                      to `justify-between`, misaligned with the other
                      composer dropdowns. */}
                  <span className="text-xs">{t(`messageInput.effort.${level}` as TranslationKey)}</span>
                </CommandListItem>
              ))}
            </div>
          </CommandListGroup>
        </CommandList>
      )}
    </div>
  );
}
