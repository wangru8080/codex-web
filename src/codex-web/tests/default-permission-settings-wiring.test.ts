import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("默认权限模式 settings 与 Full Access 警告接线", () => {
  it("Full Access 警告包含未来会话复选框并写入 app-server 配置", () => {
    const composer = read("src/components/chat/MessageInput.tsx");

    expect(composer).toContain("permission.useForFutureSessions");
    expect(composer).toContain('type="checkbox"');
    expect(composer).toContain("defaultPermissionModeConfigEdits('full_access')");
    expect(composer).toContain("appServer.writeConfigEdits");
  });

  it("设置页通过 config/read 状态和 config/batchWrite 修改默认权限", () => {
    const general = read("src/components/settings/GeneralSection.tsx");

    expect(general).toContain("useAppServerSelector((state) => state.config?.data)");
    expect(general).toContain("defaultPermissionModeFromConfig");
    expect(general).toContain("appServer.writeConfigEdits");
    expect(general).toContain("settings.defaultPermissionsFullAccess");
  });

  it("中英文都提供复选框和设置项文案", () => {
    for (const path of ["src/i18n/en.ts", "src/i18n/zh.ts"]) {
      const source = read(path);
      expect(source).toContain("permission.useForFutureSessions");
      expect(source).toContain("settings.defaultPermissionsTitle");
      expect(source).toContain("settings.defaultPermissionsSaveError");
    }
  });
});
