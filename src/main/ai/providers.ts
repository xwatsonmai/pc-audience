import { extractJson, normalizeDanmakuCandidates, normalizeObservationDraft } from "../../shared/json";
import type {
  AiDebugEvent,
  AppSettings,
  DanmakuCandidate,
  DanmakuCandidateSink,
  DanmakuContext,
  ObservationDraft,
  ProviderMode,
  VisionInput,
} from "../../shared/types";
import { danmakuPrompt, visionPrompt } from "./prompts";

export interface VisionProvider {
  analyze(input: VisionInput): Promise<ObservationDraft>;
}

export interface DanmakuProvider {
  generateDanmaku(context: DanmakuContext, onCandidate?: DanmakuCandidateSink): Promise<DanmakuCandidate[]>;
}

export type AiDebugSink = (event: Omit<AiDebugEvent, "id" | "at">) => void;

export function getConfigIssue(settings: AppSettings): string | null {
  const en = settings.language === "en-US";
  if (settings.visionProviderMode === "openai" || settings.textProviderMode === "openai") {
    if (!settings.openAiBaseUrl.trim()) return en ? "Please fill in OpenAI-compatible Base URL" : "请填写 OpenAI-compatible Base URL";
    if (!settings.openAiApiKey.trim()) return en ? "Please fill in OpenAI-compatible API Key" : "请填写 OpenAI-compatible API Key";
  }
  if (settings.visionProviderMode === "ollama" || settings.textProviderMode === "ollama") {
    if (!settings.ollamaBaseUrl.trim()) return en ? "Please fill in Ollama URL" : "请填写 Ollama 地址";
  }
  if (settings.visionProviderMode === "openai" && !settings.openAiVisionModel.trim()) {
    return en ? "Please fill in OpenAI-compatible vision model" : "请填写 OpenAI-compatible 视觉模型名";
  }
  if (settings.visionProviderMode === "ollama" && !settings.ollamaVisionModel.trim()) {
    return en ? "Please fill in Ollama vision model" : "请填写 Ollama 视觉模型名";
  }
  if (settings.textProviderMode === "openai" && !settings.openAiTextModel.trim()) {
    return en ? "Please fill in OpenAI-compatible danmaku text model" : "请填写 OpenAI-compatible 弹幕文本模型名";
  }
  if (settings.textProviderMode === "ollama" && !settings.ollamaTextModel.trim()) {
    return en ? "Please fill in Ollama danmaku text model" : "请填写 Ollama 弹幕文本模型名";
  }
  return null;
}

export function createVisionProvider(settings: AppSettings, debugSink?: AiDebugSink): VisionProvider {
  return settings.visionProviderMode === "ollama"
    ? new OllamaProvider(settings, debugSink)
    : new OpenAiCompatibleProvider(settings, debugSink);
}

export function createDanmakuProvider(settings: AppSettings, debugSink?: AiDebugSink): DanmakuProvider {
  return settings.textProviderMode === "ollama"
    ? new OllamaProvider(settings, debugSink)
    : new OpenAiCompatibleProvider(settings, debugSink);
}

class OpenAiCompatibleProvider implements VisionProvider, DanmakuProvider {
  constructor(
    private readonly settings: AppSettings,
    private readonly debugSink?: AiDebugSink,
  ) {}

