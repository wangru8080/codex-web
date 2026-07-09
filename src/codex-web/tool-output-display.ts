export const TOOL_OUTPUT_DISPLAY_BYTE_LIMIT = 1024 * 1024;

export interface ToolOutputDisplayOptions {
  sourceLabel?: string;
}

export function formatToolDisplayOutput(
  output: string,
  options: ToolOutputDisplayOptions = {},
): string {
  const encoded = new TextEncoder().encode(output);
  if (encoded.length <= TOOL_OUTPUT_DISPLAY_BYTE_LIMIT) {
    return output;
  }

  const head = new TextDecoder().decode(encoded.slice(0, TOOL_OUTPUT_DISPLAY_BYTE_LIMIT));
  const omitted = encoded.length - TOOL_OUTPUT_DISPLAY_BYTE_LIMIT;
  const source = options.sourceLabel ?? "app-server 原始 item / diagnostics";

  return `${head}\n\n... 已按官方 DEFAULT_OUTPUT_BYTES_CAP 截断至 ${TOOL_OUTPUT_DISPLAY_BYTE_LIMIT} 字节；省略 ${omitted} 字节。事实源：${source}。`;
}
