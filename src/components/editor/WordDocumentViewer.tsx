"use client";

import { useEffect, useRef, useState } from "react";
import { SpinnerGap } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";

type LoadState = "loading" | "ready" | "error";

function extensionOf(path: string): string {
  return path.slice(path.lastIndexOf(".")).toLowerCase();
}

function legacyDocumentHtml(css: string, html: string): string {
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:"><style>html,body{margin:0;min-height:100%;background:#f5f5f4}body{padding:24px}.msdoc-root{box-sizing:border-box;max-width:816px;min-height:1056px;margin:0 auto;padding:72px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.16);color:#111827}${safeCss}</style></head><body><div class="msdoc-root">${html}</div></body></html>`;
}

export function WordDocumentViewer({
  bytes,
  filePath,
}: {
  bytes: Uint8Array<ArrayBuffer>;
  filePath: string;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [legacyHtml, setLegacyHtml] = useState("");
  const isLegacy = extensionOf(filePath) === ".doc";

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setLegacyHtml("");
    rootRef.current?.replaceChildren();

    async function renderDocument() {
      try {
        if (isLegacy) {
          const { parseMsDoc, renderMsDoc } = await import("@file-viewer/doc");
          const parsed = parseMsDoc(bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ));
          const rendered = renderMsDoc(parsed);
          if (!cancelled) setLegacyHtml(legacyDocumentHtml(rendered.css, rendered.html));
        } else {
          const { renderAsync } = await import("docx-preview");
          const mount = document.createElement("div");
          await renderAsync(bytes, mount, mount, {
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderAltChunks: false,
            useBase64URL: true,
          });
          if (cancelled) return;
          for (const anchor of mount.querySelectorAll<HTMLAnchorElement>("a[href]")) {
            const href = anchor.getAttribute("href") ?? "";
            if (!/^(?:https?:|mailto:|#)/i.test(href)) anchor.removeAttribute("href");
            anchor.setAttribute("rel", "noreferrer noopener");
          }
          rootRef.current?.replaceChildren(mount);
        }
        if (!cancelled) setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void renderDocument();
    return () => {
      cancelled = true;
    };
  }, [bytes, isLegacy]);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-stone-100 dark:bg-neutral-900">
      {isLegacy && (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          {t("filePreview.legacyDocNotice")}
        </div>
      )}
      {state === "loading" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        </div>
      )}
      {state === "error" && (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
          {t("filePreview.documentParseFailed")}
        </div>
      )}
      {isLegacy ? (
        legacyHtml ? (
          <iframe
            sandbox=""
            srcDoc={legacyHtml}
            title={filePath.split(/[/\\]/).pop() || filePath}
            className="min-h-0 w-full flex-1 border-0"
          />
        ) : null
      ) : (
        <div ref={rootRef} className="min-h-0 flex-1 overflow-auto p-4 [&_.docx-wrapper]:min-h-full [&_.docx-wrapper]:!items-start [&_.docx-wrapper]:bg-stone-100 dark:[&_.docx-wrapper]:bg-neutral-900" />
      )}
    </div>
  );
}