  async analyze(input: VisionInput): Promise<ObservationDraft> {
    const content = await this.chat("vision", this.settings.openAiVisionModel, [
      { role: "system", content: visionPrompt(input.language) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildVisionUserText(input),
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${input.imageBase64}`,
            },
          },
        ],
      },
    ]);

    return normalizeObservationDraft(extractJson(content), {
      capturedAt: input.capturedAt,
      appName: input.activeWindow.appName,
      windowTitle: input.activeWindow.windowTitle,
    });
  }

  async generateDanmaku(context: DanmakuContext, onCandidate?: DanmakuCandidateSink): Promise<DanmakuCandidate[]> {
    return this.streamDanmaku(this.settings.openAiTextModel, [
      { role: "system", content: danmakuPrompt(context.persona, context.maxMessages, context.language) },
      { role: "user", content: buildDanmakuBrief(context) },
    ], onCandidate);
  }

  private async streamDanmaku(
    model: string,
    messages: unknown[],
    onCandidate?: DanmakuCandidateSink,
  ): Promise<DanmakuCandidate[]> {
    const endpoint = `${trimSlash(this.settings.openAiBaseUrl)}/chat/completions`;
    const timeoutMs = 45_000;
    const requestId = createRequestId("danmaku");
    const body = {
      model,
      messages,
      temperature: 0.7,
      stream: true,
      think: false,
      thinking: false,
      enable_thinking: false,
    };
    const started = Date.now();
    const collector = createDanmakuLineCollector(onCandidate);
    this.debug(requestId, "request", "danmaku", endpoint, model, timeoutMs, null, null, body, null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.settings.openAiApiKey}`,
        },
        signal: timeoutSignal(timeoutMs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.debug(requestId, "error", "danmaku", endpoint, model, timeoutMs, Date.now() - started, response.status, body, errorText);
        throw new Error(`OpenAI-compatible API failed: ${response.status} ${errorText}`);
      }

      await readOpenAiCompatibleTextStream(response, collector.pushChunk);
      const candidates = await collector.finish();
      this.debug(
        requestId,
        "response",
        "danmaku",
        endpoint,
        model,
        timeoutMs,
        Date.now() - started,
        response.status,
        body,
        { content: collector.content(), messages: candidates.map((candidate) => candidate.text) },
      );
      return candidates;
    } catch (error) {
      if (isAbortError(error)) {
        this.debug(requestId, "error", "danmaku", endpoint, model, timeoutMs, Date.now() - started, null, body, "The operation was aborted due to timeout");
      }
      throw error;
    }
  }

  private async chat(purpose: "vision" | "danmaku", model: string, messages: unknown[]): Promise<string> {
    const endpoint = `${trimSlash(this.settings.openAiBaseUrl)}/chat/completions`;
    const timeoutMs = 45_000;
    const requestId = createRequestId(purpose);
    const body = {
      model,
      messages,
      temperature: 0.4,
      response_format: { type: "json_object" },
      think: false,
      thinking: false,
      enable_thinking: false,
    };
    const started = Date.now();
    this.debug(requestId, "request", purpose, endpoint, model, timeoutMs, null, null, body, null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.settings.openAiApiKey}`,
        },
        signal: timeoutSignal(timeoutMs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.debug(requestId, "error", purpose, endpoint, model, timeoutMs, Date.now() - started, response.status, body, errorText);
        throw new Error(`OpenAI-compatible API failed: ${response.status} ${errorText}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      this.debug(requestId, "response", purpose, endpoint, model, timeoutMs, Date.now() - started, response.status, body, payload);
      if (!content) {
        throw new Error("OpenAI-compatible API returned empty content");
      }
      return content;
    } catch (error) {
      if (isAbortError(error)) {
        this.debug(requestId, "error", purpose, endpoint, model, timeoutMs, Date.now() - started, null, body, "The operation was aborted due to timeout");
      }
      throw error;
    }
  }

  private debug(
    requestId: string,
    phase: AiDebugEvent["phase"],
    purpose: AiDebugEvent["purpose"],
    endpoint: string,
    model: string,
    timeoutMs: number,
    durationMs: number | null,
    status: number | null,
    request: unknown,
    response: unknown,
  ): void {
    this.debugSink?.({
      requestId,
      phase,
      provider: "openai",
      purpose,
      endpoint,
      model,
      durationMs,
      timeoutMs,
      status,
      request: sanitizeDebugPayload(request),
      response: sanitizeDebugPayload(response),
      imagePreviewDataUrl: extractImagePreviewDataUrl(request),
    });
  }
}

class OllamaProvider implements VisionProvider, DanmakuProvider {
  constructor(
    private readonly settings: AppSettings,
    private readonly debugSink?: AiDebugSink,
  ) {}

