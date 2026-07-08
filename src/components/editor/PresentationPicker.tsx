"use client";

/**
 * Markdown → HTML presentation template picker — Phase 4.C.
 *
 * Compact popover that lets the user pick one of the article / report /
 * brief / pitch templates. The Markdown PreviewPanel mounts this as a
 * small panel under the "生成展示版" button; on confirm it calls
 * `onGenerate(templateId)` and closes.
 */

import { useState } from "react";
import {
  PRESENTATION_TEMPLATES,
  type PresentationTemplateId,
} from "@/lib/markdown/presentation-templates";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";

interface PresentationPickerProps {
  initial?: PresentationTemplateId;
  onGenerate: (templateId: PresentationTemplateId) => void;
  onCancel: () => void;
}

export function PresentationPicker({
  initial,
  onGenerate,
  onCancel,
}: PresentationPickerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PresentationTemplateId>(
    initial ?? "article",
  );
  return (
    <div className="absolute right-2 top-9 z-20 w-64 rounded-md border border-border/60 bg-popover p-3 shadow-md">
      <p className="mb-2 text-[11px] font-medium text-foreground">
        {t("presentation.pickerTitle")}
      </p>
      <ul className="mb-3 space-y-1">
        {PRESENTATION_TEMPLATES.map((tpl) => (
          <li key={tpl.id}>
            <button
              type="button"
              onClick={() => setSelected(tpl.id)}
              className={
                "flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left transition-colors " +
                (selected === tpl.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/60")
              }
            >
              <span className="text-[11px] font-semibold">{tpl.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {tpl.description}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={onCancel} className="text-[11px]">
          {t("presentation.cancel")}
        </Button>
        <Button
          size="xs"
          variant="default"
          onClick={() => onGenerate(selected)}
          className="text-[11px]"
        >
          {t("presentation.generate")}
        </Button>
      </div>
    </div>
  );
}
