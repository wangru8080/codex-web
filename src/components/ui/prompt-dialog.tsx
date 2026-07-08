"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Replacement for `window.prompt()`, which is disabled in Electron renderers
 * and throws `TypeError: prompt() is not supported`.
 *
 * See docs/exec-plans/active/v0.48-post-release-issues.md §5.6 and the
 * history behind issue JAVASCRIPT-NEXTJS-C for context.
 *
 * Usage (controlled):
 *   const [open, setOpen] = useState(false);
 *   <PromptDialog
 *     open={open}
 *     onOpenChange={setOpen}
 *     title={t('chatList.renameConversation')}
 *     defaultValue={session.title}
 *     confirmLabel={t('common.confirm')}
 *     cancelLabel={t('common.cancel')}
 *     onConfirm={(value) => onRename(session.id, value)}
 *   />
 *
 * - Enter submits the form.
 * - Escape closes the dialog (via Radix Dialog's default behavior).
 * - Input is auto-focused and its contents are selected on open.
 * - `onConfirm` may throw; the dialog stays open and shows the error.
 */
export interface PromptDialogProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the dialog requests a close (cancel button, Esc, overlay click, or after successful confirm). */
  onOpenChange: (open: boolean) => void;
  /** Dialog title. Required — always pass a translated string. */
  title: string;
  /** Optional secondary text shown under the title. */
  description?: string;
  /** Initial value for the input. Defaults to empty string. */
  defaultValue?: string;
  /** Input placeholder shown when the value is empty. */
  placeholder?: string;
  /** Label for the confirm (primary) button. Required — always pass a translated string. */
  confirmLabel: string;
  /** Label for the cancel (secondary) button. Required — always pass a translated string. */
  cancelLabel: string;
  /**
   * Called with the trimmed (if `trimOnConfirm`) input value when the user
   * confirms. If it returns a Promise, the confirm button shows a pending
   * state until it resolves. If it throws, the error message is shown inline
   * and the dialog stays open.
   */
  onConfirm: (value: string) => void | Promise<void>;
  /**
   * Optional synchronous validator. Return a non-empty string to block
   * submission and show the message inline, or `undefined` / empty to allow.
   */
  validate?: (value: string) => string | undefined;
  /** Disallow submitting an empty (trimmed) value. Defaults to true. */
  requireValue?: boolean;
  /** HTML maxLength on the input. Defaults to 200. */
  maxLength?: number;
  /** Input type. Defaults to "text". */
  inputType?: "text" | "password";
  /** Whether to trim the value before passing to onConfirm / validate. Defaults to true. */
  trimOnConfirm?: boolean;
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  defaultValue = "",
  placeholder,
  confirmLabel,
  cancelLabel,
  onConfirm,
  validate,
  requireValue = true,
  maxLength = 200,
  inputType = "text",
  trimOnConfirm = true,
}: PromptDialogProps) {
  const [value, setValue] = React.useState(defaultValue);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reset state every time the dialog opens. Depends on `defaultValue` too so
  // that a caller passing a fresh value reuses the same dialog instance.
  React.useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    setError(null);
    setSubmitting(false);
  }, [open, defaultValue]);

  const normalized = trimOnConfirm ? value.trim() : value;
  const canSubmit = !submitting && (!requireValue || normalized.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    if (validate) {
      const err = validate(normalized);
      if (err) {
        setError(err);
        return;
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      await onConfirm(normalized);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  // Take over Radix's initial focus so we can focus + select the input.
  // Radix fires `onOpenAutoFocus` after it has moved focus to the dialog
  // content; preventDefault cancels that move, then we focus the input.
  const handleOpenAutoFocus = (e: Event) => {
    e.preventDefault();
    // Defer to next frame to ensure the input is mounted and ready.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {/* Always render DialogDescription to satisfy Radix's a11y
              requirement (otherwise it warns "Missing Description or
              aria-describedby for DialogContent"). When no description is
              provided, fall back to the title in a visually-hidden
              description so screen readers still get coverage. */}
          <DialogDescription className={description ? undefined : "sr-only"}>
            {description || title}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              ref={inputRef}
              type={inputType}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
              placeholder={placeholder}
              maxLength={maxLength}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
            />
            {error && (
              <p
                className="text-[11px] text-destructive"
                role="alert"
                aria-live="polite"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