  async analyze(input: VisionInput): Promise<ObservationDraft> {
    const content = await this.chat("vision", this.settings.ollamaVisionModel, [
      { role: "system", content: visionPrompt(input.language) },
      {
        role: "user",
        content: buildVisionUserText(input),
        images: [input.imageBase64],
      },
    ]);
    return normalizeObservationDraft(extractJson(content), {
      capturedAt: input.capturedAt,
      appName: input.activeWindow.appName,
      windowTitle: input.activeWindow.windowTitle,
    });
  }

  async generateDanmaku(context: DanmakuContext, onCandidate?: DanmakuCandidateSink): Promise<DanmakuCandidate[]> {
    return this.streamDanmaku(this.settings.ollamaTextModel, [
      { role: "system", content: danmakuPrompt(context.persona, context.maxMessages, context.language) },
      { role: "user", content: buildDanmakuBrief(context) },
    ], onCandidate);
  }

  private async streamDanmaku(
    model: string,
    messages: unknown[],
    onCandidate?: DanmakuCandidateSink,
  ): Promise<DanmakuCandidate[]> {
    const endpoint = `${trimSlash(this.settings.ollamaBaseUrl)}/api/chat`;
    const timeoutMs = 60_000;
    const requestId = createRequestId("danmaku");
    const body = {
      model,
      messages,
      stream: true,
      think: false,
      options: {
        temperature: 0.7,
      },
    };
    const started = Date.now();
    const collector = createDanmakuLineCollector(onCandidate);
    this.debug(requestId, "request", "danmaku", endpoint, model, timeoutMs, null, null, body, null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: timeoutSignal(timeoutMs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.debug(requestId, "error", "danmaku", endpoint, model, timeoutMs, Date.now() - started, response.status, body, errorText);
        throw new Error(`Ollama API failed: ${response.status} ${errorText}`);
      }

      await readOllamaTextStream(response, collector.pushChunk);
      const candidates = await collector.finish();
      this.debug(
        requestId,
        "response",
        "danmaku",
        endpoint,
        model,
        timeoutMs,
        Date.now() - started,
        response.status,
        body,
        { content: collector.content(), messages: candidates.map((candidate) => candidate.text) },
      );
      return candidates;
    } catch (error) {
      if (isAbortError(error)) {
        this.debug(requestId, "error", "danmaku", endpoint, model, timeoutMs, Date.now() - started, null, body, "The operation was aborted due to timeout");
      }
      throw error;
    }
  }

  private async chat(purpose: "vision" | "danmaku", model: string, messages: unknown[]): Promise<string> {
    const endpoint = `${trimSlash(this.settings.ollamaBaseUrl)}/api/chat`;
    const timeoutMs = 60_000;
    const requestId = createRequestId(purpose);
    const body = {
      model,
      messages,
      stream: false,
      format: "json",
      think: false,
      options: {
        temperature: 0.4,
      },
    };
    const started = Date.now();
    this.debug(requestId, "request", purpose, endpoint, model, timeoutMs, null, null, body, null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: timeoutSignal(timeoutMs),
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.debug(requestId, "error", purpose, endpoint, model, timeoutMs, Date.now() - started, response.status, body, errorText);
        throw new Error(`Ollama API failed: ${response.status} ${errorText}`);
      }
      const payload = (await response.json()) as { message?: { content?: string; thinking?: string } };
      const content = payload.message?.content;
      this.debug(requestId, "response", purpose, endpoint, model, timeoutMs, Date.now() - started, response.status, body, payload);
      if (!content) {
        throw new Error("Ollama returned empty content");
      }
      return content;
    } catch (error) {
      if (isAbortError(error)) {
        this.debug(requestId, "error", purpose, endpoint, model, timeoutMs, Date.now() - started, null, body, "The operation was aborted due to timeout");
      }
      throw error;
    }
  }

  private debug(
    requestId: string,
    phase: AiDebugEvent["phase"],
    purpose: AiDebugEvent["purpose"],
    endpoint: string,
    model: string,
    timeoutMs: number,
    durationMs: number | null,
    status: number | null,
    request: unknown,
    response: unknown,
  ): void {
    this.debugSink?.({
      requestId,
      phase,
      provider: "ollama",
      purpose,
      endpoint,
      model,
      durationMs,
      timeoutMs,
      status,
      request: sanitizeDebugPayload(request),
      response: sanitizeDebugPayload(response),
      imagePreviewDataUrl: extractImagePreviewDataUrl(request),
    });
  }
}

