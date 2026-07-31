import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Turn } from "@/codex/protocol/generated/v2/Turn";
import { latestInProgressTurnId } from "../resumed-turn-hydration";

const historyPage = readFileSync(
  new URL("../../app/chat/[id]/page.tsx", import.meta.url),
  "utf8",
);

describe("窗口重开后的实时 Turn 历史去重", () => {
  it("只把最新 inProgress Turn 识别为实时历史省略目标", () => {
    expect(latestInProgressTurnId([
      createTurn("turn-old", "inProgress"),
      createTurn("turn-live", "inProgress"),
    ])).toBe("turn-live");
    expect(latestInProgressTurnId([
      createTurn("turn-old", "inProgress"),
      createTurn("turn-done", "completed"),
    ])).toBeNull();
    expect(latestInProgressTurnId([])).toBeNull();
  });

  it("历史页把 resume active turn id 传给分页、fallback 和深链转换", () => {
    expect(historyPage).toContain(
      "const resumedLiveTurnId = latestInProgressTurnId(resume.thread.turns)",
    );
    expect(historyPage.match(/omitAssistantTurnId: resumedLiveTurnId/g)).toHaveLength(3);
  });
});

function createTurn(id: string, status: Turn["status"]): Turn {
  return {
    id,
    items: [],
    itemsView: "full",
    status,
    error: null,
    startedAt: 1,
    completedAt: status === "inProgress" ? null : 2,
    durationMs: status === "inProgress" ? null : 1000,
  };
}
