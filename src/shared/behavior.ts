import type { BehaviorSegment, ObservationDraft, ObservationRecord } from "./types";

const MAX_MERGE_GAP_MS = 3 * 60 * 1000;

export function shouldMergeObservation(
  segment: Pick<BehaviorSegment, "activityLabel" | "appName" | "endedAt" | "updatedAt"> | null,
  observation: Pick<ObservationDraft | ObservationRecord, "activityLabel" | "appName" | "capturedAt" | "isSensitive">,
): boolean {
  if (!segment || segment.endedAt || observation.isSensitive) {
    return false;
  }

  const gapMs = new Date(observation.capturedAt).getTime() - new Date(segment.updatedAt).getTime();
  if (!Number.isFinite(gapMs) || gapMs > MAX_MERGE_GAP_MS) {
    return false;
  }

  if (segment.activityLabel === observation.activityLabel) {
    return true;
  }

  return (
    observation.activityLabel === "unknown" &&
    segment.appName.toLowerCase() === observation.appName.toLowerCase()
  );
}

export function summarizeSegments(
  segments: Pick<BehaviorSegment, "startedAt" | "endedAt" | "activityLabel" | "appName" | "summary" | "observationCount">[],
): string {
  if (segments.length === 0) {
    return "暂无可总结的行为记录。";
  }

  return segments
    .map((segment) => {
      const started = formatTime(segment.startedAt);
      const ended = segment.endedAt ? formatTime(segment.endedAt) : "现在";
      return `${started}-${ended} ${segment.appName} ${segment.activityLabel}：${segment.summary}`;
    })
    .join(" | ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
