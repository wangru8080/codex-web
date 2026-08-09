import { describe, expect, it } from "vitest";
import { dispatchBadge, resolveItemSelection } from "@/lib/message-input-logic";

describe("输入框插件引用", () => {
  it("把插件 badge 编码为 app-server 可识别的 plugin URI marker", () => {
    expect(dispatchBadge({
      command: "github",
      label: "GitHub",
      description: "",
      kind: "plugin",
      pluginUri: "plugin://github@openai-api-curated/",
    }, "提交这个问题")).toEqual({
      prompt: "[@GitHub](plugin://github@openai-api-curated/) 提交这个问题",
      displayLabel: "@GitHub\n提交这个问题",
    });
  });

  it("@ 选择插件时移除搜索 token，并保留用户已输入内容", () => {
    expect(resolveItemSelection({
      label: "GitHub",
      value: "github",
      kind: "plugin",
      pluginUri: "plugin://github@openai-api-curated/",
    }, "file", 0, "@g 请处理", "g")).toMatchObject({
      action: "set_badge",
      newInputValue: "请处理",
      badge: { kind: "plugin", pluginUri: "plugin://github@openai-api-curated/" },
    });
  });

  it("普通文件选择仍走结构化文件引用", () => {
    expect(resolveItemSelection({ label: "src/app.ts", value: "src/app.ts", nodeType: "file" }, "file", 0, "@src", "src").action)
      .toBe("select_file_reference");
  });
});
