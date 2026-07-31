import { describe, expect, it } from "vitest";

import { isRecoverableDomError } from "../ErrorBoundary";

describe("ErrorBoundary 可恢复错误分类", () => {
  it("识别 DOM 节点竞态错误", () => {
    expect(isRecoverableDomError("Failed to execute 'removeChild' on 'Node'.")).toBe(true);
    expect(isRecoverableDomError("The node is not a child of this node.")).toBe(true);
  });

  it("不把普通业务异常当作 DOM 竞态", () => {
    expect(isRecoverableDomError("Cannot read properties of undefined")).toBe(false);
  });
});