function createRequestId(purpose: AiDebugEvent["purpose"]): string {
  return `${purpose}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sanitizeDebugPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeDebugPayload);
  }
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return `[image data url redacted, chars=${value.length}, approxBytes=${base64ApproxBytes(value)}]`;
    }
    if (isLikelyImageBase64(value)) {
      return `[image base64 redacted, chars=${value.length}, approxBytes=${base64ApproxBytes(value)}]`;
    }
    return value.length > 4_000 ? `${value.slice(0, 4_000)}...[truncated ${value.length} chars]` : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key.toLowerCase().includes("authorization") || key.toLowerCase().includes("api_key")) {
      sanitized[key] = "[redacted]";
    } else {
      sanitized[key] = sanitizeDebugPayload(nested);
    }
  }
  return sanitized;
}

function isLikelyImageBase64(value: string): boolean {
  return value.length > 20_000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 512));
}

function extractImagePreviewDataUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractImagePreviewDataUrl(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) {
      return value;
    }
    if (isLikelyImageBase64(value)) {
      return `data:image/png;base64,${value}`;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  for (const nested of Object.values(value)) {
    const found = extractImagePreviewDataUrl(nested);
    if (found) return found;
  }
  return undefined;
}

function base64ApproxBytes(value: string): number {
  const raw = value.includes(",") ? value.split(",").at(-1) ?? "" : value;
  return Math.round((raw.length * 3) / 4);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "TimeoutError"
  ) || (
    error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function createDanmakuLineCollector(onCandidate?: DanmakuCandidateSink): {
  pushChunk: (chunk: string) => Promise<void>;
  finish: () => Promise<DanmakuCandidate[]>;
  content: () => string;
} {
  let buffer = "";
  let content = "";
  const candidates: DanmakuCandidate[] = [];
  const seen = new Set<string>();

  const emitCandidate = async (candidate: DanmakuCandidate): Promise<void> => {
    const key = canonicalText(candidate.text);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(candidate);
    await onCandidate?.(candidate);
  };

  const emitLine = async (line: string): Promise<void> => {
    const candidate = normalizeDanmakuTextLine(line);
    if (candidate) {
      await emitCandidate(candidate);
    }
  };

  return {
    async pushChunk(chunk: string): Promise<void> {
      if (!chunk) {
        return;
      }
      content += chunk;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await emitLine(line);
      }
    },
    async finish(): Promise<DanmakuCandidate[]> {
      if (buffer.trim()) {
        await emitLine(buffer);
        buffer = "";
      }
      if (candidates.length === 0) {
        for (const candidate of normalizeDanmakuTextContent(content)) {
          await emitCandidate(candidate);
        }
      }
      return candidates;
    },
    content: () => content,
  };
}

export function normalizeDanmakuTextContent(content: string): DanmakuCandidate[] {
  try {
    const jsonCandidates = normalizeDanmakuCandidates(extractJson(content));
    if (jsonCandidates.length > 0) {
      return jsonCandidates;
    }
  } catch {
    // Some OpenAI-compatible servers ignore the prompt shape. Fall back to line parsing.
  }

  return content
    .split(/\r?\n/)
    .map(normalizeDanmakuTextLine)
    .filter((candidate): candidate is DanmakuCandidate => Boolean(candidate));
}

function normalizeDanmakuTextLine(line: string): DanmakuCandidate | null {
  let text = line
    .replace(/\u0000/g, "")
    .trim();
  if (!text || text.startsWith("```")) {
    return null;
  }
  if (/^[\s{}\[\],:"]+$/.test(text) || /^[{\[]/.test(text) || /[}\]]$/.test(text)) {
    return null;
  }
  if (/^["']?messages["']?\s*[:：]\s*$/i.test(text)) {
    return null;
  }

  text = text
    .replace(/^\s*(?:[-*•]|[0-9]{1,2}[.、)]|弹幕[0-9一二三四五六七八九十]*[:：])\s*/u, "")
    .replace(/^["“”'`]+|["“”'`,，。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text || text.length < 2 || /^[{}\[\],:"]+$/.test(text)) {
    return null;
  }

  return { text: compact(text, 64) };
}

async function readOpenAiCompatibleTextStream(
  response: Response,
  onText: (chunk: string) => Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new Error("OpenAI-compatible API returned empty stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      await processOpenAiSseEvent(event, onText);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processOpenAiSseEvent(buffer, onText);
  }
}

async function processOpenAiSseEvent(
  event: string,
  onText: (chunk: string) => Promise<void>,
): Promise<void> {
  const dataLines = event
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);

  for (const data of dataLines) {
    if (data === "[DONE]") {
      continue;
    }
    const payload = JSON.parse(data) as {
      choices?: Array<{
        delta?: { content?: string };
        message?: { content?: string };
      }>;
    };
    const chunk = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
    if (chunk) {
      await onText(chunk);
    }
  }
}

