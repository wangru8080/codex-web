import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const { nextResponseNext, mockApiResponse } = vi.hoisted(() => ({
  nextResponseNext: vi.fn(() => ({ kind: "next" })),
  mockApiResponse: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: nextResponseNext,
  },
}));

vi.mock("@/frontend-preview/mock-api", () => ({
  mockApiResponse,
}));

import { proxy } from "../../proxy";
import { createSessionToken, readWebAuthConfig, WEB_AUTH_COOKIE } from "../../../server/web-auth";

function makeRequest(pathname: string) {
  const token = createSessionToken(readWebAuthConfig(process.env));
  return {
    url: `http://localhost:3000${pathname}`,
    headers: new Headers({ cookie: `${WEB_AUTH_COOKIE}=${token}` }),
    nextUrl: { pathname, search: "" },
  } as unknown as Parameters<typeof proxy>[0];
}

beforeEach(() => {
  process.env.CODEX_WEB_LOGIN_EMAIL = "test@admin.com";
  process.env.CODEX_WEB_LOGIN_PASSWORD = "123456";
  process.env.CODEX_WEB_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CODEX_WEB_DEMO;
});

describe("proxy demo gate", () => {
  it("默认走真实路由，不启用 demo/mock", async () => {
    const response = await proxy(makeRequest("/api/codex/account"));
    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });

  it("显式 CODEX_WEB_DEMO=1 时才走 mock", async () => {
    process.env.CODEX_WEB_DEMO = "1";
    mockApiResponse.mockReturnValue({ kind: "mock" });

    const response = await proxy(makeRequest("/api/codex/account"));

    expect(mockApiResponse).toHaveBeenCalledTimes(1);
    expect(nextResponseNext).not.toHaveBeenCalled();
    expect(response).toEqual({ kind: "mock" });
  });

  it("bridge-url 始终放行真实路由", async () => {
    process.env.CODEX_WEB_DEMO = "1";

    const response = await proxy(makeRequest("/api/codex/bridge-url"));

    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });
});
