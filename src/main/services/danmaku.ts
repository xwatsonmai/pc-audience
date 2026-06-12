import { selectSafeDanmaku } from "../../shared/safety";
import type { DanmakuContext, DanmakuMessage } from "../../shared/types";
import type { DanmakuProvider } from "../ai/providers";
import { DatabaseService } from "../database";

export class DanmakuService {
  constructor(private readonly database: DatabaseService) {}

  async generateAndStore(
    provider: DanmakuProvider,
    context: DanmakuContext,
    onStored?: (messages: DanmakuMessage[]) => void,
  ): Promise<DanmakuMessage[]> {
    const reserveTarget = Math.max(context.maxMessages, context.reserveMessages);
    const stored: DanmakuMessage[] = [];
    const recentTexts: Array<Pick<DanmakuMessage, "text">> = [...context.recentMessages];
    const handledCandidates = new Set<string>();
    const now = new Date().toISOString();

    const storeCandidate = (candidate: { text: string }): void => {
      if (stored.length >= reserveTarget) {
        return;
      }
      const key = canonicalText(candidate.text);
      if (!key || handledCandidates.has(key)) {
        return;
      }
      handledCandidates.add(key);
      const [selected] = selectSafeDanmaku([candidate], recentTexts, 1);
      if (!selected) {
        return;
      }
      const message = this.database.insertDanmaku(
        {
          persona: context.persona,
          text: selected.text,
          reason: undefined,
          speaker: undefined,
          observationId: context.observation.id,
          segmentId: context.currentSegment?.id ?? null,
        },
        now,
      );
      stored.push(message);
      recentTexts.push({ text: message.text });
      onStored?.([message]);
    };

    try {
      const candidates = await provider.generateDanmaku(context, storeCandidate);
      for (const candidate of candidates) {
        storeCandidate(candidate);
      }
    } catch {
      // The provider already records debug errors. No fixed copy fallback:
      // if the room has no fresh lines, the overlay should simply stay quiet.
    }

    return stored;
  }
}

function canonicalText(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}
