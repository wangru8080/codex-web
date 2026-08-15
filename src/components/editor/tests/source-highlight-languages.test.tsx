import { renderToStaticMarkup } from "react-dom/server";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import { describe, expect, it } from "vitest";

import "../source-highlight-languages";

describe("源码语法高亮", () => {
  it.each([
    ["python", "def greet(name):\n    return name", "hljs-keyword"],
    ["typescript", "const count: number = 1", "hljs-keyword"],
    ["bash", "if [ -f file ]; then echo ok; fi", "hljs-keyword"],
    ["html", "<main class=\"page\">内容</main>", "hljs-tag"],
  ])("为 %s 输出高亮 token", (language, code, tokenClass) => {
    const html = renderToStaticMarkup(
      <SyntaxHighlighter language={language}>{code}</SyntaxHighlighter>,
    );

    expect(html).toContain(tokenClass);
  });
});
