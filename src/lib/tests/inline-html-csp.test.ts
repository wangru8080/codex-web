import { describe, expect, it } from "vitest";

import { injectInlineHtmlCsp } from "../inline-html-csp";

describe("HTML 预览 CSP", () => {
  it("静态预览禁止脚本", () => {
    const html = injectInlineHtmlCsp("<main>静态页面</main>", "strict");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("frame-ancestors");
  });

  it("交互预览只允许内联脚本且继续禁止网络连接", () => {
    const html = injectInlineHtmlCsp("<script>document.body.dataset.ready='1'</script>", "interactive");
    expect(html).toContain("script-src 'unsafe-inline'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("script-src 'none'");
    expect(html).not.toContain("https:");
  });
});
