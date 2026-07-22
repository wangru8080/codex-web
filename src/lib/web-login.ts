export function resolveLoginDestination(requested: string | null): string {
  return requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/chat";
}

export function canSubmitLogin(configLoaded: boolean, turnstileEnabled: boolean, token: string): boolean {
  return configLoaded && (!turnstileEnabled || token.length > 0);
}
