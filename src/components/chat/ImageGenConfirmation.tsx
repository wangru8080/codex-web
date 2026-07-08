'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ImageGenCard } from './ImageGenCard';
import { CodexWebIcon } from '@/components/ui/semantic-icon';
import { useTranslation } from '@/hooks/useTranslation';
import { usePanel } from '@/hooks/usePanel';
import type { TranslationKey } from '@/i18n';
import type { ReferenceImage } from '@/types';

/**
 * Render-side type for image generation results, kept here after the
 * Design Agent ghost feature cleanup (Phase 2D.0). The previous home was
 * the now-deleted hooks/useImageGen module, which carried a dead toggle
 * that was never user-reachable. The shape mirrors the response of
 * `/api/media/generate`, which is what `ImageGenConfirmation` actually
 * fetches — no React context needed.
 */
export interface ImageGenResult {
  id: string;
  text?: string;
  images: Array<{ data: string; mimeType: string; localPath?: string }>;
}

/** What the active-image endpoint returns when a usable media provider is set. */
interface ActiveImageInfo {
  providerName?: string;
  providerType?: 'gemini-image' | 'openai-image';
  model?: string;
  modelLabel?: string;
  stale: boolean;
}

const ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
] as const;

const RESOLUTIONS = ['1K', '2K', '4K'] as const;

interface ImageGenConfirmationProps {
  messageId?: string;
  sessionId?: string;
  initialPrompt: string;
  initialAspectRatio: string;
  initialResolution: string;
  /** The original raw ```image-gen-request...``` block — used for exact DB matching */
  rawRequestBlock?: string;
  referenceImages?: ReferenceImage[];
}

type Status = 'idle' | 'generating' | 'completed' | 'error';

