import { shouldMergeObservation, summarizeSegments } from "../../shared/behavior";
import type {
  BehaviorSegment,
  MemoryRollup,
  ObservationDraft,
  ObservationRecord,
} from "../../shared/types";
import { DatabaseService } from "../database";

export class MemoryService {
  constructor(private readonly database: DatabaseService) {}

  recordObservation(draft: ObservationDraft): {
    observation: ObservationRecord;
    currentSegment: BehaviorSegment | null;
    rollups: MemoryRollup[];
  } {
    const observation = this.database.insertObservation(draft);
    let currentSegment: BehaviorSegment | null = this.database.getCurrentSegment();

    if (observation.isSensitive) {
      this.database.closeCurrentSegment(observation.capturedAt);
      currentSegment = null;
    } else if (currentSegment && shouldMergeObservation(currentSegment, observation)) {
      currentSegment = this.database.extendSegment(currentSegment, observation);
    } else {
      this.database.closeCurrentSegment(observation.capturedAt);
      currentSegment = this.database.createSegment(observation);
    }

    const rollups = this.refreshRollups(observation.capturedAt);
    return { observation, currentSegment, rollups };
  }

  getContext() {
    return {
      latestObservation: this.database.getLatestObservation(),
      currentSegment: this.database.getCurrentSegment(),
      recentSegments: this.database.getRecentSegments(),
      rollups: this.database.getRollups(),
      recentDanmaku: this.database.getRecentDanmaku(),
    };
  }

  refreshRollups(nowIso: string): MemoryRollup[] {
    const now = new Date(nowIso);
    const recentStart = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const recentSegments = this.database.getSegmentsSince(recentStart);
    const daySegments = this.database.getSegmentsSince(dayStart.toISOString());

    const recent = this.database.upsertRollup(
      "recent_30m",
      recentStart,
      nowIso,
      summarizeSegments(recentSegments),
    );
    const day = this.database.upsertRollup(
      "day",
      dayStart.toISOString(),
      nowIso,
      summarizeSegments(daySegments),
    );

    return [recent, day];
  }
}
