import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readDefaultPanelPreference,
  readLocalePreference,
  writeDefaultPanelPreference,
  writeLocalePreference,
} from "./app-preferences";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Web 本地偏好", () => {
  it("读写语言和默认面板", () => {
    writeLocalePreference("zh");
    writeDefaultPanelPreference("git");

    expect(readLocalePreference()).toBe("zh");
    expect(readDefaultPanelPreference()).toBe("git");
  });

  it("无效值不会进入 UI 状态", () => {
    vi.stubGlobal("window", {
      localStorage: memoryStorage({
        "codex-web:locale": "fr",
        "codex-web:default-panel": "terminal",
      }),
    });

    expect(readLocalePreference()).toBeNull();
    expect(readDefaultPanelPreference()).toBe("file_tree");
  });

  it("服务端渲染时使用安全回退", () => {
    vi.stubGlobal("window", undefined);

    expect(readLocalePreference()).toBeNull();
    expect(readDefaultPanelPreference()).toBe("file_tree");
    expect(() => writeLocalePreference("en")).not.toThrow();
    expect(() => writeDefaultPanelPreference("none")).not.toThrow();
  });

  it("localStorage 抛错时使用安全回退", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
      },
    });

    expect(readLocalePreference()).toBeNull();
    expect(readDefaultPanelPreference()).toBe("file_tree");
    expect(() => writeLocalePreference("zh")).not.toThrow();
    expect(() => writeDefaultPanelPreference("git")).not.toThrow();
  });
});
