import {
  Activity,
  Bot,
  Bug,
  Eye,
  EyeOff,
  History,
  MessageCircle,
  Pause,
  Play,
  Radar,
  Save,
  Settings,
  Shield,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  PERSONA_DESCRIPTIONS_BY_LANGUAGE,
  PERSONA_LABELS,
  PERSONA_LABELS_BY_LANGUAGE,
} from "../../shared/defaults";
import type { AppLanguage, AppSettings, AppState, PersonaId, ProviderMode, PublicSettings, TaskRelation } from "../../shared/types";

type SettingsDraft = Pick<
  AppSettings,
  | "language"
  | "visionProviderMode"
  | "textProviderMode"
  | "openAiBaseUrl"
  | "openAiVisionModel"
  | "openAiTextModel"
  | "ollamaBaseUrl"
  | "ollamaVisionModel"
  | "ollamaTextModel"
  | "maxDanmakuPerRound"
  | "danmakuSpeed"
  | "showDebugPanel"
  | "hideOverlayDuringCapture"
> & {
  openAiApiKeyInput: string;
  sensitiveAppsText: string;
};

type DrawerId = "settings" | "persona" | "debug";

const PERSONAS = Object.keys(PERSONA_LABELS) as PersonaId[];

const UI_TEXT: Record<AppLanguage, {
  loadTitle: string;
  loadHint: string;
  boot: string;
  subtitle: string;
  overview: string;
  overviewHint: string;
  openSettings: string;
  openPersona: string;
  openDebug: string;
  close: string;
  notRun: string;
  startObserve: string;
  pauseObserve: string;
  observeNow: string;
  todayTask: string;
  taskPlaceholder: string;
  saveTaskTitle: string;
  save: string;
  currentBehavior: string;
  currentBehaviorHint: string;
  noObservation: string;
  app: string;
  activity: string;
  taskRelation: string;
  confidence: string;
  continuousBehavior: string;
  timelinePreview: string;
  noSegments: string;
  persona: string;
  currentPersona: string;
  aiSettings: string;
  language: string;
  zh: string;
  en: string;
  endpoints: string;
  ollamaUrl: string;
  visionAnalysis: string;
  danmakuGeneration: string;
  openAiVisionModel: string;
  ollamaVisionModel: string;
  openAiTextModel: string;
  ollamaTextModel: string;
  savedKeyPlaceholder: string;
  danmakuDensity: (value: number) => string;
  sparse: string;
  dense: string;
  danmakuSpeed: (value: number) => string;
  slow: string;
  fast: string;
  showDebug: string;
  hideOverlay: string;
  sensitiveApps: string;
  saving: string;
  saveSettings: string;
  recentDanmaku: string;
  audienceRoom: string;
  noDanmaku: string;
  summariesOnly: string;
  danmakuDebug: string;
  noDanmakuRequests: string;
  diagnostics: string;
  noErrors: string;
  aiDebug: string;
  noAiRequests: string;
  request: string;
  response: string;
  contactSheet: string;
}> = {
  "zh-CN": {
    loadTitle: "PC Audience 没有正常加载",
    loadHint: "preload 没有注入 window.audience，请重启 dev 进程。",
    boot: "PC Audience 正在启动",
    subtitle: "屏幕行为观察与弹幕反馈",
    overview: "观察台",
    overviewHint: "主页只放正在发生的事，其他低频操作收进抽屉。",
    openSettings: "设置",
    openPersona: "人格",
    openDebug: "Debug",
    close: "关闭",
    notRun: "未运行",
    startObserve: "开始观察",
    pauseObserve: "暂停观察",
    observeNow: "立即观察",
    todayTask: "今日任务",
    taskPlaceholder: "例如：写方案、改代码、整理资料",
    saveTaskTitle: "保存今日任务",
    save: "保存",
    currentBehavior: "当前行为",
    currentBehaviorHint: "AI 最近一次对屏幕的客观判断",
    noObservation: "还没有观察记录",
    app: "应用",
    activity: "行为",
    taskRelation: "任务关系",
    confidence: "置信度",
    continuousBehavior: "连续行为",
    timelinePreview: "行为轨迹",
    noSegments: "暂无行为段",
    persona: "弹幕人格",
    currentPersona: "当前人格",
    aiSettings: "AI 设置",
    language: "语言",
    zh: "中文",
    en: "English",
    endpoints: "连接端点",
    ollamaUrl: "Ollama 地址",
    visionAnalysis: "视觉分析",
    danmakuGeneration: "弹幕生成",
    openAiVisionModel: "OpenAI 视觉模型",
    ollamaVisionModel: "Ollama 视觉模型",
    openAiTextModel: "OpenAI 文本模型",
    ollamaTextModel: "Ollama 文本模型",
    savedKeyPlaceholder: "已保存，留空不修改",
    danmakuDensity: (value) => `弹幕密度：同屏约 ${value} 条`,
    sparse: "稀疏",
    dense: "密集",
    danmakuSpeed: (value) => `弹幕速度：${value.toFixed(1)}x`,
    slow: "慢",
    fast: "快",
    showDebug: "显示 Debug 数据",
    hideOverlay: "捕获时隐藏弹幕",
    sensitiveApps: "敏感应用",
    saving: "保存中",
    saveSettings: "保存设置",
    recentDanmaku: "最近弹幕",
    audienceRoom: "观众席",
    noDanmaku: "暂无弹幕",
    summariesOnly: "只保存摘要",
    danmakuDebug: "弹幕生成 Debug",
    noDanmakuRequests: "暂无弹幕请求",
    diagnostics: "诊断日志",
    noErrors: "暂无错误",
    aiDebug: "AI Debug",
    noAiRequests: "暂无 AI 请求记录",
    request: "Request",
    response: "Response",
    contactSheet: "Contact Sheet",
  },
  "en-US": {
    loadTitle: "PC Audience did not load",
    loadHint: "window.audience was not injected by preload. Please restart the dev process.",
    boot: "PC Audience is starting",
    subtitle: "Screen behavior observer and live danmaku feedback",
    overview: "Observation desk",
    overviewHint: "The home view keeps only the live essentials. Everything else lives in drawers.",
    openSettings: "Settings",
    openPersona: "Persona",
    openDebug: "Debug",
    close: "Close",
    notRun: "Not run",
    startObserve: "Start observing",
    pauseObserve: "Pause observing",
    observeNow: "Observe now",
    todayTask: "Today's task",
    taskPlaceholder: "e.g. write a proposal, code, organize notes",
    saveTaskTitle: "Save today's task",
    save: "Save",
    currentBehavior: "Current behavior",
    currentBehaviorHint: "The latest objective screen read from AI",
    noObservation: "No observations yet",
    app: "App",
    activity: "Activity",
    taskRelation: "Task relation",
    confidence: "Confidence",
    continuousBehavior: "Behavior timeline",
    timelinePreview: "Timeline",
    noSegments: "No behavior segments yet",
    persona: "Danmaku persona",
    currentPersona: "Current persona",
    aiSettings: "AI settings",
    language: "Language",
    zh: "中文",
    en: "English",
    endpoints: "Endpoints",
    ollamaUrl: "Ollama URL",
    visionAnalysis: "Vision analysis",
    danmakuGeneration: "Danmaku generation",
    openAiVisionModel: "OpenAI vision model",
    ollamaVisionModel: "Ollama vision model",
    openAiTextModel: "OpenAI text model",
    ollamaTextModel: "Ollama text model",
    savedKeyPlaceholder: "Saved. Leave blank to keep unchanged",
    danmakuDensity: (value) => `Danmaku density: about ${value} on screen`,
    sparse: "Sparse",
    dense: "Dense",
    danmakuSpeed: (value) => `Danmaku speed: ${value.toFixed(1)}x`,
    slow: "Slow",
    fast: "Fast",
    showDebug: "Show debug data",
    hideOverlay: "Hide danmaku during capture",
    sensitiveApps: "Sensitive apps",
    saving: "Saving",
    saveSettings: "Save settings",
    recentDanmaku: "Recent danmaku",
    audienceRoom: "Audience room",
    noDanmaku: "No danmaku yet",
    summariesOnly: "Summaries only",
    danmakuDebug: "Danmaku generation debug",
    noDanmakuRequests: "No danmaku requests yet",
    diagnostics: "Diagnostics",
    noErrors: "No errors",
    aiDebug: "AI Debug",
    noAiRequests: "No AI request records yet",
    request: "Request",
    response: "Response",
    contactSheet: "Contact Sheet",
  },
};

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [drawer, setDrawer] = useState<DrawerId | null>(null);

  useEffect(() => {
    if (!window.audience) {
      setLoadError("preload 没有注入 window.audience，请重启 dev 进程。");
      return;
    }
    void window.audience.getState().then((next) => {
      setState(next);
      setTaskDraft(next.todayTask);
      setSettingsDraft(hydrateSettings(next.settings));
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : String(error));
    });
    return window.audience.onState((next) => {
      setState(next);
      setTaskDraft((current) => (current === next.todayTask ? current : current || next.todayTask));
      if (!settingsDirty) {
        setSettingsDraft(hydrateSettings(next.settings));
      }
    });
  }, [settingsDirty]);

  const activePersona = state?.settings.persona ?? "sharp_supervisor";
  const language = settingsDraft?.language ?? state?.settings.language ?? "zh-CN";
  const text = UI_TEXT[language];
  const personaLabels = PERSONA_LABELS_BY_LANGUAGE[language];
  const personaDescriptions = PERSONA_DESCRIPTIONS_BY_LANGUAGE[language];
  const engineClass = state?.engineStatus.state ?? "idle";
  const timeline = useMemo(() => state?.recentSegments ?? [], [state]);
  const timelinePreview = useMemo(() => timeline.slice(0, 5), [timeline]);
  const recentDanmaku = useMemo(() => (state?.recentDanmaku ?? []).slice(0, 8), [state]);
  const danmakuDebugEvents = useMemo(
    () => (state?.aiDebugEvents ?? []).filter((event) => event.purpose === "danmaku").slice(0, 6),
    [state],
  );

  if (loadError) {
    const fallbackText = UI_TEXT["zh-CN"];
    return (
      <div className="load-error">
        <h1>{fallbackText.loadTitle}</h1>
        <p>{loadError}</p>
        <code>npm run dev</code>
      </div>
    );
  }

  if (!state || !settingsDraft) {
    return <div className="boot">{text.boot}</div>;
  }

  async function saveTask() {
    const next = await window.audience.setTodayTask(taskDraft);
    setState(next);
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setSaving(true);
    const patch: Partial<AppSettings> = {
      language: settingsDraft.language,
      visionProviderMode: settingsDraft.visionProviderMode,
      textProviderMode: settingsDraft.textProviderMode,
      openAiBaseUrl: settingsDraft.openAiBaseUrl,
      openAiVisionModel: settingsDraft.openAiVisionModel,
      openAiTextModel: settingsDraft.openAiTextModel,
      ollamaBaseUrl: settingsDraft.ollamaBaseUrl,
      ollamaVisionModel: settingsDraft.ollamaVisionModel,
      ollamaTextModel: settingsDraft.ollamaTextModel,
      maxDanmakuPerRound: settingsDraft.maxDanmakuPerRound,
      danmakuSpeed: settingsDraft.danmakuSpeed,
      showDebugPanel: settingsDraft.showDebugPanel,
      hideOverlayDuringCapture: settingsDraft.hideOverlayDuringCapture,
      sensitiveApps: settingsDraft.sensitiveAppsText
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
    if (settingsDraft.openAiApiKeyInput.trim()) {
      patch.openAiApiKey = settingsDraft.openAiApiKeyInput.trim();
    }
    const next = await window.audience.updateSettings(patch);
    setState(next);
    setSettingsDraft(hydrateSettings(next.settings));
    setSettingsDirty(false);
    setSaving(false);
  }

  async function setPersona(persona: PersonaId) {
    const next = await window.audience.updateSettings({ persona });
    setState(next);
  }

  async function togglePaused() {
    if (!state) return;
    const next = await window.audience.togglePaused(!state.settings.paused);
    setState(next);
  }

  async function observeNow() {
    const next = await window.audience.observeNow();
    setState(next);
  }

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div className="brand-inline">
          <div className="brand-mark"><Radar size={24} /></div>
          <div>
            <h1>PC Audience</h1>
            <p>{text.subtitle}</p>
          </div>
        </div>

        <div className={`engine-status ${engineClass}`}>
          <span />
          <strong>{formatEngineMessage(state.engineStatus.state, state.engineStatus.message, language)}</strong>
          <small>{state.engineStatus.lastRunAt ? formatTime(state.engineStatus.lastRunAt, language) : text.notRun}</small>
        </div>

        <div className="topbar-actions">
          <button className="primary-action" onClick={togglePaused}>
            {state.settings.paused ? <Play size={18} /> : <Pause size={18} />}
            {state.settings.paused ? text.startObserve : text.pauseObserve}
          </button>
          <button className="ghost-action" onClick={observeNow}>
            <Zap size={18} />
            {text.observeNow}
          </button>
          <button className="tool-button" onClick={() => setDrawer("persona")}>
            <MessageCircle size={18} />
            {personaLabels[activePersona]}
          </button>
          <button className="tool-button" onClick={() => setDrawer("settings")}>
            <Settings size={18} />
            {text.openSettings}
          </button>
          {state.settings.showDebugPanel ? (
            <button className="tool-button icon-only" onClick={() => setDrawer("debug")} title={text.openDebug}>
              <Bug size={18} />
            </button>
          ) : null}
        </div>
      </header>

      <section className="workspace">
        <section className="task-card">
          <div className="workspace-kicker">
            <span className="eyebrow">{text.overview}</span>
            <strong>{state.latestObservation?.appName ?? "PC Audience"}</strong>
          </div>
          <label>
            <span>{text.todayTask}</span>
            <input
              value={taskDraft}
              onChange={(event) => setTaskDraft(event.target.value)}
              placeholder={text.taskPlaceholder}
            />
          </label>
          <button className="icon-button text-button" onClick={saveTask} title={text.saveTaskTitle}>
            <Save size={18} />
            {text.save}
          </button>
        </section>

        <section className="main-grid">
          <article className="current-panel">
            <div className="panel-head">
              <div>
                <div className="section-title">
                  <Activity size={18} />
                  {text.currentBehavior}
                </div>
                <p className="panel-hint">{text.currentBehaviorHint}</p>
              </div>
              <span className="confidence-pill">
                {state.latestObservation ? `${Math.round(state.latestObservation.confidence * 100)}%` : "0%"}
              </span>
            </div>
            <h3>{state.latestObservation?.summary ?? text.noObservation}</h3>
            <dl>
              <div>
                <dt>{text.app}</dt>
                <dd>{state.latestObservation?.appName ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>{text.activity}</dt>
                <dd>{state.latestObservation?.activityLabel ?? "unknown"}</dd>
              </div>
              <div>
                <dt>{text.taskRelation}</dt>
                <dd>{formatTaskRelation(state.latestObservation?.taskRelation ?? "unknown", language)}</dd>
              </div>
              <div>
                <dt>{text.confidence}</dt>
                <dd>{state.latestObservation ? `${Math.round(state.latestObservation.confidence * 100)}%` : "0%"}</dd>
              </div>
            </dl>
          </article>

          <section className="audience-panel">
            <div className="panel-head compact">
              <div className="section-title">
                <Eye size={18} />
                {text.audienceRoom}
              </div>
              <div className="privacy-chip">
                <Shield size={15} />
                {text.summariesOnly}
              </div>
            </div>
            <div className="message-list">
              {recentDanmaku.length === 0 ? (
                <p className="empty">{text.noDanmaku}</p>
              ) : (
                recentDanmaku.map((message) => (
                  <article key={message.id}>
                    <strong>{message.text}</strong>
                    <span>{formatTime(message.shownAt, language)}</span>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="timeline-panel">
            <div className="section-title">
              <History size={18} />
              {text.timelinePreview}
            </div>
            <div className="segment-stack">
              {timelinePreview.length === 0 ? (
                <p className="empty">{text.noSegments}</p>
              ) : (
                timelinePreview.map((segment) => (
                  <article key={segment.id} className="segment-row">
                    <time>{formatTime(segment.startedAt, language)}</time>
                    <div>
                      <strong>{segment.appName}</strong>
                      <span>{segment.activityLabel}</span>
                      <p>{segment.summary}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </section>

      {drawer === "persona" ? (
        <SideDrawer title={text.persona} closeLabel={text.close} onClose={() => setDrawer(null)}>
          <section className="drawer-section">
            <span className="eyebrow">{text.currentPersona}</span>
            <h3>{personaLabels[activePersona]}</h3>
            <p>{personaDescriptions[activePersona]}</p>
          </section>
          <div className="persona-list">
            {PERSONAS.map((persona) => (
              <button
                key={persona}
                className={persona === activePersona ? "persona active" : "persona"}
                onClick={() => void setPersona(persona)}
              >
                <strong>{personaLabels[persona]}</strong>
                <span>{personaDescriptions[persona]}</span>
              </button>
            ))}
          </div>
        </SideDrawer>
      ) : null}

      {drawer === "settings" ? (
        <SideDrawer title={text.aiSettings} closeLabel={text.close} onClose={() => setDrawer(null)} wide>
          <div className="settings-panel">
            <Field label={text.language}>
              <LanguageToggle
                value={settingsDraft.language}
                labels={{ zh: text.zh, en: text.en }}
                onChange={(nextLanguage) => updateDraft({ language: nextLanguage })}
              />
            </Field>
            <div className="settings-subtitle">{text.endpoints}</div>
            <div className="form-grid">
              <Field label="OpenAI-compatible Base URL">
                <input value={settingsDraft.openAiBaseUrl} onChange={(event) => updateDraft({ openAiBaseUrl: event.target.value })} />
              </Field>
              <Field label="OpenAI-compatible API Key">
                <input
                  type="password"
                  value={settingsDraft.openAiApiKeyInput}
                  placeholder={state.settings.hasOpenAiApiKey ? text.savedKeyPlaceholder : "sk-..."}
                  onChange={(event) => updateDraft({ openAiApiKeyInput: event.target.value })}
                />
              </Field>
              <Field label={text.ollamaUrl}>
                <input value={settingsDraft.ollamaBaseUrl} onChange={(event) => updateDraft({ ollamaBaseUrl: event.target.value })} />
              </Field>
            </div>
            <div className="route-grid">
              <ModelRoute
                title={text.visionAnalysis}
                provider={settingsDraft.visionProviderMode}
                modelValue={settingsDraft.visionProviderMode === "openai" ? settingsDraft.openAiVisionModel : settingsDraft.ollamaVisionModel}
                modelLabel={settingsDraft.visionProviderMode === "openai" ? text.openAiVisionModel : text.ollamaVisionModel}
                onProviderChange={(visionProviderMode) => updateDraft({ visionProviderMode })}
                onModelChange={(value) => updateDraft(
                  settingsDraft.visionProviderMode === "openai"
                    ? { openAiVisionModel: value }
                    : { ollamaVisionModel: value },
                )}
              />
              <ModelRoute
                title={text.danmakuGeneration}
                provider={settingsDraft.textProviderMode}
                modelValue={settingsDraft.textProviderMode === "openai" ? settingsDraft.openAiTextModel : settingsDraft.ollamaTextModel}
                modelLabel={settingsDraft.textProviderMode === "openai" ? text.openAiTextModel : text.ollamaTextModel}
                onProviderChange={(textProviderMode) => updateDraft({ textProviderMode })}
                onModelChange={(value) => updateDraft(
                  settingsDraft.textProviderMode === "openai"
                    ? { openAiTextModel: value }
                    : { ollamaTextModel: value },
                )}
              />
            </div>
            <div className="range-grid">
              <Field label={text.danmakuDensity(settingsDraft.maxDanmakuPerRound)}>
                <div className="density-control">
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={settingsDraft.maxDanmakuPerRound}
                    onChange={(event) => updateDraft({ maxDanmakuPerRound: Number(event.target.value) })}
                  />
                  <div className="density-scale">
                    <span>{text.sparse}</span>
                    <span>{text.dense}</span>
                  </div>
                </div>
              </Field>
              <Field label={text.danmakuSpeed(settingsDraft.danmakuSpeed)}>
                <div className="density-control">
                  <input
                    type="range"
                    min={0.4}
                    max={1.3}
                    step={0.1}
                    value={settingsDraft.danmakuSpeed}
                    onChange={(event) => updateDraft({ danmakuSpeed: Number(event.target.value) })}
                  />
                  <div className="density-scale">
                    <span>{text.slow}</span>
                    <span>{text.fast}</span>
                  </div>
                </div>
              </Field>
            </div>
            <div className="privacy-row">
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.showDebugPanel}
                  onChange={(event) => updateDraft({ showDebugPanel: event.target.checked })}
                />
                <Bug size={16} />
                {text.showDebug}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.hideOverlayDuringCapture}
                  onChange={(event) => updateDraft({ hideOverlayDuringCapture: event.target.checked })}
                />
                <EyeOff size={16} />
                {text.hideOverlay}
              </label>
            </div>
            <Field label={text.sensitiveApps}>
              <textarea value={settingsDraft.sensitiveAppsText} onChange={(event) => updateDraft({ sensitiveAppsText: event.target.value })} />
            </Field>
            <div className="drawer-actions">
              <button className="primary-action compact" onClick={saveSettings} disabled={saving}>
                <Save size={18} />
                {saving ? text.saving : text.saveSettings}
              </button>
            </div>
          </div>
        </SideDrawer>
      ) : null}

      {drawer === "debug" && state.settings.showDebugPanel ? (
        <SideDrawer title={text.aiDebug} closeLabel={text.close} onClose={() => setDrawer(null)} wide>
          <section className="debug-panel">
            <div className="debug-feed">
              {(state.aiDebugEvents ?? []).length === 0 ? (
                <p className="empty">{text.noAiRequests}</p>
              ) : (
                (state.aiDebugEvents ?? []).slice(0, 20).map((event) => (
                  <details key={event.id} className={`debug-event ${event.phase}`}>
                    <summary>
                      <span className="debug-pill">{event.phase}</span>
                      <strong>{event.provider} / {event.purpose}</strong>
                      <code>{event.model}</code>
                      <span>{event.durationMs === null ? "pending" : formatDuration(event.durationMs)}</span>
                      <span>{formatTime(event.at, language)}</span>
                    </summary>
                    <div className="debug-meta">
                      <span>endpoint: {event.endpoint}</span>
                      <span>timeout: {formatDuration(event.timeoutMs)}</span>
                      <span>status: {event.status ?? "-"}</span>
                    </div>
                    {event.imagePreviewDataUrl ? (
                      <div className="debug-image">
                        <strong>{text.contactSheet}</strong>
                        <img src={event.imagePreviewDataUrl} alt="AI request contact sheet" />
                      </div>
                    ) : null}
                    <div className="debug-columns">
                      <div>
                        <strong>{text.request}</strong>
                        <pre>{formatJson(event.request)}</pre>
                      </div>
                      <div>
                        <strong>{text.response}</strong>
                        <pre>{formatJson(event.response)}</pre>
                      </div>
                    </div>
                  </details>
                ))
              )}
            </div>
            <div className="debug-subsection">
              <div className="section-title subtle">
                <Bug size={16} />
                {text.danmakuDebug}
              </div>
              <div className="mini-debug-list">
                {danmakuDebugEvents.length === 0 ? (
                  <p className="empty">{text.noDanmakuRequests}</p>
                ) : (
                  danmakuDebugEvents.map((event) => (
                    <details key={event.id} className={`mini-debug-event ${event.phase}`}>
                      <summary>
                        <span>{event.phase}</span>
                        <code>{event.model}</code>
                        <small>{event.durationMs === null ? "pending" : formatDuration(event.durationMs)}</small>
                        <small>{formatTime(event.at, language)}</small>
                      </summary>
                      <strong>{text.request}</strong>
                      <pre>{formatJson(event.request)}</pre>
                      <strong>{text.response}</strong>
                      <pre>{formatJson(event.response)}</pre>
                    </details>
                  ))
                )}
              </div>
            </div>
            <div className="diagnostic-list">
              <div className="section-title subtle">{text.diagnostics}</div>
              {(state.diagnostics ?? []).length === 0 ? (
                <p className="empty">{text.noErrors}</p>
              ) : (
                (state.diagnostics ?? []).slice(0, 8).map((item) => (
                  <article key={item.id} className={item.level}>
                    <strong>{item.source}</strong>
                    <span>{formatTime(item.at, language)}</span>
                    <p>{item.message}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </SideDrawer>
      ) : null}
    </main>
  );

  function updateDraft(patch: Partial<SettingsDraft>) {
    setSettingsDraft((current) => (current ? { ...current, ...patch } : current));
    setSettingsDirty(true);
  }
}

function SideDrawer({
  title,
  closeLabel,
  wide = false,
  children,
  onClose,
}: {
  title: string;
  closeLabel: string;
  wide?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className={wide ? "drawer-panel wide" : "drawer-panel"} onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <h2>{title}</h2>
          <button className="round-button" onClick={onClose} title={closeLabel}>
            <X size={20} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function ProviderToggle({
  value,
  onChange,
}: {
  value: ProviderMode;
  onChange: (value: ProviderMode) => void;
}) {
  return (
    <div className="segmented">
      <button className={value === "openai" ? "active" : ""} onClick={() => onChange("openai")}>
        OpenAI-compatible
      </button>
      <button className={value === "ollama" ? "active" : ""} onClick={() => onChange("ollama")}>
        Ollama
      </button>
    </div>
  );
}

function LanguageToggle({
  value,
  labels,
  onChange,
}: {
  value: AppLanguage;
  labels: { zh: string; en: string };
  onChange: (value: AppLanguage) => void;
}) {
  return (
    <div className="segmented">
      <button className={value === "zh-CN" ? "active" : ""} onClick={() => onChange("zh-CN")}>
        {labels.zh}
      </button>
      <button className={value === "en-US" ? "active" : ""} onClick={() => onChange("en-US")}>
        {labels.en}
      </button>
    </div>
  );
}

function ModelRoute({
  title,
  provider,
  modelLabel,
  modelValue,
  onProviderChange,
  onModelChange,
}: {
  title: string;
  provider: ProviderMode;
  modelLabel: string;
  modelValue: string;
  onProviderChange: (value: ProviderMode) => void;
  onModelChange: (value: string) => void;
}) {
  return (
    <div className="route-card">
      <strong>{title}</strong>
      <ProviderToggle value={provider} onChange={onProviderChange} />
      <Field label={modelLabel}>
        <input value={modelValue} onChange={(event) => onModelChange(event.target.value)} />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function hydrateSettings(settings: PublicSettings): SettingsDraft {
  return {
    language: settings.language,
    visionProviderMode: settings.visionProviderMode,
    textProviderMode: settings.textProviderMode,
    openAiBaseUrl: settings.openAiBaseUrl,
    openAiApiKeyInput: "",
    openAiVisionModel: settings.openAiVisionModel,
    openAiTextModel: settings.openAiTextModel,
    ollamaBaseUrl: settings.ollamaBaseUrl,
    ollamaVisionModel: settings.ollamaVisionModel,
    ollamaTextModel: settings.ollamaTextModel,
    maxDanmakuPerRound: settings.maxDanmakuPerRound,
    danmakuSpeed: settings.danmakuSpeed,
    showDebugPanel: settings.showDebugPanel,
    hideOverlayDuringCapture: settings.hideOverlayDuringCapture,
    sensitiveAppsText: settings.sensitiveApps.join("\n"),
  };
}

function formatTime(iso: string, language: AppLanguage): string {
  return new Date(iso).toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTaskRelation(relation: TaskRelation, language: AppLanguage): string {
  const labels: Record<AppLanguage, Record<TaskRelation, string>> = {
    "zh-CN": {
      on_task: "贴近任务",
      off_task: "偏离任务",
      break: "休息",
      unrelated: "无关",
      no_task: "无任务",
      unknown: "不确定",
    },
    "en-US": {
      on_task: "On task",
      off_task: "Off task",
      break: "Break",
      unrelated: "Unrelated",
      no_task: "No task",
      unknown: "Unknown",
    },
  };
  return labels[language][relation];
}

function formatEngineMessage(
  state: AppState["engineStatus"]["state"],
  fallback: string,
  language: AppLanguage,
): string {
  if (language === "zh-CN") {
    return fallback;
  }
  const labels: Record<AppState["engineStatus"]["state"], string> = {
    idle: "Idle",
    paused: "Observation paused",
    capturing: "Capturing screen frame",
    analyzing: "Requesting vision model",
    needs_config: fallback.startsWith("Please ") ? fallback : "Configuration required",
    sensitive_skipped: "Sensitive content skipped",
    error: fallback,
  };
  return labels[state];
}

function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`;
  }
  return `${(ms / 1_000).toFixed(1)}s`;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
