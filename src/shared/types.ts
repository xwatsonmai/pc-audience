export type ProviderMode = "openai" | "ollama";

export type PersonaId =
  | "sharp_supervisor"
  | "gentle_coach"
  | "sarcastic_friend"
  | "future_self";

export type TaskRelation =
  | "on_task"
  | "off_task"
  | "break"
  | "unrelated"
  | "no_task"
  | "unknown";

export type EngineState =
  | "idle"
  | "paused"
  | "capturing"
  | "analyzing"
  | "needs_config"
  | "sensitive_skipped"
  | "error";

export interface AppSettings {
  visionProviderMode: ProviderMode;
  textProviderMode: ProviderMode;
  openAiBaseUrl: string;
  openAiApiKey: string;
  openAiVisionModel: string;
  openAiTextModel: string;
  ollamaBaseUrl: string;
  ollamaVisionModel: string;
  ollamaTextModel: string;
  persona: PersonaId;
  paused: boolean;
  observeIntervalMs: number;
  maxDanmakuPerRound: number;
  danmakuSpeed: number;
  hideOverlayDuringCapture: boolean;
  sensitiveApps: string[];
}

export type PublicSettings = Omit<AppSettings, "openAiApiKey"> & {
  hasOpenAiApiKey: boolean;
};

export interface ActiveWindowInfo {
  appName: string;
  windowTitle: string;
}

export interface VisionInput {
  imageBase64: string;
  frameCount: number;
  capturedAt: string;
  activeWindow: ActiveWindowInfo;
  todayTask: string;
}

export interface ObservationDraft {
  capturedAt: string;
  activityLabel: string;
  appName: string;
  windowTitle: string;
  summary: string;
  confidence: number;
  possibleIntent: string;
  taskRelation: TaskRelation;
  isSensitive: boolean;
  source: "vision_ai" | "system_skip" | "fallback";
}

export interface ObservationRecord extends ObservationDraft {
  id: number;
}

export interface BehaviorSegment {
  id: number;
  startedAt: string;
  endedAt: string | null;
  activityLabel: string;
  appName: string;
  summary: string;
  taskRelation: TaskRelation;
  observationCount: number;
  updatedAt: string;
}

export interface MemoryRollup {
  id: number;
  scope: "recent_30m" | "day";
  startedAt: string;
  endedAt: string;
  summary: string;
  updatedAt: string;
}

export interface DanmakuCandidate {
  text: string;
  reason?: string;
  speaker?: string;
}

export type DanmakuCandidateSink = (candidate: DanmakuCandidate) => void | Promise<void>;

export interface DanmakuMessage extends DanmakuCandidate {
  id: number;
  createdAt: string;
  shownAt: string;
  persona: PersonaId;
  observationId: number | null;
  segmentId: number | null;
}

export interface EngineStatus {
  state: EngineState;
  message: string;
  lastRunAt: string | null;
}

export interface DiagnosticEvent {
  id: number;
  at: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
}

export interface AiDebugEvent {
  id: number;
  requestId: string;
  at: string;
  phase: "request" | "response" | "error";
  provider: ProviderMode;
  purpose: "vision" | "danmaku";
  endpoint: string;
  model: string;
  durationMs: number | null;
  timeoutMs: number;
  status: number | null;
  request: unknown;
  response: unknown;
  imagePreviewDataUrl?: string;
}

export interface AppState {
  settings: PublicSettings;
  todayTask: string;
  engineStatus: EngineStatus;
  latestObservation: ObservationRecord | null;
  currentSegment: BehaviorSegment | null;
  recentSegments: BehaviorSegment[];
  rollups: MemoryRollup[];
  recentDanmaku: DanmakuMessage[];
  diagnostics: DiagnosticEvent[];
  aiDebugEvents: AiDebugEvent[];
}

export interface DanmakuContext {
  observation: ObservationRecord;
  currentSegment: BehaviorSegment | null;
  recentSegments: BehaviorSegment[];
  rollups: MemoryRollup[];
  todayTask: string;
  persona: PersonaId;
  recentMessages: DanmakuMessage[];
  maxMessages: number;
  reserveMessages: number;
}
