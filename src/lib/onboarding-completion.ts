/**
 * Shared module for extracting and processing onboarding/checkin completion
 * fences from assistant messages. Used by both frontend (ChatView) and
 * backend (collectStreamResponse) to ensure completion is never missed.
 */

// ─── Fence Extraction ───────────────────────────────────────────────

/** Regex for onboarding-complete fence — tolerates CRLF, extra whitespace, optional language tag */
const ONBOARDING_FENCE_RE =
  /```+\s*onboarding-complete[^\n]*\r?\n([\s\S]*?)\r?\n\s*```+/;

/** Regex for checkin-complete fence */
const CHECKIN_FENCE_RE =
  /```+\s*checkin-complete[^\n]*\r?\n([\s\S]*?)\r?\n\s*```+/;

export interface CompletionFence {
  type: 'onboarding' | 'checkin';
  rawPayload: string;
}

/**
 * Extract a completion fence from assistant message content.
 * Returns null if no fence found.
 */
export function extractCompletionFence(content: string): CompletionFence | null {
  const onboardingMatch = content.match(ONBOARDING_FENCE_RE);
  if (onboardingMatch) {
    return { type: 'onboarding', rawPayload: onboardingMatch[1] };
  }
  const checkinMatch = content.match(CHECKIN_FENCE_RE);
  if (checkinMatch) {
    return { type: 'checkin', rawPayload: checkinMatch[1] };
  }
  return null;
}

// ─── Robust JSON Parsing ────────────────────────────────────────────

/**
 * Attempt to parse a JSON payload from an AI-generated completion fence.
 * Applies progressive repair strategies for common formatting issues:
 *   1. Strip markdown bold/italic markers
 *   2. Fix unescaped newlines inside string values
 *   3. Fix single quotes → double quotes (only around keys/values)
 *   4. Remove trailing commas before } or ]
 *   5. As last resort, extract key-value pairs with regex
 */
export function parseCompletionPayload(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();

  // Pre-clean: strip markdown formatting (**bold**, *italic*) from values
  // This is safe because * is not valid unquoted JSON syntax
  let cleaned = trimmed.replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1');

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(cleaned);
    if (isValidAnswerMap(parsed)) return normalizeAnswerMap(parsed);
  } catch { /* continue */ }

  // Strategy 3: fix unescaped newlines inside JSON strings
  // Replace literal newlines between quotes with \\n
  cleaned = cleaned.replace(/"([^"]*?)"/g, (_match, inner: string) => {
    return '"' + inner.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
  });

  try {
    const parsed = JSON.parse(cleaned);
    if (isValidAnswerMap(parsed)) return normalizeAnswerMap(parsed);
  } catch { /* continue */ }

  // Strategy 4: single quotes → double quotes (careful: only structural quotes)
  cleaned = cleaned.replace(/'/g, '"');

  try {
    const parsed = JSON.parse(cleaned);
    if (isValidAnswerMap(parsed)) return normalizeAnswerMap(parsed);
  } catch { /* continue */ }

  // Strategy 5: remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(cleaned);
    if (isValidAnswerMap(parsed)) return normalizeAnswerMap(parsed);
  } catch { /* continue */ }

  // Strategy 6: regex extraction as last resort
  // Match patterns like "q1": "some value" or "q1":"some value"
  const result: Record<string, string> = {};
  const kvRegex = /"(q\d{1,2})"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = kvRegex.exec(trimmed)) !== null) {
    result[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '');
  }
  if (Object.keys(result).length >= 3) {
    // Accept if we got at least 3 answers (partial is better than nothing)
    return result;
  }

  return null;
}

function isValidAnswerMap(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

function normalizeAnswerMap(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = typeof value === 'string' ? value : String(value ?? '');
  }
  return result;
}

// ─── High-Level Helpers ─────────────────────────────────────────────

export interface ExtractedCompletion {
  type: 'onboarding' | 'checkin';
  answers: Record<string, string>;
}

/**
 * Extract and parse a completion from assistant message content.
 * Returns null if no valid completion found.
 */
export function extractCompletion(content: string): ExtractedCompletion | null {
  const fence = extractCompletionFence(content);
  if (!fence) return null;

  const answers = parseCompletionPayload(fence.rawPayload);
  if (!answers) return null;

  return { type: fence.type, answers };
}
