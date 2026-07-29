import { describe, expect, it } from "vitest";

import { JsonLineDecoder } from "../runtime-broker-framing";

describe("JsonLineDecoder", () => {
  it("处理半包、粘包和多字节字符", () => {
    const decoder = new JsonLineDecoder(1024);
    expect(decoder.push(Buffer.from('{"text":"你'))).toEqual([]);
    expect(decoder.push(Buffer.from('好"}\n{"value":2}\n'))).toEqual([
      { text: "你好" },
      { value: 2 },
    ]);
  });

  it("拒绝超限帧和非法 JSON", () => {
    const decoder = new JsonLineDecoder(8);
    expect(() => decoder.push(Buffer.from('{"long":"value"}'))).toThrow("超过");
    expect(() => new JsonLineDecoder(100).push(Buffer.from("not-json\n"))).toThrow("JSON");
  });
});
