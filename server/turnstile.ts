const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Fetcher = typeof fetch;

export type TurnstileVerificationResult =
  | { success: true }
  | { success: false; reason: "missing-input" | "http-error" | "rejected" | "request-failed"; errorCodes?: string[] };

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  return (await verifyTurnstileTokenDetailed(token, secretKey, remoteIp, fetcher)).success;
}

export async function verifyTurnstileTokenDetailed(
  token: string,
  secretKey: string,
  remoteIp?: string,
  fetcher: Fetcher = fetch,
): Promise<TurnstileVerificationResult> {
  if (!token || !secretKey) return { success: false, reason: "missing-input" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: secretKey,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { success: false, reason: "http-error" };
    const result = await response.json() as { success?: boolean; "error-codes"?: unknown };
    if (result.success === true) return { success: true };
    const errorCodes = Array.isArray(result["error-codes"])
      ? result["error-codes"].filter((code): code is string => typeof code === "string").slice(0, 8)
      : undefined;
    return { success: false, reason: "rejected", ...(errorCodes?.length ? { errorCodes } : {}) };
  } catch {
    return { success: false, reason: "request-failed" };
  } finally {
    clearTimeout(timeout);
  }
}
