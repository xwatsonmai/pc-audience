import type { AppSettings, PersonaId } from "./types";

export const PERSONA_LABELS: Record<PersonaId, string> = {
  sharp_supervisor: "轻毒舌监督员",
  gentle_coach: "温柔教练",
  sarcastic_friend: "阴阳怪气朋友",
  future_self: "未来的自己",
};

export const PERSONA_DESCRIPTIONS: Record<PersonaId, string> = {
  sharp_supervisor: "调侃偏离行为，但不攻击人。",
  gentle_coach: "更像朋友，提醒你回来。",
  sarcastic_friend: "会阴阳怪气，但保持分寸。",
  future_self: "从明天的视角提醒现在。",
};

export const DEFAULT_SETTINGS: AppSettings = {
  visionProviderMode: "openai",
  textProviderMode: "openai",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiApiKey: "",
  openAiVisionModel: "",
  openAiTextModel: "",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaVisionModel: "",
  ollamaTextModel: "",
  persona: "sharp_supervisor",
  paused: true,
  observeIntervalMs: 10_000,
  maxDanmakuPerRound: 6,
  danmakuSpeed: 0.65,
  hideOverlayDuringCapture: true,
  sensitiveApps: [
    "1Password",
    "Bitwarden",
    "Keychain Access",
    "Password",
    "Bank",
    "Authenticator",
  ],
};

export function toPublicSettings(settings: AppSettings) {
  const { openAiApiKey: _openAiApiKey, ...rest } = settings;
  return {
    ...rest,
    hasOpenAiApiKey: Boolean(settings.openAiApiKey.trim()),
  };
}

export function mergeSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  const requestedMaxDanmaku =
    typeof patch.maxDanmakuPerRound === "number"
      ? patch.maxDanmakuPerRound
      : current.maxDanmakuPerRound;
  const requestedDanmakuSpeed =
    typeof patch.danmakuSpeed === "number"
      ? patch.danmakuSpeed
      : current.danmakuSpeed;

  return {
    ...current,
    ...patch,
    sensitiveApps: Array.isArray(patch.sensitiveApps)
      ? patch.sensitiveApps
          .map((item) => item.trim())
          .filter(Boolean)
      : current.sensitiveApps,
    observeIntervalMs: DEFAULT_SETTINGS.observeIntervalMs,
    maxDanmakuPerRound: clamp(Math.round(requestedMaxDanmaku), 1, 12),
    danmakuSpeed: clamp(Number(requestedDanmakuSpeed.toFixed(2)), 0.4, 1.3),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
