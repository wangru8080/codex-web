"use client";

import { useState, useCallback } from "react";
import { X, ArrowsInLineVertical } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePanel } from "@/hooks/usePanel";
import { useTerminal } from "@/hooks/useTerminal";
import { useTranslation } from "@/hooks/useTranslation";
import { TerminalInstance } from "./TerminalInstance";

const DEFAULT_HEIGHT = 250;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

export function TerminalDrawer() {
  const { terminalOpen, setTerminalOpen } = usePanel();
  const terminal = useTerminal();
  const { t } = useTranslation();
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [height]);

  if (!terminalOpen) return null;

  return (
    <div className="shrink-0 border-t border-border/40 bg-background" style={{ height }}>
      {/* Resize handle */}
      <div
        className="h-1 cursor-row-resize hover:bg-primary/20 transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-border/40">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('terminal.title')}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => setHeight(DEFAULT_HEIGHT)}>
            <ArrowsInLineVertical size={12} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => setTerminalOpen(false)}>
            <X size={12} />
            <span className="sr-only">{t('terminal.close')}</span>
          </Button>
        </div>
      </div>

      {/* Terminal body */}
      <div className="h-[calc(100%-2.25rem-0.25rem)] overflow-hidden">
        {terminal.isElectron ? (
          <TerminalInstance terminal={terminal} />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {t('terminal.notAvailable')}
          </div>
        )}
      </div>
    </div>
  );
}
