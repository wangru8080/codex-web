'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { PlannerItem } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'];
const RESOLUTIONS = ['1K', '2K', '4K'];

interface BatchPlanRowProps {
  item: PlannerItem;
  index: number;
  onUpdate: (index: number, updates: Partial<PlannerItem>) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function BatchPlanRow({ item, index, onUpdate, onRemove, disabled }: BatchPlanRowProps) {
  const { t } = useTranslation();

  return (
    <div className="group rounded-lg border border-border/60 bg-background p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="mt-1 text-xs text-muted-foreground font-mono shrink-0 w-6 text-right">
          #{index + 1}
        </span>
        <div className="flex-1 min-w-0">
          {/* Prompt */}
          <Textarea
            value={item.prompt}
            onChange={e => onUpdate(index, { prompt: e.target.value })}
            className="border-border/40 bg-transparent px-2 py-1.5 text-sm resize-none"
            rows={2}
            disabled={disabled}
            placeholder={t('batchImageGen.prompt' as TranslationKey)}
          />

          {/* Controls Row */}
          <div className="flex items-center gap-2 mt-1.5">
            {/* Aspect Ratio + Resolution — shadcn Select (uniform with
                the rest of the app and styles correctly under dark
                mode; native <select> picks up OS chrome). */}
            <Select
              value={item.aspectRatio}
              onValueChange={(value) => onUpdate(index, { aspectRatio: value })}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs px-2 w-auto gap-1 border-border/40 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_RATIOS.map(r => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={item.resolution}
              onValueChange={(value) => onUpdate(index, { resolution: value })}
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs px-2 w-auto gap-1 border-border/40 bg-transparent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map(r => (
                  <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Tags */}
            {item.tags.length > 0 && (
              <div className="flex items-center gap-1 overflow-hidden">
                {item.tags.map((tag, i) => (
                  <span key={i} className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1" />

            {/* Remove */}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onRemove(index)}
              disabled={disabled}
              className="text-[10px] text-muted-foreground hover:text-status-error-foreground opacity-0 group-hover:opacity-100 disabled:opacity-0 h-auto p-0"
            >
              {t('batchImageGen.removeItem' as TranslationKey)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
