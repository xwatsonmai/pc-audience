import type { DanmakuCandidate, ObservationDraft, TaskRelation } from "./types";

const TASK_RELATIONS: TaskRelation[] = [
  "on_task",
  "off_task",
  "break",
  "unrelated",
  "no_task",
  "unknown",
];

export function extractJson<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const starts = [objectStart, arrayStart].filter((index) => index >= 0);
    if (starts.length === 0) {
      throw new Error("No JSON object or array found");
    }

    const start = Math.min(...starts);
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === open) {
        depth += 1;
      }
      if (char === close) {
        depth -= 1;
        if (depth === 0) {
          return JSON.parse(trimmed.slice(start, index + 1)) as T;
        }
      }
    }
    throw new Error("Incomplete JSON payload");
  }
}

export function normalizeObservationDraft(
  raw: unknown,
  fallback: Pick<ObservationDraft, "capturedAt" | "appName" | "windowTitle">,
): ObservationDraft {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const relation = String(value.taskRelation ?? value.task_relation ?? "unknown") as TaskRelation;
  const confidence = Number(value.confidence ?? 0);

  return {
    capturedAt: fallback.capturedAt,
    activityLabel: safeString(value.activityLabel ?? value.activity_label, "unknown"),
    appName: safeString(value.appName ?? value.app_name, fallback.appName || "Unknown"),
    windowTitle: safeString(value.windowTitle ?? value.window_title, fallback.windowTitle || ""),
    summary: safeString(value.summary, "AI 没有返回可用摘要"),
    confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0,
    possibleIntent: safeString(value.possibleIntent ?? value.possible_intent, "unknown"),
    taskRelation: TASK_RELATIONS.includes(relation) ? relation : "unknown",
    isSensitive: Boolean(value.isSensitive ?? value.is_sensitive ?? false),
    source: "vision_ai",
  };
}

export function normalizeDanmakuCandidates(raw: unknown): DanmakuCandidate[] {
  const payload = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { messages?: unknown }).messages)
      ? (raw as { messages: unknown[] }).messages
      : [];

  return payload
    .map((item): DanmakuCandidate | null => {
      if (typeof item === "string") {
        return { text: item };
      }
      if (typeof item !== "object" || item === null) {
        return null;
      }
      const value = item as Record<string, unknown>;
      const candidate: DanmakuCandidate = {
        text: safeString(value.text ?? value.message, ""),
      };
      const reason = safeString(value.reason, "");
      const speaker = safeString(value.speaker ?? value.role ?? value.voice, "");
      if (reason) {
        candidate.reason = reason;
      }
      if (speaker) {
        candidate.speaker = speaker;
      }
      return candidate;
    })
    .filter((item): item is DanmakuCandidate => Boolean(item?.text));
}

function safeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
