import { describe, expect, it } from "vitest";

import type { HookMetadata } from "@/codex/protocol/generated/v2/HookMetadata";
import {
  buildHookEnabledEdit,
  buildHookTrustEdit,
  hookNeedsReview,
} from "../hooks-config";

function hook(overrides: Partial<HookMetadata> = {}): HookMetadata {
  return {
    key: "user-hook",
    eventName: "preToolUse",
    handlerType: "command",
    matcher: "Bash",
    command: "python3 hook.py",
    timeoutSec: 600 as unknown as bigint,
    statusMessage: null,
    sourcePath: "/tmp/hooks.json",
    source: "user",
    pluginId: null,
    displayOrder: 0 as unknown as bigint,
    enabled: true,
    isManaged: false,
    currentHash: "hash-1",
    trustStatus: "untrusted",
    ...overrides,
  };
}

describe("Hook 配置编辑", () => {
  it("未信任和已修改的 Hook 需要审查", () => {
    expect(hookNeedsReview(hook())).toBe(true);
    expect(hookNeedsReview(hook({ trustStatus: "modified" }))).toBe(true);
    expect(hookNeedsReview(hook({ trustStatus: "trusted" }))).toBe(false);
    expect(hookNeedsReview(hook({ trustStatus: "managed" }))).toBe(false);
  });

  it("信任写入 hooks.state 的当前哈希", () => {
    expect(buildHookTrustEdit([
      hook(),
      hook({ key: "changed-hook", currentHash: "hash-2", trustStatus: "modified" }),
      hook({ key: "trusted-hook", trustStatus: "trusted" }),
    ])).toEqual({
      keyPath: "hooks.state",
      value: {
        "user-hook": { trusted_hash: "hash-1" },
        "changed-hook": { trusted_hash: "hash-2" },
      },
      mergeStrategy: "upsert",
    });
  });

  it("启用状态与官方 TUI 使用相同键", () => {
    expect(buildHookEnabledEdit("user-hook", false)).toEqual({
      keyPath: "hooks.state",
      value: { "user-hook": { enabled: false } },
      mergeStrategy: "upsert",
    });
  });
});