async function readOllamaTextStream(
  response: Response,
  onText: (chunk: string) => Promise<void>,
): Promise<void> {
  if (!response.body) {
    throw new Error("Ollama returned empty stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      await processOllamaStreamLine(line, onText);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processOllamaStreamLine(buffer, onText);
  }
}

async function processOllamaStreamLine(
  line: string,
  onText: (chunk: string) => Promise<void>,
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  const payload = JSON.parse(trimmed) as {
    message?: { content?: string };
    response?: string;
  };
  const chunk = payload.message?.content ?? payload.response ?? "";
  if (chunk) {
    await onText(chunk);
  }
}

function canonicalText(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
}

export function normalizeBaseUrlForProvider(mode: ProviderMode, url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (mode !== "ollama" || !/^https?:\/\/[^/:]+$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}:11434`;
}

function buildVisionUserText(input: VisionInput): string {
  if (input.language === "en-US") {
    return [
      `This is a time-ordered screen contact sheet with ${input.frameCount} frame(s), arranged left-to-right and top-to-bottom.`,
      `Foreground app: ${input.activeWindow.appName || "Unknown"}`,
      `Window title: ${input.activeWindow.windowTitle || "Unknown"}`,
      `Today's task: ${input.todayTask || "not provided"}`,
      "The white cursor with a dark outline marks the current mouse position.",
      "Objectively summarize the user's current behavior in English. Do not judge the person and do not generate danmaku.",
    ].join("\n");
  }

  return [
    `这是一张按时间从左到右、从上到下排列的屏幕抽帧拼图，共 ${input.frameCount} 帧。`,
    `当前前台应用：${input.activeWindow.appName || "Unknown"}`,
    `当前窗口标题：${input.activeWindow.windowTitle || "Unknown"}`,
    `今日任务：${input.todayTask || "用户没有填写"}`,
    "图中白色黑边小箭头标记当前鼠标位置。",
    "请客观总结用户当前行为，不要评价人格，不要生成弹幕。",
  ].join("\n");
}

