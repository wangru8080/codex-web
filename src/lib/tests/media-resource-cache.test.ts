import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllCachedMediaObjectUrls,
  getCachedMediaObjectUrl,
  getPluginIconUrl,
} from "@/lib/media-resource-cache";

describe("媒体资源缓存", () => {
  beforeEach(() => {
    clearAllCachedMediaObjectUrls();
    vi.restoreAllMocks();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:cached-image"),
      revokeObjectURL: vi.fn(),
    });
  });

  it("并发读取同一路径只请求一次并返回 Blob URL", async () => {
    const readFile = vi.fn(async () => ({ dataBase64: "aGVsbG8=" }));
    const [first, second] = await Promise.all([
      getCachedMediaObjectUrl("/tmp/image.png", readFile),
      getCachedMediaObjectUrl("/tmp/image.png", readFile),
    ]);

    expect(first).toBe("blob:cached-image");
    expect(second).toBe(first);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("读取失败后清除缓存，下一次调用可以重试", async () => {
    const readFile = vi.fn()
      .mockRejectedValueOnce(new Error("暂时失败"))
      .mockResolvedValueOnce({ dataBase64: "aGVsbG8=" });

    await expect(getCachedMediaObjectUrl("/tmp/image.png", readFile)).rejects.toThrow("暂时失败");
    await expect(getCachedMediaObjectUrl("/tmp/image.png", readFile)).resolves.toBe("blob:cached-image");
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it("清空缓存后同一路径会重新读取文件", async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce({ dataBase64: "aGVsbG8=" })
      .mockResolvedValueOnce({ dataBase64: "d29ybGQ=" });
    vi.mocked(URL.createObjectURL)
      .mockReturnValueOnce("blob:old-image")
      .mockReturnValueOnce("blob:new-image");

    await expect(getCachedMediaObjectUrl("/tmp/image.png", readFile)).resolves.toBe("blob:old-image");
    clearAllCachedMediaObjectUrls();
    await expect(getCachedMediaObjectUrl("/tmp/image.png", readFile)).resolves.toBe("blob:new-image");

    expect(readFile).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("优先通过 app-server 读取插件的本地 composer 图标", async () => {
    const readFile = vi.fn(async () => ({ dataBase64: "aGVsbG8=" }));

    await expect(getPluginIconUrl({
      composerIcon: "/plugins/github-small.svg",
      composerIconUrl: "https://example.com/github.svg",
      logo: "/plugins/github.png",
      logoUrl: null,
    }, readFile)).resolves.toBe("blob:cached-image");

    expect(readFile).toHaveBeenCalledWith("/plugins/github-small.svg");
  });

  it("本地图标读取失败时回退到 app-server 返回的远程图标", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("无法读取"));

    await expect(getPluginIconUrl({
      composerIcon: "/plugins/missing.svg",
      composerIconUrl: "https://example.com/plugin.svg",
      logo: null,
      logoUrl: null,
    }, readFile)).resolves.toBe("https://example.com/plugin.svg");
  });
});
