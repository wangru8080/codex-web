'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FileUIPart } from 'ai';
import type { FileAttachment } from '@/types';
import { isImageFile } from '@/types';
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
 * - A path-only attachment has no browser-readable URL and falls back to a file item
 */
function fileUrl(f: FileAttachment): string {
  if (f.type === DIR_MIME) return '';
  if (f.data) return `data:${f.type};base64,${f.data}`;
  return '';
}

/**
 * Adapt a FileAttachment (project domain type) into a `FileUIPart` so
 * ai-elements `<Attachment>` can render it. The `id` is also needed by
 * the AttachmentData union — pass it through as a custom field.
 */
function toFileUIPart(file: FileAttachment): FileUIPart & { id: string } {
  return {
    id: file.id,
    type: 'file',
    filename: file.name,
    mediaType: file.type,
    url: fileUrl(file),
  };
}

/**
 * Renders the user-message file attachment row using ai-elements
 * `<Attachments>`. Images use the `grid` variant for a thumbnail strip
 * (click to open lightbox); non-images use the `list` variant for a
 * compact file row with icon + name. ai-elements handles missing-URL
 * fallbacks (file becomes an icon instead of a broken image), which is
 * how path-only images degrade gracefully when the browser cannot read the app-server filesystem.
 */
export function FileAttachmentDisplay({ files }: FileAttachmentDisplayProps) {
  const { setPreviewSource } = usePanel();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const imageFiles = useMemo(
    () => files.filter((f) => isImageFile(f.type) && fileUrl(f)),
    [files],
  );
  const otherFiles = useMemo(
    () => files.filter((f) => !isImageFile(f.type) || !fileUrl(f)),
    [files],
  );

  const lightboxImages = useMemo(
    () => imageFiles.map((f) => ({ src: fileUrl(f), alt: f.name })),
    [imageFiles],
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
              data={toFileUIPart(file)}
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