function buildDanmakuBrief(context: DanmakuContext): string {
  if (context.language === "en-US") {
    return buildEnglishDanmakuBrief(context);
  }

  const observation = context.observation;
  const current = context.currentSegment;
  const relation = relationText(observation.taskRelation, context.language);
  const confidence = Math.round(observation.confidence * 100);
  const taskLine = context.todayTask.trim()
    ? `今日任务：${compact(context.todayTask, 60)}`
    : "今日任务：未设置";
  const currentLine = [
    `当前：${compact(observation.summary, 80)}`,
    `应用：${compact(observation.appName, 24)}`,
    `行为：${observation.activityLabel}`,
    `任务关系：${relation}`,
    `置信度：${confidence}%`,
  ].join("；");
  const segmentLine = current
    ? `当前连续段：${compact(current.appName, 24)} / ${current.activityLabel}，连续 ${current.observationCount} 轮，${compact(current.summary, 90)}`
    : "当前连续段：暂无";
  const timeline = buildTimeline(context);
  const rollup = context.rollups
    .map((item) => compact(item.summary, item.scope === "recent_30m" ? 90 : 70))
    .filter(Boolean)
    .join(" / ");
  const recentDanmaku = context.recentMessages
    .slice(0, 12)
    .map((message) => compact(message.text, 32))
    .filter(Boolean)
    .join(" ｜ ");

  return [
    taskLine,
    buildDirectorBrief(context),
    currentLine,
    segmentLine,
    `行为轨迹：${timeline || "暂无更早轨迹"}`,
    rollup ? `滚动总结：${rollup}` : "",
    recentDanmaku ? `最近已发弹幕，避免复读：${recentDanmaku}` : "最近已发弹幕：暂无",
    `请产出最多 ${context.maxMessages} 条弹幕；质量优先，不要为了凑数硬写。`,
  ].filter(Boolean).join("\n");
}

function buildEnglishDanmakuBrief(context: DanmakuContext): string {
  const observation = context.observation;
  const current = context.currentSegment;
  const relation = relationText(observation.taskRelation, context.language);
  const confidence = Math.round(observation.confidence * 100);
  const taskLine = context.todayTask.trim()
    ? `Today's task: ${compact(context.todayTask, 60)}`
    : "Today's task: not set";
  const currentLine = [
    `Current: ${compact(observation.summary, 100)}`,
    `App: ${compact(observation.appName, 24)}`,
    `Activity: ${observation.activityLabel}`,
    `Task relation: ${relation}`,
    `Confidence: ${confidence}%`,
  ].join("; ");
  const segmentLine = current
    ? `Current segment: ${compact(current.appName, 24)} / ${current.activityLabel}, ${current.observationCount} round(s), ${compact(current.summary, 110)}`
    : "Current segment: none";
  const timeline = buildTimeline(context);
  const rollup = context.rollups
    .map((item) => compact(item.summary, item.scope === "recent_30m" ? 100 : 80))
    .filter(Boolean)
    .join(" / ");
  const recentDanmaku = context.recentMessages
    .slice(0, 12)
    .map((message) => compact(message.text, 44))
    .filter(Boolean)
    .join(" | ");

  return [
    "Target danmaku language: English.",
    taskLine,
    buildDirectorBrief(context),
    currentLine,
    segmentLine,
    `Behavior timeline: ${timeline || "no earlier timeline yet"}`,
    rollup ? `Rollup: ${rollup}` : "",
    recentDanmaku ? `Recent danmaku to avoid repeating: ${recentDanmaku}` : "Recent danmaku: none",
    `Produce at most ${context.maxMessages} danmaku lines; quality first, do not force filler.`,
  ].filter(Boolean).join("\n");
}

function buildDirectorBrief(context: DanmakuContext): string {
  const observation = context.observation;
  const current = context.currentSegment;
  const previous = context.recentSegments.find((segment) => !current || segment.id !== current.id);
  const idleLike = isIdleLike(observation.activityLabel);
  const stableIdle = idleLike && (current?.observationCount ?? 1) >= 3;
  const justChanged = Boolean(current && previous && current.observationCount <= 1);
  const lowConfidence = observation.confidence < 0.65 || observation.activityLabel === "unknown";
  const relation = observation.taskRelation;
  const noTask = !context.todayTask.trim();

  const mode = chooseRoomMode({
    language: context.language,
    stableIdle,
    justChanged,
    lowConfidence,
    relation,
    noTask,
  });
  const voices = chooseAudienceVoices({
    language: context.language,
    stableIdle,
    justChanged,
    relation,
    noTask,
  });
  const cooldownTopics = buildCooldownTopics(context.recentMessages, context.language);
  const forbiddenTerms = buildForbiddenTerms({
    language: context.language,
    stableIdle,
    lowConfidence,
    noTask,
  });

  if (context.language === "en-US") {
    return [
      "Room director instructions:",
      `- Round vibe: ${mode}`,
      `- Audience mix: ${voices}`,
      cooldownTopics ? `- Cool down recent overused topics: ${cooldownTopics}` : "",
      `- Do not directly say these terms: ${forbiddenTerms.join(", ")}`,
      "- Each line should feel like a different viewer drifting by; riff if possible, otherwise switch to everyday chatter; do not rewrite the screen summary as danmaku.",
    ].filter(Boolean).join("\n");
  }

  return [
    "直播间导演指令：",
    `- 本轮气氛：${mode}`,
    `- 观众构成：${voices}`,
    cooldownTopics ? `- 近几条高频主题冷却：${cooldownTopics}` : "",
    `- 禁止直接说这些词：${forbiddenTerms.join("、")}`,
    "- 每条像不同观众自然飘过；能接梗就接梗，不能接梗就换生活话题；别把屏幕摘要改写成弹幕。",
  ].filter(Boolean).join("\n");
}

