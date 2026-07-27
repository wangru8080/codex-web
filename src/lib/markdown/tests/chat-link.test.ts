import { describe, expect, it } from "vitest";

import { classifyChatLinkHref } from "../chat-link";

describe("classifyChatLinkHref", () => {
  it("识别带行号的本地绝对文件", () => {
    expect(classifyChatLinkHref("/repo/server/websocket-bridge.ts#L42")).toEqual({
      kind: "local-file",
      href: "/repo/server/websocket-bridge.ts#L42",
      filePath: "/repo/server/websocket-bridge.ts",
      anchor: "#L42",
    });
  });

  it("解码浏览器编码的中文本地文件路径", () => {
    const href = "/attachments/OpenClaw-%E8%AE%B0%E5%BF%86.md";
    expect(classifyChatLinkHref(href)).toEqual({
      kind: "local-file",
      href,
      filePath: "/attachments/OpenClaw-记忆.md",
    });
  });

  it("容忍不完整的百分号编码", () => {
    expect(classifyChatLinkHref("/attachments/bad%name.md")).toMatchObject({
      kind: "local-file",
      filePath: "/attachments/bad%name.md",
    });
  });

  it("识别可预览的相对文件", () => {
    expect(classifyChatLinkHref("docs/exec-plans/completed/plan.md")).toMatchObject({
      kind: "local-file",
      filePath: "docs/exec-plans/completed/plan.md",
    });
  });

  it("识别安全远程 URL", () => {
    expect(classifyChatLinkHref("https://openai.com/docs")).toEqual({
      kind: "remote",
      href: "https://openai.com/docs",
    });
  });

  it("保留普通相对链接", () => {
    expect(classifyChatLinkHref("../guide")).toEqual({
      kind: "relative",
      href: "../guide",
    });
  });

  it("阻止危险协议", () => {
    expect(classifyChatLinkHref("javascript:alert(1)")).toEqual({
      kind: "blocked",
      href: "javascript:alert(1)",
    });
  });
});
