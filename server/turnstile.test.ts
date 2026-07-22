import { describe, expect, it, vi } from "vitest";

import { verifyTurnstileToken } from "./turnstile";

describe("Cloudflare Turnstile Siteverify", () => {
  it("提交 token、私密密钥和来源 IP 并接受成功响应", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, hostname: "localhost" }), { status: 200 }),
    );

    await expect(verifyTurnstileToken("token", "secret", "127.0.0.1", fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({ method: "POST" }),
    );
    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1]?.body));
    expect(body).toEqual({ secret: "secret", response: "token", remoteip: "127.0.0.1" });
  });

  it("网络错误、非成功状态和 Cloudflare 拒绝都关闭登录", async () => {
    await expect(
      verifyTurnstileToken("token", "secret", undefined, async () => {
        throw new Error("offline");
      }),
    ).resolves.toBe(false);
    await expect(
      verifyTurnstileToken("token", "secret", undefined, async () => new Response("bad", { status: 500 })),
    ).resolves.toBe(false);
    await expect(
      verifyTurnstileToken(
        "token",
        "secret",
        undefined,
        async () => new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    ).resolves.toBe(false);
  });
});
