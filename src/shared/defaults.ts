import type { AppLanguage, AppSettings, PersonaId } from "./types";

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

export const PERSONA_LABELS_BY_LANGUAGE: Record<AppLanguage, Record<PersonaId, string>> = {
  "zh-CN": PERSONA_LABELS,
  "en-US": {
    sharp_supervisor: "Wry Supervisor",
    gentle_coach: "Gentle Coach",
    sarcastic_friend: "Sarcastic Friend",
    future_self: "Future Self",
  },
};

export const PERSONA_DESCRIPTIONS_BY_LANGUAGE: Record<AppLanguage, Record<PersonaId, string>> = {
  "zh-CN": PERSONA_DESCRIPTIONS,
  "en-US": {
    sharp_supervisor: "Teases drifting behavior without attacking the person.",
    gentle_coach: "Friendly reminders to come back.",
    sarcastic_friend: "Dry and playful, but still fair.",
    future_self: "Reminds the present from tomorrow's point of view.",
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  language: "zh-CN",
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
  showDebugPanel: false,
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
  const requestedLanguage = isAppLanguage(patch.language) ? patch.language : current.language;

  return {
    ...current,
    ...patch,
    language: requestedLanguage,
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

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "zh-CN" || value === "en-US";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
