import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/chat/MessageInput.tsx"),
  "utf8",
);

describe("输入框模型推理等级选择器接线", () => {
  it("按当前模型的 app-server 能力动态展示推理等级", () => {
    expect(source).toContain("currentModelOption?.supportedEffortLevels ?? []");
    expect(source).toContain('data-source-breadcrumb="app-server.model/list"');
    expect(source).toContain("label === key ? value : label");
    expect(source).not.toContain("EFFORT_OPTIONS.map");
    expect(readFileSync(resolve(process.cwd(), "src/i18n/zh.ts"), "utf8"))
      .toContain("'messageInput.effort.ultra': '超高'");
  });

  it("模型菜单高于首页项目选择器", () => {
    expect(source).toContain(
      'className="relative z-20 bg-[var(--platform-surface-bar)] backdrop-blur-lg',
    );
  });

  it("完全访问确认在权限下拉关闭后再打开", () => {
    expect(source).toContain("<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>");
    expect(source).toContain("setMenuOpen(false)");
    expect(source).toContain("window.requestAnimationFrame(() => setShowWarning(true))");
    expect(source).toContain("onOpenChange={handleWarningOpenChange}");
  });
});
