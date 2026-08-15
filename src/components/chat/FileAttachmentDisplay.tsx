'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { FileUIPart } from 'ai';
import type { FileAttachment } from '@/types';
import { isImageFile } from '@/types';
import { useAppServerActions } from '@/codex-web/AppServerProvider';
import { getCachedMediaObjectUrl } from '@/lib/media-resource-cache';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments';
import { ImageLightbox } from './ImageLightbox';
import { usePanel } from '@/hooks/usePanel';

const DIR_MIME = 'inode/directory';

interface FileAttachmentDisplayProps {
  files: FileAttachment[];
}

/**
 * Build a display URL for a file attachment.
 * - Directories (`inode/directory`) carry no content — return '' so
 *   ai-elements falls back to the Folder icon (set via fallbackIcon).
 * - If base64 `data` is available (optimistic / in-memory): use data URI
 * - A path-only image uses the app-server-loaded Blob URL when available
 */
function fileUrl(f: FileAttachment, pathUrls: Record<string, string> = {}): string {
  if (f.type === DIR_MIME) return '';
  if (f.data) return `data:${f.type};base64,${f.data}`;
  if (f.filePath) return pathUrls[f.filePath] ?? '';
  return '';
}

/**
 * Adapt a FileAttachment (project domain type) into a `FileUIPart` so
 * ai-elements `<Attachment>` can render it. The `id` is also needed by
 * the AttachmentData union — pass it through as a custom field.
 */
function toFileUIPart(file: FileAttachment, url = fileUrl(file)): FileUIPart & { id: string } {
  return {
    id: file.id,
    type: 'file',
    filename: file.name,
    mediaType: file.type,
    url,
  };
}

/**
 * Renders the user-message file attachment row using ai-elements
 * `<Attachments>`. Images use the `grid` variant for a thumbnail strip
 * (click to open lightbox); non-images use the `list` variant for a
 * compact file row with icon + name. ai-elements handles missing-URL
 * fallbacks (file becomes an icon instead of a broken image), so unreadable
 * path-only images degrade gracefully.
 */
export function FileAttachmentDisplay({ files }: FileAttachmentDisplayProps) {
  const { setPreviewSource } = usePanel();
  const { readFileLimited } = useAppServerActions();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [pathUrls, setPathUrls] = useState<Record<string, string>>({});
  const [failedPaths, setFailedPaths] = useState<Record<string, true>>({});
  const imagePaths = useMemo(() => Array.from(new Set(
    files
      .filter((file) => isImageFile(file.type) && !file.data && file.filePath)
      .map((file) => file.filePath as string),
  )), [files]);

  useEffect(() => {
    let cancelled = false;
    for (const path of imagePaths) {
      if (pathUrls[path] || failedPaths[path]) continue;
      void getCachedMediaObjectUrl(path, readFileLimited)
        .then((url) => {
          if (!cancelled) setPathUrls((current) => ({ ...current, [path]: url }));
        })
        .catch(() => {
          if (!cancelled) setFailedPaths((current) => ({ ...current, [path]: true }));
        });
    }
    return () => { cancelled = true; };
  }, [failedPaths, imagePaths, pathUrls, readFileLimited]);

  const imageFiles = useMemo(
    () => files.filter((f) => isImageFile(f.type) && fileUrl(f, pathUrls)),
    [files, pathUrls],
  );
  const otherFiles = useMemo(
    () => files.filter((f) => !isImageFile(f.type) || !fileUrl(f, pathUrls)),
    [files, pathUrls],
  );

  const lightboxImages = useMemo(
    () => imageFiles.map((f) => ({ src: fileUrl(f, pathUrls), alt: f.name })),
    [imageFiles, pathUrls],
  );

  const handlePreview = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const handleFilePreview = useCallback((file: FileAttachment) => {
    if (!file.filePath || file.type === DIR_MIME) return;
    setPreviewSource({
      kind: 'file',
      filePath: file.filePath,
      trust: "user-selected",
      readonly: true,
    });
  }, [setPreviewSource]);

  if (files.length === 0) return null;

  return (
    <div className="space-y-2 mb-2">
      {imageFiles.length > 0 && (
        <Attachments variant="grid" className="ml-auto">
          {imageFiles.map((file, i) => (
            <Attachment
              key={file.id}
              data={toFileUIPart(file, fileUrl(file, pathUrls))}
              onClick={() => handlePreview(i)}
              // Image grid sits on top of the bubble's `bg-muted`; lift it
              // with bg-background + a subtle ring so the thumbnail edges
              // don't blur into the bubble.
              className="cursor-pointer bg-background ring-1 ring-border/40"
            >
              <AttachmentPreview />
            </Attachment>
          ))}
        </Attachments>
      )}

      {otherFiles.length > 0 && (
        <Attachments variant="list">
          {otherFiles.map((file) => {
            const isDir = file.type === DIR_MIME;
            return (
              <Attachment
                key={file.id}
                data={toFileUIPart(file)}
                onClick={file.filePath && !isDir ? () => handleFilePreview(file) : undefined}
                onKeyDown={file.filePath && !isDir ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleFilePreview(file);
                  }
                } : undefined}
                role={file.filePath && !isDir ? 'button' : undefined}
                tabIndex={file.filePath && !isDir ? 0 : undefined}
                // List chip = white card on the bubble's grey backdrop
                // (instead of transparent + border, which blended with
                // the muted bubble background — Codex April 2026 review).
                className={file.filePath && !isDir ? "cursor-pointer bg-background border-border/60" : "bg-background border-border/60"}
              >
                <AttachmentPreview
                  // Inner icon box stays grey to keep the icon column
                  // visually separate from the filename column.
                  className="bg-muted"
                  fallbackIcon={isDir ? <CodexWebIcon name="folder" size="md" className="text-muted-foreground" aria-hidden /> : undefined}
                />
                <AttachmentInfo showMediaType={!isDir} />
              </Attachment>
            );
          })}
        </Attachments>
      )}

      <ImageLightbox
        images={lightboxImages}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
      />
    </div>
  );
}
