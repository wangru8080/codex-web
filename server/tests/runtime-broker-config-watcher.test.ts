import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { watchRuntimeBrokerConfig } from "../runtime-broker-config-watcher";

describe("runtime broker 配置监听", () => {
  it("普通保存与原子替换都只应用最后一份有效配置", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-config-watch-"));
    const path = join(directory, "users.json");
    await writeFile(path, "1", { flag: "wx" });
    const applied: number[] = [];
    const stop = watchRuntimeBrokerConfig({
      path,
      debounceMs: 20,
      load: async () => Number(await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8"))),
      apply: async (value) => { applied.push(value); },
      onError: vi.fn(),
    });

    try {
      await writeFile(path, "2");
      await waitFor(() => applied.includes(2));
      const replacement = join(directory, "users.next.json");
      await writeFile(replacement, "3", { flag: "wx" });
      await rename(replacement, path);
      await waitFor(() => applied.includes(3));
      expect(applied).toEqual([2, 3]);
    } finally {
      stop();
    }
  });

  it("加载失败保留旧配置，后续有效保存仍可恢复", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-config-watch-error-"));
    const path = join(directory, "users.json");
    await writeFile(path, "1", { flag: "wx" });
    const applied: number[] = [];
    const errors: Error[] = [];
    const stop = watchRuntimeBrokerConfig({
      path,
      debounceMs: 20,
      load: async () => {
        const value = await import("node:fs/promises").then(({ readFile }) => readFile(path, "utf8"));
        if (value === "invalid") throw new Error("配置无效");
        return Number(value);
      },
      apply: async (value) => { applied.push(value); },
      onError: (error) => { errors.push(error); },
    });

    try {
      await writeFile(path, "invalid");
      await waitFor(() => errors.length === 1);
      expect(applied).toEqual([]);
      await writeFile(path, "4");
      await waitFor(() => applied.includes(4));
      expect(errors[0]?.message).toBe("配置无效");
    } finally {
      stop();
    }
  });

  it("忽略同目录其他文件变化", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-config-watch-other-"));
    const path = join(directory, "users.json");
    await writeFile(path, "1", { flag: "wx" });
    const apply = vi.fn();
    const stop = watchRuntimeBrokerConfig({
      path,
      debounceMs: 10,
      load: async () => 1,
      apply,
      onError: vi.fn(),
    });

    try {
      await mkdir(join(directory, "unrelated"));
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(apply).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待配置监听状态超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
