import { describe, expect, it } from "vitest";
import { extractJson, normalizeDanmakuCandidates, normalizeObservationDraft } from "../src/shared/json";

describe("json helpers", () => {
  it("extracts JSON from model prose", () => {
    const payload = extractJson<{ activityLabel: string }>(
      '好的：{"activityLabel":"video","confidence":0.8}',
    );
    expect(payload.activityLabel).toBe("video");
  });

  it("normalizes incomplete observation payloads", () => {
    const observation = normalizeObservationDraft(
      { summary: "用户正在写代码", confidence: 2, task_relation: "on_task" },
      { capturedAt: "2026-06-12T10:00:00.000Z", appName: "Code", windowTitle: "" },
    );
    expect(observation.activityLabel).toBe("unknown");
    expect(observation.confidence).toBe(1);
    expect(observation.taskRelation).toBe("on_task");
    expect(observation.appName).toBe("Code");
  });

  it("normalizes danmaku string arrays and legacy message objects", () => {
    expect(normalizeDanmakuCandidates({ messages: ["回来写方案", { text: "别漂了" }] })).toEqual([
      { text: "回来写方案" },
      { text: "别漂了" },
    ]);
  });
});
