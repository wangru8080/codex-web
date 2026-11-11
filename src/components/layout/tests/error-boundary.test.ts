import { describe, expect, it } from "vitest";

import {
  claimChunkReloadAttempt,
  isChunkLoadError,
  isRecoverableDomError,
} from "../ErrorBoundary";

describe("ErrorBoundary 可恢复错误分类", () => {
  it("识别 DOM 节点竞态错误", () => {
    expect(isRecoverableDomError("Failed to execute 'removeChild' on 'Node'.")).toBe(true);
    expect(isRecoverableDomError("The node is not a child of this node.")).toBe(true);
  });

  it("不把普通业务异常当作 DOM 竞态", () => {
    expect(isRecoverableDomError("Cannot read properties of undefined")).toBe(false);
  });
});

describe("ErrorBoundary chunk 加载恢复", () => {
  it("识别 Turbopack 和 Webpack 的 chunk 加载失败", () => {
    expect(isChunkLoadError(
      "Failed to load chunk /_next/static/chunks/0da5c072w82e6.js from module 814184",
    )).toBe(true);
    expect(isChunkLoadError("Loading chunk 814184 failed.")).toBe(true);
    expect(isChunkLoadError("ChunkLoadError: Loading chunk settings failed")).toBe(true);
    expect(isChunkLoadError("Failed to fetch dynamically imported module: /settings")).toBe(true);
  });

  it("不把普通渲染错误当作 chunk 加载失败", () => {
    expect(isChunkLoadError("Cannot read properties of undefined")).toBe(false);
  });

  it("每分钟最多自动刷新一次，避免坏部署造成刷新循环", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(claimChunkReloadAttempt(storage, 1_000)).toBe(true);
    expect(claimChunkReloadAttempt(storage, 30_000)).toBe(false);
    expect(claimChunkReloadAttempt(storage, 62_000)).toBe(true);
  });

  it("存储不可用时保守地不自动刷新", () => {
    const storage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(claimChunkReloadAttempt(storage)).toBe(false);
  });
});
