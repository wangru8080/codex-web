import { describe, expect, it, vi, afterEach } from "vitest";

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

import { proxy } from "../proxy";

function makeRequest(pathname: string) {
  return {
    nextUrl: { pathname },
  } as unknown as Parameters<typeof proxy>[0];
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CODEX_WEB_DEMO;
});

describe("proxy demo gate", () => {
  it("默认走真实路由，不启用 demo/mock", () => {
    const response = proxy(makeRequest("/api/codex/account"));
    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });

  it("显式 CODEX_WEB_DEMO=1 时才走 mock", () => {
    process.env.CODEX_WEB_DEMO = "1";
    mockApiResponse.mockReturnValue({ kind: "mock" });

    const response = proxy(makeRequest("/api/codex/account"));

    expect(mockApiResponse).toHaveBeenCalledTimes(1);
    expect(nextResponseNext).not.toHaveBeenCalled();
    expect(response).toEqual({ kind: "mock" });
  });

  it("bridge-url 始终放行真实路由", () => {
    process.env.CODEX_WEB_DEMO = "1";

    const response = proxy(makeRequest("/api/codex/bridge-url"));

    expect(mockApiResponse).not.toHaveBeenCalled();
    expect(nextResponseNext).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ kind: "next" });
  });
});
