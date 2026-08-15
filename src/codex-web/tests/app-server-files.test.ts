import { describe, expect, it } from "vitest";

import {
  AppServerFilePreviewError,
  buildFileSizeCommand,
  buildLimitedFileReadCommand,
  directoryContainsName,
  directoryEntriesToNodes,
  fileDataUrlFromResponse,
  fileBytesFromResponse,
  fileDocumentBytesFromResponse,
  filePreviewFromResponse,
  languageForPath,
  fileSizeFromCommandResponse,
  limitedFileResponseFromCommand,
  utf8ToBase64,
  utf8FromBase64,
} from "../app-server-files";

describe("app-server 文件适配器", () => {
  it("Unix 受限读取只读取上限加一字节并限制命令输出", () => {
    const command = buildLimitedFileReadCommand("unix", "/workspace/a file.bin", 1024);

    expect(command.command).toEqual([
      "sh",
      "-c",
      expect.stringContaining('head -c "$CODEX_WEB_FILE_READ_BYTES" <&3'),
    ]);
    expect(command.env).toMatchObject({
      CODEX_WEB_FILE_PATH: "/workspace/a file.bin",
      CODEX_WEB_FILE_READ_BYTES: "1025",
    });
    expect(command.outputBytesCap).toBeGreaterThan(1368);
    expect(command.sandboxPolicy).toEqual({ type: "readOnly", networkAccess: false });
  });

  it("Windows 受限读取使用固定大小缓冲区", () => {
    const command = buildLimitedFileReadCommand("windows", "C:\\workspace\\a.bin", 2048);

    expect(command.command[0]).toBe("powershell.exe");
    expect(command.command.join(" ")).toContain("CODEX_WEB_FILE_READ_BYTES");
    expect(command.env).toMatchObject({
      CODEX_WEB_FILE_PATH: "C:\\workspace\\a.bin",
      CODEX_WEB_FILE_READ_BYTES: "2049",
    });
  });

  it("受限读取在返回上限加一字节时拒绝内容", () => {
    const withinLimit = Buffer.alloc(4, 1).toString("base64");
    expect(limitedFileResponseFromCommand({ exitCode: 0, stdout: withinLimit, stderr: "" }, 4))
      .toEqual({ dataBase64: withinLimit });

    const overLimit = Buffer.alloc(5, 1).toString("base64");
    expect(() => limitedFileResponseFromCommand({ exitCode: 0, stdout: overLimit, stderr: "" }, 4))
      .toThrow(AppServerFilePreviewError);
  });

  it("文件大小查询只返回受控数字输出", () => {
    expect(buildFileSizeCommand("unix", "/workspace/a.txt").outputBytesCap).toBe(128);
    expect(buildFileSizeCommand("windows", "C:\\a.txt").command[0]).toBe("powershell.exe");
    expect(fileSizeFromCommandResponse({ exitCode: 0, stdout: "123\n", stderr: "" })).toBe(123);
    expect(() => fileSizeFromCommandResponse({ exitCode: 1, stdout: "", stderr: "missing" })).toThrow("missing");
  });

  it("把目录条目映射为目录优先的文件树节点", () => {
    expect(directoryEntriesToNodes("/workspace", [
      { fileName: "z.ts", isDirectory: false, isFile: true },
      { fileName: "src", isDirectory: true, isFile: false },
      { fileName: "README.md", isDirectory: false, isFile: true },
    ])).toEqual([
      { name: "src", path: "/workspace/src", type: "directory" },
      { name: "README.md", path: "/workspace/README.md", type: "file", extension: "md" },
      { name: "z.ts", path: "/workspace/z.ts", type: "file", extension: "ts" },
    ]);
  });

  it("检查同名条目时遵循主机路径的大小写语义", () => {
    const entries = [{ fileName: "Notes.md", isDirectory: false, isFile: true }];
    expect(directoryContainsName("/workspace", entries, "notes.md")).toBe(false);
    expect(directoryContainsName("C:\\workspace", entries, "notes.md")).toBe(true);
  });

  it("解码 UTF-8 Markdown 并生成预览元数据", () => {
    const content = "# 标题\n\n正文";
    const preview = filePreviewFromResponse("/workspace/notes.md", {
      dataBase64: Buffer.from(content).toString("base64"),
    });

    expect(preview).toMatchObject({
      path: "/workspace/notes.md",
      content,
      language: "markdown",
      line_count: 3,
      line_count_exact: true,
      truncated: false,
      bytes_total: Buffer.byteLength(content),
    });
  });

  it("识别常见源码语言并为未知文本回退 plaintext", () => {
    expect(languageForPath("/workspace/app.py")).toBe("python");
    expect(languageForPath("/workspace/app.ts")).toBe("typescript");
    expect(languageForPath("/workspace/start.sh")).toBe("bash");
    expect(languageForPath("/workspace/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("/workspace/main.cpp")).toBe("cpp");
    expect(languageForPath("/workspace/unknown.custom")).toBe("plaintext");
  });

  it("拒绝二进制文件", () => {
    expect(() => filePreviewFromResponse("/workspace/data.bin", {
      dataBase64: Buffer.from([0, 1, 2, 3]).toString("base64"),
    })).toThrow("binary_not_previewable");
  });

  it("为下载无损解码二进制文件", () => {
    expect(Array.from(fileBytesFromResponse({
      dataBase64: Buffer.from([0, 1, 2, 127, 128, 255]).toString("base64"),
    }))).toEqual([0, 1, 2, 127, 128, 255]);
  });

  it("拒绝超过 10 MB 的文件", () => {
    const dataBase64 = "A".repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
    expect(() => filePreviewFromResponse("/workspace/large.txt", { dataBase64 })).toThrow("file_too_large");
  });

  it("二进制文档读取同样拒绝超过 10 MB 的文件", () => {
    const dataBase64 = "A".repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4);
    expect(() => fileDocumentBytesFromResponse({ dataBase64 })).toThrow("file_too_large");
    expect(Array.from(fileDocumentBytesFromResponse({
      dataBase64: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]).toString("base64"),
    }))).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  });

  it("为图片生成 data URL", () => {
    expect(fileDataUrlFromResponse("/workspace/logo.png", { dataBase64: "AAAA" }))
      .toBe("data:image/png;base64,AAAA");
  });

  it("把新建 Markdown 的 UTF-8 内容编码为 Base64", () => {
    const content = "# 中文笔记\n\n";
    expect(utf8ToBase64(content)).toBe(Buffer.from(content).toString("base64"));
  });

  it("可以把 UTF-8 Base64 内容还原为文本", () => {
    const content = "# 中文配置\nmodel = \"gpt-5.6\"";
    expect(utf8FromBase64(utf8ToBase64(content))).toBe(content);
  });
});
