import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readMatchingFsChangedPaths } from "./app-server-file-watch";

describe("app-server 文件变更订阅", () => {
  const provider = readFileSync(
    resolve(process.cwd(), "src/codex-web/AppServerProvider.tsx"),
    "utf8",
  );

  it("只接受当前 watchId 的 fs/changed 通知", () => {
    expect(readMatchingFsChangedPaths({
      method: "fs/changed",
      params: { watchId: "workspace-1", changedPaths: ["/workspace/a.md"] },
    }, "workspace-1")).toEqual(["/workspace/a.md"]);

    expect(readMatchingFsChangedPaths({
      method: "fs/changed",
      params: { watchId: "workspace-2", changedPaths: ["/workspace/b.md"] },
    }, "workspace-1")).toBeNull();

    expect(readMatchingFsChangedPaths({
      method: "turn/started",
      params: { watchId: "workspace-1", changedPaths: ["/workspace/c.md"] },
    }, "workspace-1")).toBeNull();
  });

  it("Provider 通过 fs/* 暴露 watch 生命周期", () => {
    expect(provider).toContain('client.request("fs/watch"');
    expect(provider).toContain('client.request("fs/unwatch"');
    expect(provider).toContain("readMatchingFsChangedPaths(notification, watchId)");
    expect(provider).toContain("notificationUnsubscribe()");
  });
});
