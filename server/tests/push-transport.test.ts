import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { createPublicOnlyHttpsAgent } from "../push-notifications";

describe("public-only push transport", () => {
  it("returns an address array when Node requests all DNS results", async () => {
    const addresses = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    vi.mocked(lookup).mockResolvedValue(addresses as never);
    const lookupFunction = createPublicOnlyHttpsAgent().options.lookup;
    expect(lookupFunction).toBeTypeOf("function");

    const callback = vi.fn();
    lookupFunction!("push.example.test", { all: true }, callback);

    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback).toHaveBeenCalledWith(null, addresses);
  });

  it("rejects private DNS results in either lookup mode", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "10.0.0.5", family: 4 }] as never);
    const lookupFunction = createPublicOnlyHttpsAgent().options.lookup;
    const callback = vi.fn();

    lookupFunction!("push.example.test", { all: false }, callback);

    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    expect(callback.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(String(callback.mock.calls[0]?.[0])).toContain("private address");
  });
});
