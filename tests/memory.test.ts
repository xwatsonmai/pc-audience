import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseService } from "../src/main/database";
import { MemoryService } from "../src/main/services/memory";
import type { ObservationDraft } from "../src/shared/types";

describe("memory service", () => {
  let database: DatabaseService;
  let memory: MemoryService;

  beforeEach(async () => {
    database = new DatabaseService({ inMemory: true });
    await database.initialize();
    memory = new MemoryService(database);
  });

  it("stores observations and stitches continuous behavior segments", () => {
    const first = memory.recordObservation(observation("2026-06-12T10:00:00.000Z", "focused_work", "Code"));
    const second = memory.recordObservation(observation("2026-06-12T10:01:00.000Z", "focused_work", "Code"));
    const third = memory.recordObservation(observation("2026-06-12T10:02:00.000Z", "video", "Chrome"));

    expect(first.observation.id).toBe(1);
    expect(second.currentSegment?.observationCount).toBe(2);
    expect(third.currentSegment?.activityLabel).toBe("video");

    const segments = database.getRecentSegments();
    expect(segments).toHaveLength(2);
    expect(segments[0].activityLabel).toBe("video");
    expect(segments[1].endedAt).toBe("2026-06-12T10:02:00.000Z");
    expect(database.getRollups().map((rollup) => rollup.scope).sort()).toEqual(["day", "recent_30m"]);
  });

  it("closes current segment when sensitive content is skipped", () => {
    memory.recordObservation(observation("2026-06-12T10:00:00.000Z", "focused_work", "Code"));
    memory.recordObservation({
      ...observation("2026-06-12T10:01:00.000Z", "sensitive", "1Password"),
      isSensitive: true,
      source: "system_skip",
    });

    expect(database.getCurrentSegment()).toBeNull();
    expect(database.getLatestObservation()?.isSensitive).toBe(true);
  });
});

function observation(capturedAt: string, activityLabel: string, appName: string): ObservationDraft {
  return {
    capturedAt,
    activityLabel,
    appName,
    windowTitle: "",
    summary: `${appName} ${activityLabel}`,
    confidence: 0.9,
    possibleIntent: "working",
    taskRelation: "unknown",
    isSensitive: false,
    source: "vision_ai",
  };
}
