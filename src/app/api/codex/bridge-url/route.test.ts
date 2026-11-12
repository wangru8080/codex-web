import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("bridge URL auth failure", () => {
  it("returns an uncacheable 401 when the web session is missing", async () => {
    const response = await GET(new NextRequest("http://localhost:3000/api/codex/bridge-url"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "登录已失效" });
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
