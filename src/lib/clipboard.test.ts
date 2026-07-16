import { afterEach, describe, expect, it, vi } from "vitest";

import { writeTextToClipboard } from "./clipboard";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("writeTextToClipboard", () => {
  it("优先使用 Clipboard API", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await writeTextToClipboard("聊天内容");

    expect(writeText).toHaveBeenCalledWith("聊天内容");
  });

  it("Clipboard API 缺失时使用 DOM 回退", async () => {
    const fallback = installFallbackDocument(true);
    vi.stubGlobal("navigator", {});

    await writeTextToClipboard("聊天内容");

    expect(fallback.copyNode.textContent).toBe("聊天内容");
    expect(fallback.range.selectNodeContents).toHaveBeenCalledWith(fallback.copyNode);
    expect(fallback.selection.addRange).toHaveBeenCalledWith(fallback.range);
    expect(fallback.execCommand).toHaveBeenCalledWith("copy");
    expect(fallback.removeChild).toHaveBeenCalledWith(fallback.copyNode);
  });

  it("Clipboard API 拒绝时使用 DOM 回退", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("拒绝", "NotAllowedError"));
    const fallback = installFallbackDocument(true);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await writeTextToClipboard("聊天内容");

    expect(writeText).toHaveBeenCalledWith("聊天内容");
    expect(fallback.execCommand).toHaveBeenCalledWith("copy");
  });

  it("两种复制方式都失败时抛出错误", async () => {
    vi.stubGlobal("navigator", {});
    installFallbackDocument(false);

    await expect(writeTextToClipboard("聊天内容")).rejects.toThrow("无法写入剪贴板");
  });
});

function installFallbackDocument(copyResult: boolean) {
  const copyNode = {
    textContent: "",
    contentEditable: "",
    style: {} as CSSStyleDeclaration,
  };
  const appendChild = vi.fn();
  const removeChild = vi.fn();
  const execCommand = vi.fn().mockReturnValue(copyResult);
  const activeElement = { focus: vi.fn() };
  const range = { selectNodeContents: vi.fn() };
  const selection = { removeAllRanges: vi.fn(), addRange: vi.fn() };
  vi.stubGlobal("document", {
    activeElement,
    body: { appendChild, removeChild },
    createElement: vi.fn().mockReturnValue(copyNode),
    createRange: vi.fn().mockReturnValue(range),
    getSelection: vi.fn().mockReturnValue(selection),
    execCommand,
  });
  return { copyNode, appendChild, removeChild, execCommand, activeElement, range, selection };
}
