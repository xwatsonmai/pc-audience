import type { DanmakuCandidate, DanmakuMessage } from "./types";

const BLOCKED_PATTERNS = [
  /废物/u,
  /垃圾/u,
  /傻/u,
  /蠢/u,
  /白痴/u,
  /弱智/u,
  /去死/u,
  /丑/u,
  /胖/u,
  /病/u,
  /人格/u,
  /没救/u,
  /\bidle\b/iu,
  /任务未设置/u,
  /鼠标悬停/u,
  /光标悬停/u,
  /置信度/u,
  /任务关系/u,
  /观察记录/u,
  /信息不够/u,
  /下一帧/u,
  /AI\s*卡壳/iu,
];

export function isSafeDanmakuText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) {
    return false;
  }
  return !BLOCKED_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function selectSafeDanmaku(
  candidates: DanmakuCandidate[],
  recentMessages: Pick<DanmakuMessage, "text">[],
  maxMessages: number,
): DanmakuCandidate[] {
  const limit = Math.max(0, Math.floor(maxMessages));
  const recent = recentMessages.map((message) => normalizeText(message.text)).filter(Boolean);
  const selected: DanmakuCandidate[] = [];
  const seen: string[] = [];

  for (const candidate of candidates) {
    const text = candidate.text.trim();
    const normalized = normalizeText(text);
    if (
      !normalized ||
      !isSafeDanmakuText(text) ||
      recent.some((message) => isDuplicateText(normalized, message)) ||
      seen.some((message) => isDuplicateText(normalized, message))
    ) {
      continue;
    }

    selected.push({ text });
    seen.push(normalized);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function normalizeText(text: string): string {
  return text
    .replace(/[\s"'“”‘’`~!@#$%^&*()_\-+=\[\]{}\\|;:：,，.。/?？<>《》、…]+/g, "")
    .toLowerCase();
}

function isDuplicateText(left: string, right: string): boolean {
  if (left === right) {
    return true;
  }
  if (left.length >= 8 && right.length >= 8 && (left.includes(right) || right.includes(left))) {
    return true;
  }
  return diceCoefficient(left, right) >= 0.72;
}

function diceCoefficient(left: string, right: string): number {
  if (left.length < 4 || right.length < 4) {
    return 0;
  }
  const leftPairs = bigrams(left);
  const rightPairs = bigrams(right);
  if (leftPairs.length === 0 || rightPairs.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const pair of rightPairs) {
    rightCounts.set(pair, (rightCounts.get(pair) ?? 0) + 1);
  }

  let overlap = 0;
  for (const pair of leftPairs) {
    const count = rightCounts.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(pair, count - 1);
    }
  }

  return (2 * overlap) / (leftPairs.length + rightPairs.length);
}

function bigrams(text: string): string[] {
  const pairs: string[] = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    pairs.push(text.slice(index, index + 2));
  }
  return pairs;
}
