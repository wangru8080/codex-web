import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("PDF、Word 与 Excel 预览接线", () => {
  it("文件树只放开本次已支持的文档格式", () => {
    const panel = read("src/components/layout/panels/FileTreePanel.tsx");
    const blocked = panel.slice(panel.indexOf("const NON_PREVIEWABLE"), panel.indexOf("if (NON_PREVIEWABLE"));

    for (const extension of ["pdf", "doc", "docx", "xls", "xlsx"]) {
      expect(blocked).not.toContain(`"${extension}"`);
    }
    expect(blocked).toContain('"ppt", "pptx"');
  });

  it("右侧预览通过 app-server 原始字节分发到三个懒加载查看器", () => {
    const preview = read("src/components/layout/panels/PreviewPanel.tsx");

    expect(preview).toContain("fileDocumentBytesFromResponse(response)");
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/PdfViewer")');
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/WordDocumentViewer")');
    expect(preview).toContain('dynamic(\n  () => import("@/components/editor/SpreadsheetViewer")');
  });

  it("DOC 使用无脚本沙箱，DOCX 不渲染嵌入 HTML", () => {
    const viewer = read("src/components/editor/WordDocumentViewer.tsx");

    expect(viewer).toContain('sandbox=""');
    expect(viewer).toContain("renderAltChunks: false");
    expect(viewer).toContain("parseMsDoc(bytes.buffer.slice(");
  });

  it("Excel 只读取单元格显示值并限制渲染范围", () => {
    const viewer = read("src/components/editor/SpreadsheetViewer.tsx");

    expect(viewer).toContain("cellFormula: false");
    expect(viewer).toContain("bookVBA: false");
    expect(viewer).toContain("MAX_SPREADSHEET_ROWS");
    expect(viewer).toContain("MAX_SPREADSHEET_COLUMNS");
  });
});