function chooseRoomMode({
  language,
  stableIdle,
  justChanged,
  lowConfidence,
  relation,
  noTask,
}: {
  language: string;
  stableIdle: boolean;
  justChanged: boolean;
  lowConfidence: boolean;
  relation: string;
  noTask: boolean;
}): string {
  if (language === "en-US") {
    if (stableIdle || lowConfidence) {
      return "Little changed on screen; about 20% behavior comments and 80% casual chat/riffs/passersby energy. Do not fixate on the cursor or window.";
    }
    if (justChanged) {
      return "A switch just happened; about 60% behavior reaction and 40% casual chat. Make it feel like viewers noticed the plot changed.";
    }
    if (relation === "off_task") {
      return "Likely off task; about 50% light teasing and 50% companionable chat. Tease the behavior only, not the person.";
    }
    if (relation === "on_task") {
      return "On task; about 50% cheering/co-working, 20% light teasing, 30% daily-life chat.";
    }
    if (noTask) {
      return "No clear task; do not harp on tasks. About 30% behavior comments and 70% casual live-room presence.";
    }
    return "Normal watch-along; about 40% behavior comments and 60% casual chat/riffs.";
  }

  if (stableIdle || lowConfidence) {
    return "画面变化少，行为评论约2成，闲聊/接梗/路过感约8成；不要硬盯鼠标或窗口。";
  }
  if (justChanged) {
    return "刚发生切换，行为评论约6成，闲聊约4成；重点像观众发现剧情变了。";
  }
  if (relation === "off_task") {
    return "疑似偏离任务，轻度调侃约5成，陪伴闲聊约5成；只调侃行为，不审判人。";
  }
  if (relation === "on_task") {
    return "贴近任务，捧场/陪跑约5成，轻微吐槽约2成，生活闲聊约3成。";
  }
  if (noTask) {
    return "没有明确任务，少拿任务说事；行为评论约3成，日常聊天和现场感约7成。";
  }
  return "普通陪看状态，行为评论约4成，闲聊/接梗/捧哏约6成。";
}

function chooseAudienceVoices({
  language,
  stableIdle,
  justChanged,
  relation,
  noTask,
}: {
  language: string;
  stableIdle: boolean;
  justChanged: boolean;
  relation: string;
  noTask: boolean;
}): string {
  if (language === "en-US") {
    if (stableIdle) {
      return "passerby viewers, fellow procrastinators, lifestyle chatters, riffing sidekicks";
    }
    if (justChanged || relation === "off_task") {
      return "office workers, passerby viewers, sarcastic friends, fellow procrastinators, riffing sidekicks";
    }
    if (relation === "on_task") {
      return "co-working viewers, technical viewers, future self, gentle supervisors, cheering viewers";
    }
    if (noTask) {
      return "passerby viewers, lifestyle chatters, light teasers, quiet companions";
    }
    return "office workers, lifestyle chatters, passerby viewers, riffing sidekicks, gentle supervisors";
  }

  if (stableIdle) {
    return "路过观众、同样摸鱼的人、生活流观众、捧哏观众";
  }
  if (justChanged || relation === "off_task") {
    return "工作党、路过观众、阴阳怪气朋友、同样摸鱼的人、捧哏观众";
  }
  if (relation === "on_task") {
    return "陪跑观众、技术观众、未来的自己、温柔监督、捧场观众";
  }
  if (noTask) {
    return "路过观众、生活流观众、吐槽役、安静陪看的人";
  }
  return "工作党、生活流观众、路过观众、捧哏观众、温柔监督";
}

