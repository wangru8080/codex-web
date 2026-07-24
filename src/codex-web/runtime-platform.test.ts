import { describe, expect, it } from "vitest";

import { runtimePlatformLabel } from "./runtime-platform";

describe("app-server 运行端平台标签", () => {
  it.each([
    ["linux", "Linux"],
    ["LINUX", "Linux"],
    ["windows", "Windows"],
    ["macos", "macOS"],
    ["darwin", "macOS"],
  ])("将 %s 显示为 %s", (platformOs, expected) => {
    expect(runtimePlatformLabel(platformOs)).toBe(expected);
  });

  it.each([undefined, null, "", "freebsd"])("未知值 %s 显示为 Unknown", (platformOs) => {
    expect(runtimePlatformLabel(platformOs)).toBe("Unknown");
  });
});