export function ImageGenConfirmation({
  messageId,
  sessionId: sessionIdProp,
  initialPrompt,
  initialAspectRatio,
  initialResolution,
  rawRequestBlock,
  referenceImages,
}: ImageGenConfirmationProps) {
  const { t } = useTranslation();
  const { sessionId: panelSessionId } = usePanel();
  const sessionId = sessionIdProp || panelSessionId;
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState(
    ASPECT_RATIOS.includes(initialAspectRatio as typeof ASPECT_RATIOS[number])
      ? initialAspectRatio
      : '1:1'
  );
  const [resolution, setResolution] = useState(
    RESOLUTIONS.includes(initialResolution as typeof RESOLUTIONS[number])
      ? initialResolution
      : '1K'
  );
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ImageGenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which provider + model the backend will use. We surface this in the card
  // header so the user can see whether Gemini / GPT Image (official or
  // third-party) is about to run before clicking Generate. Populated from
  // /api/providers/active-image and refreshed on `provider-changed`.
  const [activeInfo, setActiveInfo] = useState<ActiveImageInfo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/providers/active-image')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!cancelled && data) setActiveInfo(data);
        })
        .catch(() => {});
    };
    load();
    const handler = () => load();
    window.addEventListener('provider-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('provider-changed', handler);
    };
  }, []);


  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setStatus('idle');
  }, []);

  const handleGenerate = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('generating');
    setError(null);

    try {
      // Split unified ReferenceImage[] back into base64 data vs file paths for the API
      const refData = referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }));
      const refPaths = referenceImages?.filter(r => r.localPath).map(r => r.localPath!);

      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          aspectRatio,
          imageSize: resolution,
          sessionId,
          ...(refData && refData.length > 0
            ? { referenceImages: refData }
            : {}),
          ...(refPaths && refPaths.length > 0
            ? { referenceImagePaths: refPaths }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      const genResult: ImageGenResult & { model?: string } = {
        id: data.id,
        text: data.text,
        images: data.images || [],
        // The generate endpoint echoes the resolved model id — carry it into
        // the completed card so the badge reflects the *actual* model that
        // ran (may differ from activeInfo if the user toggled mid-request).
        model: data.model,
      };

      if (genResult.images.length > 0) {
        setResult(genResult);
        setStatus('completed');

        // Persist result to DB by replacing image-gen-request with image-gen-result.
        // During streaming the assistant message may not yet be in DB (no messageId),
        // so retry once after a short delay to give the stream time to complete.
        {
          const resultBlock = JSON.stringify({
            status: 'completed',
            prompt,
            aspectRatio,
            resolution,
            images: genResult.images.map(img => ({
              mimeType: img.mimeType,
              localPath: img.localPath,
            })),
          });
          const persistBody = {
            message_id: messageId || '',
            content: '```image-gen-result\n' + resultBlock + '\n```',
            session_id: sessionId,
            prompt_hint: initialPrompt,
            // Pass the raw block for exact content matching when messageId is unavailable
            raw_request_block: rawRequestBlock,
          };
          const doPut = () => fetch('/api/chat/messages', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persistBody),
          });
          doPut().then(r => {
            if (!r.ok && !messageId) {
              // Retry after 3s — message should be persisted by then
              setTimeout(() => doPut().catch(() => {}), 3000);
            }
          }).catch(() => {
            if (!messageId) {
              setTimeout(() => doPut().catch(() => {}), 3000);
            }
          });
        }

        // Defer event dispatch so React commits setResult/setStatus before
        // ChatView's handler calls sendMessage and triggers a re-render
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('image-gen-completed', {
            detail: {
              prompt,
              aspectRatio,
              resolution,
              id: genResult.id,
              images: genResult.images,
            },
          }));
        }, 0);
      } else {
        setError('No images were generated');
        setStatus('error');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError((err as Error).message || 'Generation failed');
      setStatus('error');
    } finally {
      abortRef.current = null;
    }
  }, [prompt, aspectRatio, resolution, initialPrompt, sessionId, messageId, referenceImages]);

  const handleRegenerate = useCallback(() => {
    setResult(null);
    setStatus('idle');
  }, []);

  // ── Completed: show result only ──
  if (status === 'completed' && result && result.images.length > 0) {
    // Prefer the model the backend actually ran; fall back to the label we
    // fetched for the active provider if the generate endpoint didn't echo
    // the model (older clients) or if the user's active provider has a
    // friendlier label than the raw id (e.g. "GPT Image 2" vs "gpt-image-2").
    const resultModel = (result as ImageGenResult & { model?: string }).model;
    const displayModel = resultModel && activeInfo?.model === resultModel && activeInfo?.modelLabel
      ? activeInfo.modelLabel
      : resultModel || activeInfo?.modelLabel;
    return (
      <div className="my-2">
        <ImageGenCard
          images={result.images}
          prompt={prompt}
          aspectRatio={aspectRatio}
          imageSize={resolution}
          model={displayModel}
          onRegenerate={handleRegenerate}
          referenceImages={referenceImages?.filter(r => r.data).map(r => ({ mimeType: r.mimeType, data: r.data! }))}
        />
      </div>
    );
  }

  // ── Idle / Generating / Error: show params card ──
  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-hidden my-2">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/30 bg-muted/30">
        <span className="text-sm font-medium">{t('imageGen.confirmTitle' as TranslationKey)}</span>
        {/* Active-model badge. Three possible states:
              • Healthy active provider → show `<ModelLabel> · <ProviderName>`
              • Stored active is stale (key cleared / type changed / deleted)
                → muted warning chip pointing the user at Settings
              • No active set at all (fresh install) → muted hint
            The endpoint already computes the modelLabel + stale flag; we
            just map them to the three UI variants here. */}
        {activeInfo && !activeInfo.stale && activeInfo.modelLabel ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground max-w-[55%] min-w-0"
            title={`${activeInfo.modelLabel} · ${activeInfo.providerName ?? ''}`}
          >
            <CodexWebIcon name="appearance" size={12} className="shrink-0" aria-hidden />
            <span className="truncate">
              <span className="text-foreground/80">{activeInfo.modelLabel}</span>
              {activeInfo.providerName ? (
                <span className="ml-1 text-muted-foreground/80">· {activeInfo.providerName}</span>
              ) : null}
            </span>
          </span>
        ) : activeInfo?.stale ? (
          <a
            href="/settings/providers"
            className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
            title={t('imageGen.activeProviderStaleHint' as TranslationKey)}
          >
            <CodexWebIcon name="appearance" size={12} className="shrink-0" aria-hidden />
            <span>{t('imageGen.activeProviderStale' as TranslationKey)}</span>
          </a>
        ) : activeInfo ? (
          <a
            href="/settings/providers"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            <CodexWebIcon name="appearance" size={12} className="shrink-0" aria-hidden />
            <span>{t('imageGen.noActiveProvider' as TranslationKey)}</span>
          </a>
        ) : null}
      </div>

      <div className="p-4 space-y-3">
        {/* Reference images preview — unified loop over all reference images */}
        {referenceImages && referenceImages.length > 0 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('imageGen.referenceImages' as TranslationKey)}
            </label>
            <div className="flex gap-2 flex-wrap">
              {referenceImages.map((img, i) => (
                <div key={i} className="w-16 h-16 rounded-md border border-border/30 overflow-hidden bg-muted/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.data
                      ? `data:${img.mimeType};base64,${img.data}`
                      : `/api/uploads?path=${encodeURIComponent(img.localPath!)}`}
                    alt={`Reference ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Prompt textarea */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {t('imageGen.prompt' as TranslationKey)}
          </label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={status === 'generating'}
            rows={3}
            className={cn(
              'resize-none',
              'disabled:opacity-60 disabled:cursor-not-allowed'
            )}
          />
        </div>

        {/* Aspect Ratio */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('imageGen.aspectRatio' as TranslationKey)}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ASPECT_RATIOS.map((ratio) => (
              <Button
                key={ratio}
                variant="outline"
                size="xs"
                disabled={status === 'generating'}
                onClick={() => setAspectRatio(ratio)}
                className={cn(
                  aspectRatio === ratio
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                {ratio}
              </Button>
            ))}
          </div>
        </div>

        {/* Resolution */}
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            {t('imageGen.resolution' as TranslationKey)}
          </label>
          <div className="flex items-center gap-1.5">
            {RESOLUTIONS.map((res) => (
              <Button
                key={res}
                variant="outline"
                size="xs"
                disabled={status === 'generating'}
                onClick={() => setResolution(res)}
                className={cn(
                  resolution === res
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-foreground/30'
                )}
              >
                {res}
              </Button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        {status === 'idle' && (
          <div className="pt-1">
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              size="sm"
              className="gap-1.5"
            >
              {t('imageGen.generateButton' as TranslationKey)}
            </Button>
          </div>
        )}

        {/* Generating: spinner + stop */}
        {status === 'generating' && (
          <div className="pt-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm text-muted-foreground">
                  {t('imageGen.generatingStatus' as TranslationKey)}
                </span>
              </div>
              <Button onClick={handleStop} variant="outline" size="sm">
                {t('imageGen.stopButton' as TranslationKey)}
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="space-y-2">
            <p className="text-sm text-status-error-foreground">{error}</p>
            <Button onClick={handleGenerate} variant="outline" size="sm">
              {t('imageGen.retryButton' as TranslationKey)}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
