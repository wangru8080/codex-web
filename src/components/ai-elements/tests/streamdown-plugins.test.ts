import { describe, expect, it } from "vitest";

import { detectMarkdownCapabilities } from "../streamdown-plugins";

describe("Streamdown 可选能力检测", () => {
  it("普通 Markdown、金额和行内代码不加载可选插件", () => {
    expect(detectMarkdownCapabilities("普通 **Markdown** 与 $25 金额")).toEqual({
      code: false,
      math: false,
      mermaid: false,
    });
    expect(detectMarkdownCapabilities("`$HOME` 和 `const value = 1`" )).toEqual({
      code: false,
      math: false,
      mermaid: false,
    });
  });

  it("识别普通和未闭合代码围栏，但不把 Mermaid 重复算作代码高亮", () => {
    expect(detectMarkdownCapabilities("```ts\nconst value = 1;\n```" )).toMatchObject({
      code: true,
      mermaid: false,
    });
    expect(detectMarkdownCapabilities("~~~python\nprint('streaming')" )).toMatchObject({
      code: true,
      mermaid: false,
    });
    expect(detectMarkdownCapabilities("```mermaid\ngraph TD\nA-->B\n```" )).toEqual({
      code: false,
      math: false,
      mermaid: true,
    });
  });

  it("识别行内、块级和 LaTeX 分隔符数学公式", () => {
    expect(detectMarkdownCapabilities("质量守恒为 $E = mc^2$。" ).math).toBe(true);
    expect(detectMarkdownCapabilities("$$\\int_0^1 x^2 dx$$" ).math).toBe(true);
    expect(detectMarkdownCapabilities("\\(a+b\\) 与 \\[c+d\\]" ).math).toBe(true);
    expect(detectMarkdownCapabilities("转义 \\$not-math\\$" ).math).toBe(false);
  });
});
