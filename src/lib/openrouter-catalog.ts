/**
 * OpenRouter `/v1/models` catalog cache + fetcher.
 *
 * Single source of truth for OpenRouter candidate fetching across the two
 * routes that need it:
 *   - `POST /api/providers/[id]/search-models` — read-cache (force=false)
 *   - `POST /api/providers/[id]/validate-models` — force-refetch (force=true)
 *
 * Cache contract (per the OpenRouter exec plan):
 *   - 5-minute TTL keyed by `${provider.id}`
 *   - `force: false` (default) → cache hit within TTL returns immediately;
 *     miss or expired → fetch + write
 *   - `force: true` → bypass TTL, always fetch + write; reflects refresh
 *     button semantics ("user clicked refresh" must actually re-hit upstream)
 *
 * NOT exported as a public surface — every caller must go through one of
 * the two routes above so the auth gate (`isOpenRouterProviderRecord`)
 * cannot be bypassed.
 */

import type { ApiProvider } from '@/types';

export interface OpenRouterCandidate {
  /** Upstream model id, e.g. "anthropic/claude-3.5-sonnet". */
  modelId: string;
  /** Upstream display name. */
  displayName: string;
  /** Context window in tokens, when OpenRouter publishes it. */
  contextWindow?: number;
  /** Per-million-token pricing, when published. */
  pricing?: {
    promptPerMillion?: number;
    completionPerMillion?: number;
  };
}

export interface OpenRouterCacheEntry {
  candidates: OpenRouterCandidate[];
  cachedAt: string; // ISO timestamp of the last successful fetch
}

const TTL_MS = 5 * 60 * 1000;

interface InternalEntry {
  candidates: OpenRouterCandidate[];
  fetchedAt: number; // Date.now() of the last successful fetch
}

const cache = new Map<string, InternalEntry>();

/**
 * Test-only hook for unit tests. Not exported through the barrel; tests
 * import directly. Production code never calls this.
 */
export function __resetOpenRouterCacheForTests(): void {
  cache.clear();
}

interface FetchOptions {
  /** Force a refetch ignoring the TTL. Used by `/validate-models`. */
  force?: boolean;
}

/**
 * OpenRouter `/v1/models` returns this shape (subset). We project to
 * `OpenRouterCandidate` and drop fields we don't surface.
 */
interface OpenRouterModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    context_length?: number;
    pricing?: {
      prompt?: string;     // per-token, as decimal string
      completion?: string;
    };
  }>;
}

function normalizePricing(raw: { prompt?: string; completion?: string } | undefined): OpenRouterCandidate['pricing'] {
  if (!raw) return undefined;
  // OpenRouter quotes pricing as per-token (string) — convert to per-million
  // floats so the UI can show "$3.00 / $15.00 per 1M". Drop the field if
  // either side is missing; partial numbers mislead more than they help.
  const prompt = raw.prompt ? Number.parseFloat(raw.prompt) * 1_000_000 : undefined;
  const completion = raw.completion ? Number.parseFloat(raw.completion) * 1_000_000 : undefined;
  if (prompt === undefined && completion === undefined) return undefined;
  return {
    promptPerMillion: Number.isFinite(prompt) ? prompt : undefined,
    completionPerMillion: Number.isFinite(completion) ? completion : undefined,
  };
}

async function fetchUpstream(provider: ApiProvider): Promise<OpenRouterCandidate[]> {
  const baseUrl = (provider.base_url || '').replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('OpenRouter provider has empty base_url');
  }
  // OpenRouter records exist in two shapes in real DBs:
  //   - https://openrouter.ai/api      (preset default — missing /v1)
  //   - https://openrouter.ai/api/v1   (legacy / OpenRouter's own docs example)
  // Naïvely concatenating `/v1/models` would produce `/api/v1/v1/models`
  // for the second shape and break legacy provider rows. Mirror the
  // model-discovery normalization: if the base already ends with `/v1`,
  // append only `/models`; otherwise append `/v1/models`.
  const url = /\/v1$/.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.api_key) {
    headers['Authorization'] = `Bearer ${provider.api_key}`;
  }
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    throw new Error(`OpenRouter /v1/models returned ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as OpenRouterModelsResponse;
  if (!Array.isArray(json?.data)) {
    throw new Error('OpenRouter /v1/models response missing `data` array');
  }
  return json.data.map(entry => ({
    modelId: entry.id,
    displayName: entry.name || entry.id,
    contextWindow: entry.context_length,
    pricing: normalizePricing(entry.pricing),
  }));
}

/**
 * Get the OpenRouter catalog for a provider, honoring the cache TTL or a
 * forced refetch. Throws on upstream errors — callers are responsible for
 * mapping to the appropriate HTTP response.
 */
export async function getOpenRouterCatalog(
  provider: ApiProvider,
  opts: FetchOptions = {},
): Promise<OpenRouterCacheEntry> {
  const force = opts.force === true;
  const now = Date.now();
  const existing = cache.get(provider.id);
  if (!force && existing && now - existing.fetchedAt < TTL_MS) {
    return {
      candidates: existing.candidates,
      cachedAt: new Date(existing.fetchedAt).toISOString(),
    };
  }
  const candidates = await fetchUpstream(provider);
  cache.set(provider.id, { candidates, fetchedAt: now });
  return {
    candidates,
    cachedAt: new Date(now).toISOString(),
  };
}
