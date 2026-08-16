import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/editor/SandpackPreview.tsx"),
  "utf8",
);

describe("Sandpack 局域网 HTTP 兼容接线", () => {
  it("预置稳定 service worker ID，避免不安全上下文触发 crypto.subtle.digest", () => {
    expect(source).toContain('SANDPACK_INTERNAL:URL-CONSISTENT-ID');
    expect(source).toContain("experimental_enableStableServiceWorkerId: true");
    expect(source).toContain("window.localStorage.setItem(STABLE_ID_STORAGE_KEY, fallback)");
  });
});
