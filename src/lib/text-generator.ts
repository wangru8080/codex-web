import { streamText } from 'ai';
import { createModel } from './ai-provider';

export interface StreamTextParams {
  providerId: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
}

/**
 * Stream text from the user's current provider.
 * Returns an async iterable of text chunks.
 *
 * Provider resolution is fully delegated to ai-provider.ts → provider-resolver.ts.
 * No fallback logic here — the resolver's chain (explicit → session → global default → env)
 * is the single source of truth.
 *
 * NOTE: Do NOT expand model aliases (sonnet/opus/haiku) here.
 * toAiSdkConfig() resolves model IDs through the provider's availableModels catalog,
 * which uses the short alias as modelId. Expanding aliases would break that lookup
 * for SDK proxy providers (Kimi, GLM, MiniMax, etc.) that expect short aliases.
 */
export async function* streamTextFromProvider(params: StreamTextParams): AsyncIterable<string> {
  const { languageModel } = createModel({
    providerId: params.providerId,
    model: params.model,
  });

  const result = streamText({
    model: languageModel,
    system: params.system,
    prompt: params.prompt,
    maxOutputTokens: params.maxTokens || 4096,
    abortSignal: params.abortSignal || AbortSignal.timeout(120_000),
  });

  for await (const chunk of result.textStream) {
    yield chunk;
  }
}

/**
 * Generate complete text (non-streaming) from the user's current provider.
 * Useful when you need the full response as a string.
 */
export async function generateTextFromProvider(params: StreamTextParams): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamTextFromProvider(params)) {
    chunks.push(chunk);
  }
  return chunks.join('');
}