function buildForbiddenTerms({
  language,
  stableIdle,
  lowConfidence,
  noTask,
}: {
  language: string;
  stableIdle: boolean;
  lowConfidence: boolean;
  noTask: boolean;
}): string[] {
  if (language === "en-US") {
    const terms = [
      "idle",
      "confidence",
      "task relation",
      "observation record",
      "not enough information",
      "next frame",
      "AI stuck",
    ];
    if (stableIdle || lowConfidence) {
      terms.push("mouse hovering", "cursor hovering", "nothing changed on screen");
    }
    if (noTask) {
      terms.push("task not set", "no task");
    }
    return Array.from(new Set(terms));
  }

  const terms = [
    "idle",
    "置信度",
    "任务关系",
    "观察记录",
    "信息不够",
    "下一帧",
    "AI卡壳",
  ];
  if (stableIdle || lowConfidence) {
    terms.push("鼠标悬停", "光标悬停", "画面没变化");
  }
  if (noTask) {
    terms.push("任务未设置", "没有任务");
  }
  return Array.from(new Set(terms));
}

function buildCooldownTopics(recentMessages: Array<{ text: string }>, language: string): string {
  const topicPatterns: Array<[string, RegExp]> = language === "en-US"
    ? [
      ["task", /task|todo|goal/i],
      ["mouse/cursor", /mouse|cursor/i],
      ["staring/empty screen", /stare|blank|afk|idle|nothing/i],
      ["coffee/drinks", /coffee|tea|water|drink|soda/i],
      ["dinner/food", /dinner|lunch|snack|takeout|food/i],
      ["work pressure", /boss|report|work|deadline/i],
      ["code/tools", /code|Codex|browser|window|tool/i],
    ]
    : [
      ["任务", /任务|待办|目标/u],
      ["鼠标/光标", /鼠标|光标/u],
      ["发呆/空白", /发呆|空白|挂机|长草/u],
      ["咖啡/饮料", /咖啡|奶茶|水|酸奶/u],
      ["晚饭/外卖", /晚饭|夜宵|外卖|吃/u],
      ["老板/工作压力", /老板|日报|上班|下班/u],
      ["代码/工具", /代码|Codex|浏览器|窗口/u],
    ];
  const counts = new Map<string, number>();
  for (const message of recentMessages.slice(0, 12)) {
    for (const [topic, pattern] of topicPatterns) {
      if (pattern.test(message.text)) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .map(([topic]) => topic)
    .slice(0, 4)
    .join("、");
}

function isIdleLike(label: string): boolean {
  return /idle|unknown|空闲|发呆/i.test(label);
}

function buildTimeline(context: DanmakuContext): string {
  return context.recentSegments
    .slice(0, 6)
    .reverse()
    .map((segment) => {
      const count = segment.observationCount > 1 ? `x${segment.observationCount}` : "";
      return `${compact(segment.appName, 16)}:${segment.activityLabel}${count}(${relationText(segment.taskRelation, context.language)})`;
    })
    .join(" -> ");
}

function relationText(relation: string, language: string): string {
  const labels: Record<string, string> = language === "en-US" ? {
    on_task: "on task",
    off_task: "off task",
    break: "break",
    unrelated: "unrelated",
    no_task: "no task",
    unknown: "unknown",
  } : {
    on_task: "贴近任务",
    off_task: "偏离任务",
    break: "休息",
    unrelated: "无关",
    no_task: "无任务",
    unknown: "不确定",
  };
  return labels[relation] ?? relation;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
