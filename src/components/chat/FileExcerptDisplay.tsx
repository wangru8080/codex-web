import { CodexWebIcon } from "@/components/ui/semantic-icon";
import type { FileExcerptDisplayReference } from "@/lib/file-excerpt-reference";

export function FileExcerptDisplay({
  references,
}: {
  references: readonly FileExcerptDisplayReference[];
}) {
  if (references.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {references.map((reference) => {
        const lineRange = reference.startLine && reference.endLine
          ? `${reference.startLine}-${reference.endLine}`
          : null;
        return (
          <div
            key={reference.id}
            data-message-file-excerpt={reference.path}
            title={reference.path}
            className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5 text-xs text-foreground shadow-sm"
          >
            <CodexWebIcon name="file_code" size={14} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-[220px] truncate font-medium">{reference.name}</span>
            {lineRange && <span className="shrink-0 text-muted-foreground">{lineRange}</span>}
          </div>
        );
      })}
    </div>
  );
}
