import { afterEach, describe, expect, it, vi } from "vitest";

import { loadTurnstileApi, type TurnstileApi } from "../turnstile-loader";

class FakeScript extends EventTarget {
  src = "";
  async = false;
  defer = false;
  dataset: Record<string, string> = {};
  removed = false;

  remove() {
    this.removed = true;
  }
}

function createFixture(existing?: FakeScript) {
  const scripts: FakeScript[] = existing ? [existing] : [];
  const doc = {
    querySelector: () => scripts.find((script) => !script.removed) ?? null,
    createElement: () => {
      const script = new FakeScript();
      scripts.push(script);
      return script;
    },
    head: { appendChild: vi.fn() },
  } as unknown as Document;
  const win = {} as Window & {
    turnstile?: TurnstileApi;
    __codexTurnstileLoad?: Promise<TurnstileApi>;
  };
  const api: TurnstileApi = {
    render: vi.fn(() => "widget"),
    reset: vi.fn(),
    remove: vi.fn(),
  };
  return { api, doc, scripts, win };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Turnstile 脚本加载", () => {
  it("即使错过已有脚本的 load 事件，也会在 API 就绪后继续", async () => {
    vi.useFakeTimers();
    const existing = new FakeScript();
    existing.dataset.codexTurnstileState = "loading";
    const { api, doc, win } = createFixture(existing);

    const loading = loadTurnstileApi(win, doc);
    win.turnstile = api;
    await vi.advanceTimersByTimeAsync(50);

    await expect(loading).resolves.toBe(api);
  });

  it("失败后丢弃失效脚本，并允许下一次重新加载", async () => {
    const failed = new FakeScript();
    failed.dataset.codexTurnstileState = "failed";
    const { api, doc, scripts, win } = createFixture(failed);

    const loading = loadTurnstileApi(win, doc);
    expect(failed.removed).toBe(true);
    expect(scripts).toHaveLength(2);
    scripts[1].dispatchEvent(new Event("error"));
    await expect(loading).rejects.toThrow("加载失败");

    const retry = loadTurnstileApi(win, doc);
    expect(scripts).toHaveLength(3);
    win.turnstile = api;
    scripts[2].dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(api);
  });

  it("脚本长时间无响应时结束等待并允许后续重试", async () => {
    vi.useFakeTimers();
    const { doc, scripts, win } = createFixture();

    const loading = loadTurnstileApi(win, doc);
    const rejected = expect(loading).rejects.toThrow("加载超时");
    await vi.advanceTimersByTimeAsync(12_000);

    await rejected;
    expect(scripts[0].dataset.codexTurnstileState).toBe("failed");
    expect(win.__codexTurnstileLoad).toBeUndefined();
  });
});
