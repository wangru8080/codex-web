import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const browserEntryPaths = [
  "src/app/layout.tsx",
  "src/app/chat/page.tsx",
  "src/components/chat/MessageInput.tsx",
  "src/components/layout/AppShell.tsx",
  "src/components/layout/ChatListPanel.tsx",
  "src/components/layout/ProjectGroupHeader.tsx",
  "src/components/layout/SentryInit.tsx",
  "src/components/layout/UnifiedTopBar.tsx",
  "src/components/layout/panels/PreviewPanel.tsx",
  "src/components/settings/AboutSection.tsx",
  "src/components/ui/dialog.tsx",
  "src/hooks/useClientPlatform.ts",
];

const removedDesktopPaths = [
  "src/components/layout/InstallWizard.tsx",
  "src/components/layout/UpdateBanner.tsx",
  "src/components/layout/UpdateDialog.tsx",
  "src/components/terminal/TerminalDrawer.tsx",
  "src/components/terminal/TerminalInstance.tsx",
  "src/hooks/useNativeFolderPicker.ts",
  "src/hooks/useTerminal.ts",
  "src/hooks/useUpdate.ts",
  "src/hooks/useUpdateChecker.ts",
  "src/lib/artifact-export.ts",
  "src/lib/bg-notify-parser.ts",
  "src/lib/tray-menu-labels.ts",
  "src/lib/logging/bounded-line-ring.ts",
  "src/lib/logging/main-log-rotation.ts",
  "src/types/electron.d.ts",
];

describe("Web-only renderer 边界", () => {
  it("浏览器生产入口不再读取桌面 preload 或假 API", () => {
    const sources = browserEntryPaths.map(read).join("\n");

    expect(sources).not.toMatch(/electronAPI|WebkitAppRegion/);
    expect(sources).not.toContain("/api/files/open");
    expect(sources).not.toMatch(/UpdateContext|useUpdateChecker|UpdateBanner|UpdateDialog/);
    expect(sources).not.toMatch(/exportHtmlAsLongShot|onExportLongShot/);
  });

  it("桌面专属模块已移出源码树", () => {
    for (const path of removedDesktopPaths) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });

  it("Electron shell 样式和状态不再进入浏览器 UI", () => {
    const shellSources = [
      read("src/app/layout.tsx"),
      read("src/app/globals.css"),
      read("src/components/layout/UnifiedTopBar.tsx"),
      read("src/components/ui/dialog.tsx"),
      read("src/hooks/usePanel.ts"),
    ].join("\n");

    expect(shellSources).not.toContain('data-shell="electron"');
    expect(shellSources).not.toContain("WebkitAppRegion");
    expect(shellSources).not.toContain("platform-traffic-light");
    expect(shellSources).not.toMatch(/terminalOpen|setTerminalOpen/);
  });

  it("服务端跨平台启动与 app-server 平台信息继续保留", () => {
    const cliSource = read("scripts/codex-web-cli.ts");
    const startSource = read("scripts/start-next-with-bridge.ts");
    const initializeResponseSource = read("src/codex/protocol/generated/InitializeResponse.ts");
    const sessionTestSource = read("server/app-server-session.test.ts");

    expect(cliSource).toContain('process.platform === "darwin"');
    expect(cliSource).toContain('process.platform === "win32"');
    expect(cliSource).toContain('executable: "xdg-open"');
    expect(startSource).toContain('process.platform === "win32" ? "npm.cmd" : "npm"');
    expect(initializeResponseSource).toContain("platformOs: string");
    expect(sessionTestSource).toContain('platformOs: "linux"');
  });
});
