'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Confirmation,
  ConfirmationTitle,
  ConfirmationRequest,
  ConfirmationAccepted,
  ConfirmationRejected,
  ConfirmationActions,
  ConfirmationAction,
} from '@/components/ai-elements/confirmation';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ToolUIPart } from 'ai';
import type { PermissionRequestEvent } from '@/types';

interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

interface PermissionPromptProps {
  pendingPermission: PermissionRequestEvent | null;
  // 'timeout' = registry auto-denied after the 5-min window (A5 Step 2),
  // rendered distinctly from a manual 'deny'.
  permissionResolved: 'allow' | 'deny' | 'timeout' | null;
  onPermissionResponse: (decision: 'allow' | 'allow_session' | 'deny', updatedInput?: Record<string, unknown>, denyMessage?: string) => void;
  toolUses?: ToolUseInfo[];
}

/** Max lines to show in the tool input area before collapsing */
const MAX_INPUT_LINES = 8;
const MAX_INPUT_CHARS = 500;

function AskUserQuestionUI({
  toolInput,
  onSubmit,
}: {
  toolInput: Record<string, unknown>;
  onSubmit: (decision: 'allow', updatedInput: Record<string, unknown>) => void;
}) {
  const questions = (toolInput.questions || []) as Array<{
    question: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect: boolean;
    header?: string;
  }>;

  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [useOther, setUseOther] = useState<Record<string, boolean>>({});

  const toggleOption = (qIdx: string, label: string, multi: boolean) => {
    setSelections((prev) => {
      const current = new Set(prev[qIdx] || []);
      if (multi) {
        if (current.has(label)) { current.delete(label); } else { current.add(label); }
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [qIdx]: current };
    });
    setUseOther((prev) => ({ ...prev, [qIdx]: false }));
  };

  const toggleOther = (qIdx: string, multi: boolean) => {
    if (!multi) {
      setSelections((prev) => ({ ...prev, [qIdx]: new Set() }));
    }
    setUseOther((prev) => ({ ...prev, [qIdx]: !prev[qIdx] }));
  };

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    questions.forEach((q, i) => {
      const qIdx = String(i);
      const selected = Array.from(selections[qIdx] || []);
      if (useOther[qIdx] && otherTexts[qIdx]?.trim()) {
        selected.push(otherTexts[qIdx].trim());
      }
      answers[q.question] = selected.join(', ');
    });
    onSubmit('allow', { questions: toolInput.questions, answers });
  };

  // Require ALL questions to be answered before enabling Submit.
  // `some` would allow partial submissions where unanswered questions
  // produce empty-string answers — the model would continue as if the
  // interview completed when it actually didn't.
  const hasAnswer = questions.length > 0 && questions.every((_, i) => {
    const qIdx = String(i);
    return (selections[qIdx]?.size || 0) > 0 || (useOther[qIdx] && !!otherTexts[qIdx]?.trim());
  });

  return (
    <div className="space-y-4 py-2">
      {questions.map((q, i) => {
        const qIdx = String(i);
        const selected = selections[qIdx] || new Set<string>();
        return (
          <div key={qIdx} className="space-y-2">
            {q.header && (
              <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {q.header}
              </span>
            )}
            <p className="text-sm font-medium">{q.question}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) => {
                const isSelected = selected.has(opt.label);
                return (
                  <Button
                    key={opt.label}
                    variant="outline"
                    size="sm"
                    onClick={() => toggleOption(qIdx, opt.label, q.multiSelect)}
                    className={isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground hover:bg-muted'
                    }
                    title={opt.description}
                  >
                    {q.multiSelect && (
                      <span className="mr-1.5">{isSelected ? '☑' : '☐'}</span>
                    )}
                    {opt.label}
                  </Button>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleOther(qIdx, q.multiSelect)}
                className={useOther[qIdx]
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-foreground hover:bg-muted'
                }
              >
                Other
              </Button>
            </div>
            {useOther[qIdx] && (
              <Input
                type="text"
                placeholder="Type your answer..."
                value={otherTexts[qIdx] || ''}
                onChange={(e) => setOtherTexts((prev) => ({ ...prev, [qIdx]: e.target.value }))}
                className="text-xs"
                autoFocus
              />
            )}
          </div>
        );
      })}
      <Button
        onClick={handleSubmit}
        disabled={!hasAnswer}
        size="sm"
      >
        Submit
      </Button>
    </div>
  );
}

function extractPlanFilePath(toolUses: ToolUseInfo[]): string | null {
  for (let i = toolUses.length - 1; i >= 0; i--) {
    const tool = toolUses[i];
    const input = tool.input as Record<string, unknown>;
    if ((tool.name === 'Write' || tool.name === 'Edit') && typeof input.file_path === 'string') {
      const fp = input.file_path;
      if (fp.endsWith('.md') && (fp.includes('plans/') || fp.includes('plans\\'))) {
        return fp;
      }
    }
  }
  return null;
}

