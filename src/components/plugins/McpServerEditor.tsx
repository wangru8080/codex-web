'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import type { MCPServer } from '@/types';
import {
  McpServerEditorForm,
  type McpServerEditorFormHandle,
} from './McpServerEditorForm';

/**
 * Add-server Dialog (toolbar entry: "+ 添加 MCP 服务器"). Wraps the
 * shared `<McpServerEditorForm>` in a Dialog. The card-edit flow no
 * longer reaches this component — clicking a server card opens
 * `<McpServerDetailDialog>` which has its own in-place edit view that
 * also reuses `<McpServerEditorForm>`.
 */
interface McpServerEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name?: string;
  server?: MCPServer;
  onSave: (name: string, server: MCPServer) => void;
}

export function McpServerEditor({
  open,
  onOpenChange,
  name: initialName,
  server: initialServer,
  onSave,
}: McpServerEditorProps) {
  const { t } = useTranslation();
  const isEditing = !!initialName;
  const formRef = useRef<McpServerEditorFormHandle>(null);
  // Bump on every open so the form re-seeds from initial props even
  // when the consumer mounts the Dialog persistently.
  const [openCount, setOpenCount] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpenCount((n) => n + 1);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isEditing ? `${t('mcp.editServer')}: ${initialName}` : t('mcp.addServer')}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t('mcp.editorDescription' as TranslationKey)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto mt-4">
          <McpServerEditorForm
            ref={formRef}
            initialName={initialName}
            initialServer={initialServer}
            isEditing={isEditing}
            resetKey={openCount}
            onSave={(name, server) => {
              onSave(name, server);
              onOpenChange(false);
            }}
          />
        </div>

        <DialogFooter className="shrink-0 border-t border-border/50 pt-3 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => formRef.current?.submit()}>
            {isEditing ? t('mcp.saveChanges') : t('mcp.addServer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
