'use client';

import { useEffect, useState } from 'react';
import { Target } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

type GoalEditDialogProps = {
  open: boolean;
  objective: string;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (objective: string) => void | Promise<void>;
};

export function GoalEditDialog({
  open,
  objective,
  pending,
  onOpenChange,
  onSave,
}: GoalEditDialogProps) {
  const [value, setValue] = useState(objective);

  useEffect(() => {
    if (open) setValue(objective);
  }, [objective, open]);

  const trimmed = value.trim();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <DialogContent className="gap-5 sm:max-w-xl">
        <DialogHeader className="gap-3">
          <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
            <Target size={26} aria-hidden />
          </div>
          <DialogTitle className="text-2xl">编辑目标</DialogTitle>
          <DialogDescription className="sr-only">修改当前目标内容</DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={pending}
          aria-label="目标内容"
          className="min-h-72 resize-none text-base leading-7"
        />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={pending || !trimmed || trimmed === objective.trim()}
            onClick={() => onSave(trimmed)}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
