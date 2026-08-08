export type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

type TurnstileWindow = Window & {
  turnstile?: TurnstileApi;
  __codexTurnstileLoad?: Promise<TurnstileApi>;
};

const SCRIPT_SELECTOR = "script[data-codex-turnstile]";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_TIMEOUT_MS = 12_000;

export function loadTurnstileApi(
  win: TurnstileWindow = window,
  doc: Document = document,
): Promise<TurnstileApi> {
  if (win.turnstile) return Promise.resolve(win.turnstile);
  if (win.__codexTurnstileLoad) return win.__codexTurnstileLoad;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    let script = doc.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
    if (script?.dataset.codexTurnstileState === "failed") {
      script.remove();
      script = null;
    }

    let created = false;
    if (!script) {
      script = doc.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.codexTurnstile = "true";
      script.dataset.codexTurnstileState = "loading";
      created = true;
    }

    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Turnstile 脚本加载超时")), LOAD_TIMEOUT_MS);
    const poll = setInterval(() => {
      if (win.turnstile) finish();
    }, 50);
    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (script) script.dataset.codexTurnstileState = "failed";
        reject(error);
      } else if (win.turnstile) {
        if (script) script.dataset.codexTurnstileState = "ready";
        resolve(win.turnstile);
      } else {
        if (script) script.dataset.codexTurnstileState = "failed";
        reject(new Error("Turnstile API 未就绪"));
      }
    };
    const handleLoad = () => finish();
    const handleError = () => finish(new Error("Turnstile 脚本加载失败"));

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (created) doc.head.appendChild(script);
  });

  win.__codexTurnstileLoad = promise.catch((error) => {
    delete win.__codexTurnstileLoad;
    throw error;
  });
  return win.__codexTurnstileLoad;
}