function ExitPlanModeUI({
  toolInput,
  toolUses,
  onApprove,
  onDeny,
  onDenyWithMessage,
}: {
  toolInput: Record<string, unknown>;
  toolUses: ToolUseInfo[];
  onApprove: () => void;
  onDeny: () => void;
  onDenyWithMessage: (message: string) => void;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const planFilePath = extractPlanFilePath(toolUses);
  const allowedPrompts = (toolInput.allowedPrompts || []) as Array<{
    tool: string;
    prompt: string;
  }>;

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <span className="text-sm font-medium">Plan complete — ready to execute</span>
      </div>
      {allowedPrompts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Requested permissions:</p>
          <ul className="space-y-0.5">
            {allowedPrompts.map((p, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p.tool}</span>
                <span>{p.prompt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onDeny}
          className="text-xs"
        >
          Reject
        </Button>
        {planFilePath && (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              setPlanLoading(true);
              try {
                const res = await fetch(`/api/files/preview?path=${encodeURIComponent(planFilePath)}&maxLines=1000`);
                if (res.ok) {
                  const data = await res.json();
                  setPlanContent(data.preview?.content || 'Failed to load plan');
                } else {
                  setPlanContent('Failed to load plan file');
                }
              } catch {
                setPlanContent('Failed to load plan file');
              }
              setPlanLoading(false);
              setPlanOpen(true);
            }}
            disabled={planLoading}
            className="border-primary/30 text-xs text-primary hover:bg-primary/10"
          >
            {planLoading ? 'Loading...' : 'View Plan'}
          </Button>
        )}
        <Button
          size="sm"
          onClick={onApprove}
          className="text-xs"
        >
          Approve & Execute
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          type="text"
          placeholder="Provide feedback on the plan..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && feedback.trim()) {
              onDenyWithMessage(feedback.trim());
            }
          }}
          className="flex-1 text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (feedback.trim()) onDenyWithMessage(feedback.trim());
          }}
          disabled={!feedback.trim()}
          className="text-xs"
        >
          Do this instead
        </Button>
      </div>

      {planOpen && planContent && (
        <Dialog open={planOpen} onOpenChange={setPlanOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle>Plan</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto mt-4">
              <MessageResponse>{planContent}</MessageResponse>
            </div>
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/**
 * Collapsible tool input display with truncation for long content.
 */
function ToolInputDisplay({ input }: { input: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const formatToolInput = (inp: Record<string, unknown>): string => {
    // For Bash, show command prominently
    if (inp.command) {
      const cmd = String(inp.command);
      // If there are other keys besides command/description, show full JSON
      const extraKeys = Object.keys(inp).filter(k => k !== 'command' && k !== 'description');
      if (extraKeys.length > 0) {
        return JSON.stringify(inp, null, 2);
      }
      return cmd;
    }
    // For Write/Edit, show the full input so content/old_string/new_string are visible
    if (inp.file_path) {
      const keys = Object.keys(inp);
      if (keys.length === 1) return String(inp.file_path);
      return JSON.stringify(inp, null, 2);
    }
    if (inp.path) {
      const keys = Object.keys(inp);
      if (keys.length === 1) return String(inp.path);
      return JSON.stringify(inp, null, 2);
    }
    return JSON.stringify(inp, null, 2);
  };

  const formatted = formatToolInput(input);
  const lineCount = formatted.split('\n').length;
  const isTruncated = lineCount > MAX_INPUT_LINES || formatted.length > MAX_INPUT_CHARS;

  const displayText = !expanded && isTruncated
    ? formatted.slice(0, MAX_INPUT_CHARS).split('\n').slice(0, MAX_INPUT_LINES).join('\n') + '\n…'
    : formatted;

  return (
    <div className="mt-1 overflow-hidden rounded bg-muted/50">
      <pre className={cn(
        "overflow-x-auto whitespace-pre-wrap break-all px-3 py-2 font-mono text-xs",
        !expanded && "max-h-[10rem]"
      )}>
        {displayText}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          {expanded ? '▲ Collapse' : '▼ Show more'}
        </button>
      )}
    </div>
  );
}

export function PermissionPrompt({
  pendingPermission,
  permissionResolved,
  onPermissionResponse,
  toolUses = [],
}: PermissionPromptProps) {
  const { t } = useTranslation();

  // Nothing to show
  if (!pendingPermission && !permissionResolved) return null;

  // Only show the resolved status text (not the full UI) when already resolved.
  // This prevents stacking — once resolved, we show a minimal status line that
  // auto-hides quickly (the stream-session-manager clears it after 1s).
  const isResolved = !!permissionResolved;

  const getConfirmationState = (): ToolUIPart['state'] => {
    if (permissionResolved) return 'approval-responded';
    if (pendingPermission) return 'approval-requested';
    return 'input-available';
  };

  const getApproval = () => {
    if (!pendingPermission && !permissionResolved) return undefined;
    if (permissionResolved === 'allow') {
      return { id: pendingPermission?.permissionRequestId || '', approved: true as const };
    }
    // timeout is an auto-deny → render as not-approved, same as a manual deny.
    if (permissionResolved === 'deny' || permissionResolved === 'timeout') {
      return { id: pendingPermission?.permissionRequestId || '', approved: false as const };
    }
    return { id: pendingPermission?.permissionRequestId || '' };
  };

  return (
    <div className="mx-auto w-full max-w-3xl border-t border-border bg-background px-4 py-3 max-h-[50vh] overflow-y-auto">
      {/* ExitPlanMode */}
      {pendingPermission?.toolName === 'ExitPlanMode' && !isResolved && (
        <ExitPlanModeUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          toolUses={toolUses}
          onApprove={() => onPermissionResponse('allow')}
          onDeny={() => onPermissionResponse('deny')}
          onDenyWithMessage={(msg) => onPermissionResponse('deny', undefined, msg)}
        />
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'allow' && (
        <p className="py-1 text-xs text-status-success-foreground">Plan approved — executing</p>
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'deny' && (
        <p className="py-1 text-xs text-status-error-foreground">Plan rejected</p>
      )}
      {pendingPermission?.toolName === 'ExitPlanMode' && permissionResolved === 'timeout' && (
        <p className="py-1 text-xs text-status-error-foreground">{t('streaming.permissionTimedOut')}</p>
      )}

      {/* AskUserQuestion */}
      {pendingPermission?.toolName === 'AskUserQuestion' && !isResolved && (
        <AskUserQuestionUI
          toolInput={pendingPermission.toolInput as Record<string, unknown>}
          onSubmit={(decision, updatedInput) => onPermissionResponse(decision, updatedInput)}
        />
      )}
      {pendingPermission?.toolName === 'AskUserQuestion' && isResolved && (
        <p className={cn(
          "py-1 text-xs",
          permissionResolved === 'timeout' ? 'text-status-error-foreground' : 'text-status-success-foreground'
        )}>
          {permissionResolved === 'timeout' ? t('streaming.permissionTimedOut') : 'Answer submitted'}
        </p>
      )}

      {/* Generic confirmation for other tools — only show when not yet resolved */}
      {pendingPermission?.toolName !== 'AskUserQuestion' && pendingPermission?.toolName !== 'ExitPlanMode' && pendingPermission && !isResolved && (
        <Confirmation
          approval={getApproval()}
          state={getConfirmationState()}
        >
          <ConfirmationTitle>
            <span className="font-medium">{pendingPermission.toolName}</span>
            {pendingPermission.decisionReason && (
              <span className="text-muted-foreground ml-2">
                — {pendingPermission.decisionReason}
              </span>
            )}
          </ConfirmationTitle>

          <ToolInputDisplay input={pendingPermission.toolInput} />

          <ConfirmationRequest>
            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                data-testid="app-server-approval-deny"
                onClick={() => onPermissionResponse('deny')}
              >
                Deny
              </ConfirmationAction>
              <ConfirmationAction
                variant="outline"
                onClick={() => onPermissionResponse('allow')}
              >
                Allow Once
              </ConfirmationAction>
              {pendingPermission.suggestions && pendingPermission.suggestions.length > 0 && (
                <ConfirmationAction
                  variant="default"
                  onClick={() => onPermissionResponse('allow_session')}
                >
                  {t('streaming.allowForSession')}
                </ConfirmationAction>
              )}
            </ConfirmationActions>
          </ConfirmationRequest>

          <ConfirmationAccepted>
            <p className="text-xs text-status-success-foreground">{t('streaming.allowed')}</p>
          </ConfirmationAccepted>

          <ConfirmationRejected>
            <p className="text-xs text-status-error-foreground">{t('streaming.denied')}</p>
          </ConfirmationRejected>
        </Confirmation>
      )}

      {/* Resolved status for generic tools — minimal one-liner */}
      {pendingPermission?.toolName !== 'AskUserQuestion' && pendingPermission?.toolName !== 'ExitPlanMode' && isResolved && (
        <p className={cn(
          "py-1 text-xs",
          permissionResolved === 'allow' ? 'text-status-success-foreground' : 'text-status-error-foreground'
        )}>
          {permissionResolved === 'allow'
            ? t('streaming.allowed')
            : permissionResolved === 'timeout'
              ? t('streaming.permissionTimedOut')
              : t('streaming.denied')}
        </p>
      )}
    </div>
  );
}
