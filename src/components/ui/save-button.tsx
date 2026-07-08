"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * SaveButton — three-state save affordance.
 *
 *   saved  (default + no edits): disabled, shows "已保存" / "Saved"
 *   dirty  (user has edits):     enabled,  shows "保存"   / "Save"
 *   saving (request in flight):  disabled, shows spinner + "保存中…" / "Saving…"
 *
 * Why three states (not just disabled / enabled): users want a passive
 * confirmation that their last save stuck. A button that just disappears
 * after save leaves them guessing; a button that stays "Save" forever
 * looks broken.
 *
 * Consumers track `dirty` themselves — typically by diffing current form
 * state against a `useRef` snapshot of the last successful save. On
 * successful save: refresh the snapshot, set saving=false → returns to
 * saved state automatically.
 */
export interface SaveButtonProps
  extends Omit<React.ComponentProps<typeof Button>, "children" | "onClick"> {
  dirty: boolean;
  saving: boolean;
  onClick: () => void;
  /** Label when there are unsaved changes. Default: `t('common.save')`. */
  label?: React.ReactNode;
  /** Label when up to date. Default: `t('common.saved')`. */
  savedLabel?: React.ReactNode;
  /** Label while saving (next to spinner). Default: `t('common.saving')`. */
  savingLabel?: React.ReactNode;
  /**
   * Hard-disable from the consumer (e.g. form has validation errors).
   * Final disabled = `saving || !dirty || disabled`. Text still follows
   * dirty/saving so the user sees "保存" not "已保存" — i.e. "you have
   * unsaved changes but can't save yet" stays a true statement.
   */
  disabled?: boolean;
}

export function SaveButton({
  dirty,
  saving,
  onClick,
  label,
  savedLabel,
  savingLabel,
  disabled = false,
  size = "sm",
  type = "button",
  ...buttonProps
}: SaveButtonProps) {
  const { t } = useTranslation();
  const text = saving
    ? (savingLabel ?? t("common.saving"))
    : dirty
      ? (label ?? t("common.save"))
      : (savedLabel ?? t("common.saved"));
  return (
    <Button
      type={type}
      size={size}
      onClick={onClick}
      disabled={saving || !dirty || disabled}
      {...buttonProps}
    >
      {saving && <SpinnerGap size={14} className="animate-spin" />}
      {text}
    </Button>
  );
}
