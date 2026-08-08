export function resolveLoginDestination(requested: string | null): string {
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/chat";
}

export function canSubmitLogin(configLoaded: boolean, turnstileEnabled: boolean, token: string): boolean {
  return configLoaded && (!turnstileEnabled || token.length > 0);
}

export function turnstileClientErrorCode(value: unknown): string | null {
  const code = String(value ?? "");
  return /^\d{6}$/.test(code) ? code : null;
}
