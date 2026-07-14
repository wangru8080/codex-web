import { describe, expect, it } from "vitest";

import { readProductionPort } from "./production-server-options";

describe("readProductionPort", () => {
  it("未设置 PORT 时交给系统随机选择端口", () => {
    expect(readProductionPort(undefined)).toBe(0);
    expect(readProductionPort("")).toBe(0);
  });

  it("保留显式合法端口", () => {
    expect(readProductionPort("4123")).toBe(4123);
    expect(readProductionPort("0")).toBe(0);
    expect(readProductionPort("65535")).toBe(65535);
  });

  it("拒绝非法端口", () => {
    for (const value of ["abc", "12.5", "-1", "65536", " 3000 "]) {
      expect(() => readProductionPort(value)).toThrow("PORT 必须是 0 到 65535 的整数");
    }
  });
});
