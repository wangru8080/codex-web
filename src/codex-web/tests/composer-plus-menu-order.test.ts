import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("+ 菜单顺序", () => {
  it("目标和计划模式位于插件分组之前", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/chat/MessageInput.tsx"), "utf8");
    const menu = source.slice(source.indexOf("<PromptInputActionMenuContent"), source.indexOf("</PromptInputActionMenuContent"));
    expect(menu.indexOf('label="目标"')).toBeLessThan(menu.indexOf('>插件</div>'));
    expect(menu.indexOf('label="计划模式"')).toBeLessThan(menu.indexOf('>插件</div>'));
  });
});
