import { useEffect, useMemo, useRef, useState } from "react";
import type { DanmakuMessage } from "../../shared/types";

interface FlyingMessage {
  key: string;
  text: string;
  lane: number;
  top: number;
  duration: number;
  startedAt: number;
}

interface QueuedMessage {
  message: DanmakuMessage;
  queuedAt: number;
}

const LANE_TOPS = [6, 10.8, 15.6, 20.4, 25.2, 30, 35, 41, 47, 53, 60, 67, 74];
const MAX_QUEUE_SIZE = 240;
const QUEUE_TTL_MS = 90_000;

export default function Overlay() {
  const [messages, setMessages] = useState<FlyingMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const messagesRef = useRef<FlyingMessage[]>([]);
  const lastReleaseAtRef = useRef(0);
  const densityRef = useRef(6);
  const speedRef = useRef(0.65);

  useEffect(() => {
    const unsubscribe = window.audience.onDanmaku((incoming) => {
      const now = Date.now();
      queueRef.current = pruneQueue([
        ...queueRef.current,
        ...incoming.map((message) => ({ message, queuedAt: now })),
      ], now);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void window.audience.getState().then((state) => {
      densityRef.current = clampDensity(state.settings.maxDanmakuPerRound);
      speedRef.current = clampSpeed(state.settings.danmakuSpeed);
    });
    const unsubscribe = window.audience.onState((state) => {
      densityRef.current = clampDensity(state.settings.maxDanmakuPerRound);
      speedRef.current = clampSpeed(state.settings.danmakuSpeed);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
    window.audience.setOverlayActivity(messages.length);
  }, [messages]);

  useEffect(() => () => {
    window.audience.setOverlayActivity(0);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const pump = () => {
      const now = Date.now();
      queueRef.current = pruneQueue(queueRef.current);
      const reserve = queueRef.current.length;
      const decision = decideRelease({
        reserve,
        activeMessages: messagesRef.current,
        targetDensity: densityRef.current,
        speed: speedRef.current,
        now,
        lastReleaseAt: lastReleaseAtRef.current,
      });
      const released = releaseQueuedMessages(decision.count, now);
      if (released > 0) {
        lastReleaseAtRef.current = now;
      }
      timer = window.setTimeout(
        pump,
        decision.nextDelay,
      );
    };

    timer = window.setTimeout(pump, 360);
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const nodes = useMemo(
    () =>
      messages.map((message) => (
        <div
          className="danmaku-line"
          key={message.key}
          style={{
            top: `${message.top}%`,
            animationDuration: `${message.duration}s`,
          }}
          onAnimationEnd={() => {
            setMessages((current) => {
              const next = current.filter((item) => item.key !== message.key);
              messagesRef.current = next;
              return next;
            });
          }}
        >
          <span>{message.text}</span>
        </div>
      )),
    [messages],
  );

  return <div className="overlay-stage">{nodes}</div>;

  function releaseQueuedMessages(count: number, now = Date.now()): number {
    if (count <= 0) {
      return 0;
    }
    const incoming = queueRef.current.splice(0, count).map((item) => item.message);
    if (incoming.length === 0) {
      return 0;
    }
    setMessages((current) => {
      const staged: FlyingMessage[] = [];
      const next = incoming.map((message) => {
        const lane = chooseLane([...current, ...staged], now);
        const flying = toFlyingMessage(message, lane, speedRef.current, now);
        staged.push(flying);
        return flying;
      });
      const updated = [...current, ...next].slice(-64);
      messagesRef.current = updated;
      return updated;
    });
    return incoming.length;
  }
}

function toFlyingMessage(message: DanmakuMessage, lane: number, speed: number, now: number): FlyingMessage {
  const jitter = (Math.random() - 0.5) * 0.8;
  return {
    key: `${message.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text: message.text,
    lane,
    top: Math.max(4, Math.min(78, LANE_TOPS[lane] + jitter)),
    duration: (11 + Math.random() * 4) / speed,
    startedAt: now,
  };
}

function chooseLane(activeMessages: FlyingMessage[], now: number): number {
  const laneScores = LANE_TOPS.map((_, lane) => {
    const activeInLane = activeMessages.filter((message) => (
      message.lane === lane && laneOccupancy(message, now) > 0
    ));
    if (activeInLane.length === 0) {
      return { lane, score: 0 };
    }
    const score = activeInLane.reduce((max, message) => Math.max(max, laneOccupancy(message, now)), 0);
    return { lane, score };
  });

  const freeLane = laneScores.find((item) => item.score === 0);
  if (freeLane) {
    return freeLane.lane;
  }

  return laneScores.reduce((best, item) => (item.score < best.score ? item : best)).lane;
}

function laneOccupancy(message: FlyingMessage, now: number): number {
  const elapsed = now - message.startedAt;
  const durationMs = message.duration * 1_000;
  if (elapsed >= durationMs) {
    return 0;
  }
  const progress = elapsed / durationMs;
  return progress < 0.34 ? 1 : Math.max(0, 1 - (progress - 0.34) / 0.16);
}

function decideRelease({
  reserve,
  activeMessages,
  targetDensity,
  speed,
  now,
  lastReleaseAt,
}: {
  reserve: number;
  activeMessages: FlyingMessage[];
  targetDensity: number;
  speed: number;
  now: number;
  lastReleaseAt: number;
}): { count: number; nextDelay: number } {
  if (reserve <= 0) {
    return { count: 0, nextDelay: 260 };
  }

  const active = activeMessages.length;
  const capacity = Math.max(0, targetDensity - active);
  if (capacity <= 0) {
    return { count: 0, nextDelay: 420 };
  }

  if (reserve <= 2) {
    if (active === 0) {
      return { count: 1, nextDelay: 480 };
    }
    const waitMs = timeUntilNewestReaches(activeMessages, now, 0.48);
    return waitMs <= 0
      ? { count: 1, nextDelay: 700 }
      : { count: 0, nextDelay: clampDelay(waitMs, 220, 3_200) };
  }

  const releaseInterval = computeReleaseIntervalMs(reserve, targetDensity, speed);
  const elapsedSinceRelease = lastReleaseAt > 0 ? now - lastReleaseAt : Number.POSITIVE_INFINITY;
  if (active > 0 && elapsedSinceRelease < releaseInterval) {
    return {
      count: 0,
      nextDelay: clampDelay(releaseInterval - elapsedSinceRelease, 160, 2_400),
    };
  }

  const readyLanes = countReadyLanes(activeMessages, now);
  if (active > 0 && readyLanes <= 0) {
    return { count: 0, nextDelay: 280 };
  }

  const warmStart = active === 0 && reserve >= targetDensity * 2 ? 2 : 1;
  const richRoomBurst = reserve >= targetDensity * 4 && active < Math.max(2, targetDensity * 0.35) ? 2 : 1;
  const count = active === 0 ? warmStart : richRoomBurst;
  return {
    count: Math.min(capacity, reserve, Math.max(1, readyLanes), count),
    nextDelay: releaseInterval,
  };
}

function computeReleaseIntervalMs(reserve: number, targetDensity: number, speed: number): number {
  const estimatedDuration = (13_000 / Math.max(0.4, speed));
  const upperLaneReuseWindow = estimatedDuration * 0.46;
  const upperLaneCount = 6;
  const densityInterval = estimatedDuration / Math.max(1, targetDensity);
  const upperFirstInterval = upperLaneReuseWindow / upperLaneCount;
  const base = Math.max(densityInterval, upperFirstInterval);
  const pressure =
    reserve >= targetDensity * 4 ? 0.72 :
    reserve >= targetDensity * 2 ? 0.86 :
    reserve >= targetDensity ? 1 :
    1.35;
  return clampDelay(base * pressure, 850, 4_500);
}

function countReadyLanes(activeMessages: FlyingMessage[], now: number): number {
  return LANE_TOPS.filter((_, lane) =>
    activeMessages.every((message) => message.lane !== lane || laneOccupancy(message, now) <= 0)
  ).length;
}

function timeUntilNewestReaches(messages: FlyingMessage[], now: number, progress: number): number {
  const newest = messages.reduce<FlyingMessage | null>(
    (latest, message) => (!latest || message.startedAt > latest.startedAt ? message : latest),
    null,
  );
  if (!newest) {
    return 0;
  }
  const targetMs = newest.duration * 1_000 * progress;
  return targetMs - (now - newest.startedAt);
}

function clampDelay(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function pruneQueue(queue: QueuedMessage[], now = Date.now()): QueuedMessage[] {
  return queue
    .filter((item) => now - item.queuedAt <= QUEUE_TTL_MS)
    .slice(-MAX_QUEUE_SIZE);
}

function clampDensity(value: number): number {
  if (!Number.isFinite(value)) {
    return 6;
  }
  return Math.min(12, Math.max(1, Math.round(value)));
}

function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.65;
  }
  return Math.min(1.3, Math.max(0.4, value));
}
