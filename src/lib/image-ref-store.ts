/**
 * Unified reference-image store for image generation.
 *
 * Keys:
 *   PENDING_KEY          – images uploaded via the input bar, not yet bound to a message
 *   lastGenKey(sid)      – file paths of the most recently generated images, scoped per session
 *   <message-id>         – images bound to a specific assistant message
 */
import type { ReferenceImage } from '@/types';

export const PENDING_KEY = '__pending__';

const MAX_STORE_ENTRIES = 50;
const store = new Map<string, ReferenceImage[]>();

/** Evict oldest entries when store exceeds capacity. */
function evictIfNeeded(): void {
  while (store.size > MAX_STORE_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) {
      store.delete(oldest);
    } else {
      break;
    }
  }
}

// ── sessionStorage persistence for last-generated paths ──

/** Build a session-scoped key for the in-memory store. */
function lastGenKey(sessionId: string): string {
  return `__last_generated__:${sessionId}`;
}

/** Build a session-scoped sessionStorage key. */
function ssKey(sessionId: string): string {
  return `imgref:last_generated:${sessionId}`;
}

/**
 * Restore last-generated images for a specific session from sessionStorage.
 * Called when a ChatView mounts with a known sessionId.
 */
export function loadLastGenerated(sessionId: string): void {
  if (typeof window === 'undefined' || !sessionId) return;
  const key = lastGenKey(sessionId);
  if (store.has(key)) return; // already loaded
  try {
    const raw = sessionStorage.getItem(ssKey(sessionId));
    if (raw) {
      const arr: ReferenceImage[] = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        store.set(key, arr);
      }
    }
  } catch {
    // ignore
  }
}

// ── Public helpers ──

/** Set reference images for a given key. */
export function setRefImages(key: string, images: ReferenceImage[]): void {
  if (images.length === 0) {
    store.delete(key);
  } else {
    store.set(key, images);
    evictIfNeeded();
  }
}

/** Delete reference images for a given key. */
export function deleteRefImages(key: string): void {
  store.delete(key);
}

/** Get reference images for a given key (or undefined). */
export function getRefImages(key: string): ReferenceImage[] | undefined {
  return store.get(key);
}

/**
 * Transfer pending reference images to a specific message ID.
 * Called when a streaming response transitions to a persisted MessageItem.
 */
export function transferPendingToMessage(messageId: string): void {
  const pending = store.get(PENDING_KEY);
  if (pending) {
    store.set(messageId, pending);
    store.delete(PENDING_KEY);
  }
}

/**
 * Store generated image paths, scoped to a session, and persist to sessionStorage.
 * Called when image generation completes.
 */
export function setLastGeneratedImages(sessionId: string, paths: string[]): void {
  const images: ReferenceImage[] = paths.map(p => ({ mimeType: 'image/png', localPath: p }));
  store.set(lastGenKey(sessionId), images);
  evictIfNeeded();
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem(ssKey(sessionId), JSON.stringify(images));
    } catch {
      // storage full
    }
  }
}

/**
 * Single merge entry-point: build a unified ReferenceImage[] for a given context.
 *
 * @param key              Store key (PENDING_KEY or message.id)
 * @param sessionId        Session ID to scope last-generated lookup
 * @param useLastGenerated Whether the LLM requested editing last-generated images
 * @param extraPaths       Additional file paths from the parsed request (referenceImages field)
 */
export function buildReferenceImages(
  key: string,
  sessionId: string,
  useLastGenerated: boolean,
  extraPaths?: string[],
): ReferenceImage[] {
  const result: ReferenceImage[] = [];

  // 1. User-uploaded base64 images
  const uploaded = store.get(key);
  if (uploaded) {
    result.push(...uploaded);
  }

  // 2. Last-generated images (if LLM requested), scoped to this session
  if (useLastGenerated && sessionId) {
    const lastGen = store.get(lastGenKey(sessionId));
    if (lastGen) {
      result.push(...lastGen);
    }
  }

  // 3. Extra paths from the parsed request JSON
  if (extraPaths && extraPaths.length > 0) {
    for (const p of extraPaths) {
      result.push({ mimeType: 'image/png', localPath: p });
    }
  }

  return result;
}
