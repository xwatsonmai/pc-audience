import { describe, expect, it } from "vitest";
import { shouldMergeObservation } from "../src/shared/behavior";

describe("behavior merge rules", () => {
  const segment = {
    activityLabel: "focused_work",
    appName: "Code",
    endedAt: null,
    updatedAt: "2026-06-12T10:00:00.000Z",
  };

  it("merges same activity within the gap", () => {
    expect(
      shouldMergeObservation(segment, {
        activityLabel: "focused_work",
        appName: "Code",
        capturedAt: "2026-06-12T10:02:00.000Z",
        isSensitive: false,
      }),
    ).toBe(true);
  });

  it("does not merge sensitive observations", () => {
    expect(
      shouldMergeObservation(segment, {
        activityLabel: "focused_work",
        appName: "Code",
        capturedAt: "2026-06-12T10:02:00.000Z",
        isSensitive: true,
      }),
    ).toBe(false);
  });

  it("does not merge after a long gap", () => {
    expect(
      shouldMergeObservation(segment, {
        activityLabel: "focused_work",
        appName: "Code",
        capturedAt: "2026-06-12T10:08:00.000Z",
        isSensitive: false,
      }),
    ).toBe(false);
  });
});
