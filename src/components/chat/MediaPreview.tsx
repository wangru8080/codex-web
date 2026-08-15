'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAppServerActions } from '@/codex-web/AppServerProvider';
import { getCachedMediaObjectUrl } from '@/lib/media-resource-cache';
import { useTranslation } from '@/hooks/useTranslation';
import type { MediaBlock } from '@/types';
import { ImageLightbox } from './ImageLightbox';

function mediaUrl(block: MediaBlock): string {
  if (block.data) {
    return `data:${block.mimeType};base64,${block.data}`;
  }
  if (block.url && /^https?:\/\//i.test(block.url)) return block.url;
  return '';
}

interface MediaPreviewProps {
  media: MediaBlock[];
}

export function MediaPreview({ media }: MediaPreviewProps) {
  const { t } = useTranslation();
  const { readFileLimited } = useAppServerActions();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [pathUrls, setPathUrls] = useState<Record<string, string>>({});
  const [failedPaths, setFailedPaths] = useState<Record<string, true>>({});
  const localPaths = useMemo(() => Array.from(new Set(
    media.filter((block) => block.localPath && !mediaUrl(block)).map((block) => block.localPath as string),
  )), [media]);

  useEffect(() => {
    let cancelled = false;
    for (const path of localPaths) {
      if (pathUrls[path] || failedPaths[path]) continue;
      void getCachedMediaObjectUrl(path, readFileLimited).then((url) => {
        if (cancelled) return;
        setPathUrls((current) => ({ ...current, [path]: url }));
      }).catch(() => {
        if (cancelled) return;
        setFailedPaths((current) => ({ ...current, [path]: true }));
      });
    }
    return () => { cancelled = true; };
  }, [failedPaths, localPaths, pathUrls, readFileLimited]);

  if (!media || media.length === 0) return null;

  const images = media.filter(m => m.type === 'image');
  const videos = media.filter(m => m.type === 'video');
  const audios = media.filter(m => m.type === 'audio');

  const resolvedUrl = (block: MediaBlock) => mediaUrl(block) || (block.localPath ? pathUrls[block.localPath] : '') || '';
  const resolvedImages = images.map((image, index) => ({ image, index, url: resolvedUrl(image) })).filter((entry) => !!entry.url);
  const lightboxImages = resolvedImages.map((entry, i) => ({
    src: entry.url,
    alt: `Media ${i + 1}`,
  }));

  return (
    <div className="mt-2 space-y-2">
      {/* Images */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, i) => {
            const url = resolvedUrl(img);
            const failed = !!img.localPath && !!failedPaths[img.localPath];
            const lightboxImageIndex = resolvedImages.findIndex((entry) => entry.index === i);
            return url ? (
              <img
                key={i}
                src={url}
                alt={`Generated image ${i + 1}`}
                loading="lazy"
                className="max-w-xs max-h-64 rounded-md border border-border/50 cursor-pointer hover:opacity-90 transition-opacity object-contain"
                onClick={() => {
                  setLightboxIndex(lightboxImageIndex);
                  setLightboxOpen(true);
                }}
              />
            ) : failed ? (
              <div
                key={i}
                className="flex h-24 w-48 items-center justify-center rounded-md border border-status-error-border bg-status-error-muted px-3 text-center text-xs text-status-error-foreground"
                title={img.localPath}
              >
                {t('media.outputLoadFailed')}
              </div>
            ) : (
              <div
                key={i}
                className="h-24 w-48 animate-pulse rounded-md border border-border/50 bg-muted/40"
                aria-label={t('media.outputLoading')}
              />
            );
          })}
        </div>
      )}

      {/* Videos */}
      {videos.map((vid, i) => {
        const url = resolvedUrl(vid);
        return url ? (
          <video
            key={`video-${i}`}
            src={url}
            controls
            preload="metadata"
            className="max-w-md max-h-80 rounded-md border border-border/50"
          />
        ) : null;
      })}

      {/* Audio */}
      {audios.map((aud, i) => {
        const url = resolvedUrl(aud);
        return url ? (
          <audio
            key={`audio-${i}`}
            src={url}
            controls
            preload="metadata"
            className="w-full max-w-md"
          />
        ) : null;
      })}

      {/* Lightbox for images */}
      {lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onOpenChange={setLightboxOpen}
        />
      )}
    </div>
  );
}
