'use client';

import { CodexWebIcon } from "@/components/ui/semantic-icon";
import { formatFileSize } from '@/types';

interface FileCardProps {
  name: string;
  size: number;
}

export function FileCard({ name, size }: FileCardProps) {
  return (
    <div className="rounded-lg border bg-muted/50 p-3 flex items-center gap-3">
      <CodexWebIcon name="file" size="lg" className="text-muted-foreground shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">{name}</div>
        <div className="text-xs text-muted-foreground">{formatFileSize(size)}</div>
      </div>
    </div>
  );
}
