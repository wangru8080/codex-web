import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { GET } from "./route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
});

function mockCliSearch(output = `${JSON.stringify({
  skills: [{
    id: "owner/repo/demo",
    package: "owner/repo@demo",
    skillId: "demo",
    name: "demo",
    installs: 0,
    source: "owner/repo",
  }],
})}\n`) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.kill = vi.fn();
  spawnMock.mockImplementationOnce(() => {
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from(output));
      child.emit("close", 0);
    });
    return child;
  });
  return child;
}

describe("Skills.sh 市场搜索 API", () => {
  it("匿名空查询使用 CLI fallback", async () => {
    mockCliSearch();
    const response = await GET(new NextRequest("http://localhost/api/skills/marketplace/search?limit=5"));
    expect(response.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["skill", "5"]),
      expect.objectContaining({ stdio: ["ignore", "pipe", "ignore"] }),
    );
    await expect(response.json()).resolves.toMatchObject({ source: "skills.cli.find" });
  });

  it("匿名查询使用 CLI fallback，不调用废弃的公开 API", async () => {
    mockCliSearch();
    const response = await GET(new NextRequest("http://localhost/api/skills/marketplace/search?q=react"));
    expect(response.status).toBe(200);
    expect(spawnMock).toHaveBeenCalled();
  });

  it("带 token 时调用官方 v1 search API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [{
      id: "owner/repo/demo",
      slug: "demo",
      name: "Demo",
      source: "owner/repo",
      installs: 3,
    }] }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SKILLS_SH_API_TOKEN", "test-token");

    const response = await GET(new NextRequest("http://localhost/api/skills/marketplace/search?q=react&limit=5"));
    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://skills.sh/api/v1/skills/search?q=react&limit=5");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer test-token" } });
  });

  it("CLI 卡死时终止子进程并返回 502", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    spawnMock.mockReturnValueOnce(child);

    const responsePromise = GET(new NextRequest("http://localhost/api/skills/marketplace/search?q=react"));
    await vi.advanceTimersByTimeAsync(15_000);
    const response = await responsePromise;

    expect(child.kill).toHaveBeenCalledOnce();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("skills CLI 超时") });
  });
});
