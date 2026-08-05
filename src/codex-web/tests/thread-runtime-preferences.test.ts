import { describe, expect, it } from "vitest";

import {
  readThreadRuntimePreference,
  writeThreadRuntimePreference,
} from "../thread-runtime-preferences";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("thread runtime preferences", () => {
  it("按 threadId 隔离并合并模型、推理等级和审批策略", () => {
    const storage = memoryStorage();
    writeThreadRuntimePreference(storage, "thread-a", { model: "gpt-5.6-sol", effort: "ultra" });
    writeThreadRuntimePreference(storage, "thread-a", { permissionProfile: "full_access" });
    writeThreadRuntimePreference(storage, "thread-b", { model: "gpt-5.5" });

    expect(readThreadRuntimePreference(storage, "thread-a")).toEqual({
      model: "gpt-5.6-sol",
      effort: "ultra",
      permissionProfile: "full_access",
    });
    expect(readThreadRuntimePreference(storage, "thread-b")).toEqual({ model: "gpt-5.5" });
  });

  it("忽略损坏或未知的存储值", () => {
    const storage = { getItem: () => '{"permissionProfile":"unknown"}' };
    expect(readThreadRuntimePreference(storage, "thread-a")).toBeNull();
  });

  it("存储不可写时不影响 app-server 设置流程", () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
    };
    expect(writeThreadRuntimePreference(storage, "thread-a", { model: "gpt-5.6-sol" }))
      .toEqual({ model: "gpt-5.6-sol" });
  });
});
