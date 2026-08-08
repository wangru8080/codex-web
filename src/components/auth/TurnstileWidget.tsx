"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { loadTurnstileApi, type TurnstileApi } from "@/lib/turnstile-loader";

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export type TurnstileWidgetHandle = { reset: () => void; retry: () => void };

export const TurnstileWidget = forwardRef<TurnstileWidgetHandle, {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire: () => void;
  onError: (errorCode?: string | number) => void;
}>(function TurnstileWidget({ siteKey, onVerify, onExpire, onError }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [retryVersion, setRetryVersion] = useState(0);

  useImperativeHandle(ref, () => ({
    reset() {
      if (window.turnstile && widgetIdRef.current) window.turnstile.reset(widgetIdRef.current);
    },
    retry() {
      setRetryVersion((version) => version + 1);
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let api: TurnstileApi | undefined;
    const render = () => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      if (widgetIdRef.current) api?.remove(widgetIdRef.current);
      containerRef.current.replaceChildren();
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        callback: onVerify,
        "expired-callback": onExpire,
        "error-callback": onError,
      });
    };

    loadTurnstileApi()
      .then((loadedApi) => {
        if (cancelled) return;
        api = loadedApi;
        render();
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : undefined);
      });

    return () => {
      cancelled = true;
      if (api && widgetIdRef.current) api.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
    };
  }, [onError, onExpire, onVerify, retryVersion, siteKey]);

  return <div ref={containerRef} className="min-h-[65px] w-full" data-testid="turnstile-widget" />;
});
