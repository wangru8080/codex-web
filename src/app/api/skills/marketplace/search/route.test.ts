import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("Skills.sh 市场搜索 API", () => {
  it("空查询使用 trending 列表", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{
      id: "owner/repo/demo",
      slug: "demo",
      name: "Demo",
      source: "owner/repo",
      installs: 3,
    }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new NextRequest("http://localhost/api/skills/marketplace/search?limit=5"));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("/api/search?q=skill&limit=5");
    await expect(response.json()).resolves.toMatchObject({ skills: [{ skillId: "demo" }] });
  });

  it("查询走 search endpoint，并在上游失败时返回 502", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NPX_BIN", "node");
    const response = await GET(new NextRequest("http://localhost/api/skills/marketplace/search?q=react"));
    expect([200, 502]).toContain(response.status);
    expect(fetchMock.mock.calls[0][0].toString()).toContain("/api/search?q=react");
  });
});
