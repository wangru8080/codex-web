const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Fetcher = typeof fetch;

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string,
  fetcher: Fetcher = fetch,
): Promise<boolean> {
  if (!token || !secretKey) return false;
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
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
