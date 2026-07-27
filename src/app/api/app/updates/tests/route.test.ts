import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, readUpdateStatus } from "../route";

afterEach(() => vi.unstubAllGlobals());

function registryResponse(version: string): Response {
  return Response.json({ version });
}

describe("npm 应用更新检查", () => {
  it("以 npm latest 和当前应用版本判断存在新版", async () => {
    const fetchRegistry = vi.fn().mockResolvedValue(registryResponse("0.4.0"));

    await expect(readUpdateStatus(fetchRegistry, "0.3.1")).resolves.toEqual({
      currentVersion: "0.3.1",
      latestVersion: "0.4.0",
      updateAvailable: true,
      releaseUrl: "https://www.npmjs.com/package/@wangru8080/codex-web",
      source: "npm.registry/@wangru8080/codex-web/latest",
    });
    expect(fetchRegistry).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@wangru8080%2Fcodex-web/latest",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("相同版本作为反例显示已是最新版", async () => {
    const fetchRegistry = vi.fn().mockResolvedValue(registryResponse("0.3.1"));

    await expect(readUpdateStatus(fetchRegistry, "0.3.1")).resolves.toMatchObject({
      latestVersion: "0.3.1",
      updateAvailable: false,
    });
  });

  it("registry 失败时 API 明确返回 502 而非已是最新版", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));

    const response = await GET();

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "无法从 npm registry 获取最新版本" });
  });
});
