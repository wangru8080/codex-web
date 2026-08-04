import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const input = readFileSync(new URL("../../components/chat/MessageInput.tsx", import.meta.url), "utf8");
const en = readFileSync(new URL("../../i18n/en.ts", import.meta.url), "utf8");
const zh = readFileSync(new URL("../../i18n/zh.ts", import.meta.url), "utf8");

describe("无可用模型输入框接线", () => {
  it("不显示静态模型或推理等级，并禁用模型选择器", () => {
    expect(input).not.toContain("modelName || 'sonnet'");
    expect(input).toContain("const hasAvailableModel = modelOptions.length > 0");
    expect(input).toContain("disabled={disabled || !hasAvailableModel}");
    expect(input).toContain("{hasAvailableModel && (");
  });

  it("提供中英文空状态文案", () => {
    expect(en).toContain("'messageInput.noAvailableModel': 'No available model'");
    expect(zh).toContain("'messageInput.noAvailableModel': '无可用模型'");
  });
});
