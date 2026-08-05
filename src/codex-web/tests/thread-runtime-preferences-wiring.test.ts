import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("线程运行设置持久化接线", () => {
  const historyPage = source("src/app/chat/[id]/page.tsx");
  const newChatPage = source("src/app/chat/page.tsx");

  it("历史线程在 resume 前读取偏好并重新提交 app-server", () => {
    expect(historyPage).toContain("readThreadRuntimePreference(localStorage, id)");
    expect(historyPage).toContain("model: savedPreference?.model");
    expect(historyPage).toContain("permissionProfile: savedPreference?.permissionProfile");
    expect(historyPage).toContain("effort: savedPreference.effort");
    expect(historyPage).not.toContain("setSessionPermissionProfile(session.permission_profile || 'request_approval')");
  });

  it("历史线程的三项选择均在 app-server 成功后按 threadId 保存", () => {
    expect(historyPage).toContain("writeThreadRuntimePreference(localStorage, threadId, { permissionProfile })");
    expect(historyPage).toContain("writeThreadRuntimePreference(localStorage, resumedThreadId || id, { model })");
    expect(historyPage).toContain("writeThreadRuntimePreference(localStorage, resumedThreadId || id, { effort })");
  });

  it("新对话使用 config/read 权限默认值并在创建线程后保存选择", () => {
    expect(newChatPage).toContain("setPermissionProfile(resolveNewChatPermissionDefault(config?.data))");
    expect(newChatPage).toContain("writeThreadRuntimePreference(localStorage, acceptedTurn.threadId");
    expect(newChatPage).toContain("permissionProfileFromRuntimeSettings(settings)");
  });
});
