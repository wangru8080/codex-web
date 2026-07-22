"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LockKeyhole, LogIn, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { TurnstileWidget, type TurnstileWidgetHandle } from "@/components/auth/TurnstileWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { canSubmitLogin, resolveLoginDestination } from "@/lib/web-login";

type PublicAuthConfig = { turnstile: { enabled: boolean; siteKey: string } };

export function LoginForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const widgetRef = useRef<TurnstileWidgetHandle>(null);
  const [config, setConfig] = useState<PublicAuthConfig>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("auth.configFailed"));
        return response.json() as Promise<PublicAuthConfig>;
      })
      .then(setConfig)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : t("auth.configFailed")));
  }, [t]);

  const clearTurnstile = useCallback(() => {
    setTurnstileToken("");
    widgetRef.current?.reset();
  }, []);
  const handleTurnstileError = useCallback(() => {
    clearTurnstile();
    setError(t("auth.turnstileFailed"));
  }, [clearTurnstile, t]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!config || (config.turnstile.enabled && !turnstileToken)) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, turnstileToken }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || t("auth.loginFailed"));
      const destination = resolveLoginDestination(searchParams.get("next"));
      router.replace(destination);
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t("auth.loginFailed"));
      if (config.turnstile.enabled) clearTurnstile();
    } finally {
      setSubmitting(false);
    }
  }

  const turnstileRequired = config?.turnstile.enabled === true;
  return (
    <>
    <header className="mb-7 text-center">
      <h1 id="login-title" className="text-2xl font-semibold">{t("auth.welcome")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("auth.subtitle")}</p>
    </header>
    <form onSubmit={submit} className="space-y-5" data-testid="web-login-form">
      <div className="space-y-2">
        <label htmlFor="login-email" className="text-sm font-medium">{t("auth.email")}</label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-lg border border-border bg-background pl-10" placeholder={t("auth.emailPlaceholder")} />
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="login-password" className="text-sm font-medium">{t("auth.password")}</label>
        <div className="relative">
          <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 rounded-lg border border-border bg-background px-10" placeholder={t("auth.passwordPlaceholder")} />
          <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}>
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>
      {turnstileRequired && (
        <TurnstileWidget ref={widgetRef} siteKey={config.turnstile.siteKey} onVerify={setTurnstileToken} onExpire={clearTurnstile} onError={handleTurnstileError} />
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" size="lg" className="w-full rounded-lg" disabled={submitting || !canSubmitLogin(Boolean(config), turnstileRequired, turnstileToken)}>
        <LogIn aria-hidden />
        {submitting ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
    </>
  );
}
