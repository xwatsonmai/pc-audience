import {
  Activity,
  Bot,
  Bug,
  Eye,
  EyeOff,
  MessageCircle,
  Pause,
  Play,
  Radar,
  Save,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { PERSONA_DESCRIPTIONS, PERSONA_LABELS } from "../../shared/defaults";
import type { AppSettings, AppState, PersonaId, ProviderMode, PublicSettings } from "../../shared/types";

type SettingsDraft = Pick<
  AppSettings,
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
  | "hideOverlayDuringCapture"
> & {
  openAiApiKeyInput: string;
  sensitiveAppsText: string;
};

const PERSONAS = Object.keys(PERSONA_LABELS) as PersonaId[];

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [taskDraft, setTaskDraft] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

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
  const engineClass = state?.engineStatus.state ?? "idle";
  const timeline = useMemo(() => state?.recentSegments ?? [], [state]);
  const danmakuDebugEvents = useMemo(
    () => (state?.aiDebugEvents ?? []).filter((event) => event.purpose === "danmaku").slice(0, 6),
    [state],
  );

  if (loadError) {
    return (
      <div className="load-error">
        <h1>PC Audience 没有正常加载</h1>
        <p>{loadError}</p>
        <code>npm run dev</code>
      </div>
    );
  }

  if (!state || !settingsDraft) {
    return <div className="boot">PC Audience 正在启动</div>;
  }

  async function saveTask() {
    const next = await window.audience.setTodayTask(taskDraft);
    setState(next);
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setSaving(true);
    const patch: Partial<AppSettings> = {
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
      <aside className="side-rail">
        <div>
          <div className="brand-mark"><Radar size={24} /></div>
          <h1>PC Audience</h1>
          <p>屏幕行为观察与弹幕反馈</p>
        </div>
        <div className={`engine-status ${engineClass}`}>
          <span />
          <strong>{state.engineStatus.message}</strong>
          <small>{state.engineStatus.lastRunAt ? formatTime(state.engineStatus.lastRunAt) : "未运行"}</small>
        </div>
        <button className="primary-action" onClick={togglePaused}>
          {state.settings.paused ? <Play size={18} /> : <Pause size={18} />}
          {state.settings.paused ? "开始观察" : "暂停观察"}
        </button>
        <button className="ghost-action" onClick={observeNow}>
          <Zap size={18} />
          立即观察
        </button>
      </aside>

      <section className="workspace">
        <header className="top-strip">
          <div>
            <span>今日任务</span>
            <input
              value={taskDraft}
              onChange={(event) => setTaskDraft(event.target.value)}
              placeholder="例如：写方案、改代码、整理资料"
            />
          </div>
          <button className="icon-button text-button" onClick={saveTask} title="保存今日任务">
            <Save size={18} />
            保存
          </button>
        </header>

        <section className="focus-grid">
          <div className="current-panel">
            <div className="section-title">
              <Activity size={18} />
              当前行为
            </div>
            <h2>{state.latestObservation?.summary ?? "还没有观察记录"}</h2>
            <dl>
              <div>
                <dt>应用</dt>
                <dd>{state.latestObservation?.appName ?? "Unknown"}</dd>
              </div>
              <div>
                <dt>行为</dt>
                <dd>{state.latestObservation?.activityLabel ?? "unknown"}</dd>
              </div>
              <div>
                <dt>任务关系</dt>
                <dd>{state.latestObservation?.taskRelation ?? "unknown"}</dd>
              </div>
              <div>
                <dt>置信度</dt>
                <dd>{state.latestObservation ? `${Math.round(state.latestObservation.confidence * 100)}%` : "0%"}</dd>
              </div>
            </dl>
          </div>

          <div className="memory-panel">
            <div className="section-title">
              <Bot size={18} />
              连续行为
            </div>
            <div className="segment-stack">
              {timeline.length === 0 ? (
                <p className="empty">暂无行为段</p>
              ) : (
                timeline.map((segment) => (
                  <article key={segment.id} className="segment-row">
                    <time>{formatTime(segment.startedAt)}</time>
                    <div>
                      <strong>{segment.appName}</strong>
                      <span>{segment.activityLabel}</span>
                      <p>{segment.summary}</p>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="bottom-grid">
          <div className="persona-panel">
            <div className="section-title">
              <MessageCircle size={18} />
              弹幕人格
            </div>
            <div className="persona-list">
              {PERSONAS.map((persona) => (
                <button
                  key={persona}
                  className={persona === activePersona ? "persona active" : "persona"}
                  onClick={() => void setPersona(persona)}
                >
                  <strong>{PERSONA_LABELS[persona]}</strong>
                  <span>{PERSONA_DESCRIPTIONS[persona]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-panel">
            <div className="section-title">
              <Sparkles size={18} />
              AI 设置
            </div>
            <div className="settings-subtitle">连接端点</div>
            <div className="form-grid">
              <Field label="OpenAI-compatible Base URL">
                <input value={settingsDraft.openAiBaseUrl} onChange={(event) => updateDraft({ openAiBaseUrl: event.target.value })} />
              </Field>
              <Field label="OpenAI-compatible API Key">
                <input
                  type="password"
                  value={settingsDraft.openAiApiKeyInput}
                  placeholder={state.settings.hasOpenAiApiKey ? "已保存，留空不修改" : "sk-..."}
                  onChange={(event) => updateDraft({ openAiApiKeyInput: event.target.value })}
                />
              </Field>
              <Field label="Ollama 地址">
                <input value={settingsDraft.ollamaBaseUrl} onChange={(event) => updateDraft({ ollamaBaseUrl: event.target.value })} />
              </Field>
            </div>
            <div className="route-grid">
              <ModelRoute
                title="视觉分析"
                provider={settingsDraft.visionProviderMode}
                modelValue={settingsDraft.visionProviderMode === "openai" ? settingsDraft.openAiVisionModel : settingsDraft.ollamaVisionModel}
                modelLabel={settingsDraft.visionProviderMode === "openai" ? "OpenAI 视觉模型" : "Ollama 视觉模型"}
                onProviderChange={(visionProviderMode) => updateDraft({ visionProviderMode })}
                onModelChange={(value) => updateDraft(
                  settingsDraft.visionProviderMode === "openai"
                    ? { openAiVisionModel: value }
                    : { ollamaVisionModel: value },
                )}
              />
              <ModelRoute
                title="弹幕生成"
                provider={settingsDraft.textProviderMode}
                modelValue={settingsDraft.textProviderMode === "openai" ? settingsDraft.openAiTextModel : settingsDraft.ollamaTextModel}
                modelLabel={settingsDraft.textProviderMode === "openai" ? "OpenAI 文本模型" : "Ollama 文本模型"}
                onProviderChange={(textProviderMode) => updateDraft({ textProviderMode })}
                onModelChange={(value) => updateDraft(
                  settingsDraft.textProviderMode === "openai"
                    ? { openAiTextModel: value }
                    : { ollamaTextModel: value },
                )}
              />
            </div>
            <Field label={`弹幕密度：同屏约 ${settingsDraft.maxDanmakuPerRound} 条`}>
              <div className="density-control">
                <input
                  type="range"
                  min={1}
                  max={12}
                  value={settingsDraft.maxDanmakuPerRound}
                  onChange={(event) => updateDraft({ maxDanmakuPerRound: Number(event.target.value) })}
                />
                <div className="density-scale">
                  <span>稀疏</span>
                  <span>密集</span>
                </div>
              </div>
            </Field>
            <Field label={`弹幕速度：${settingsDraft.danmakuSpeed.toFixed(1)}x`}>
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
                  <span>慢</span>
                  <span>快</span>
                </div>
              </div>
            </Field>
            <div className="privacy-row">
              <label>
                <input
                  type="checkbox"
                  checked={settingsDraft.hideOverlayDuringCapture}
                  onChange={(event) => updateDraft({ hideOverlayDuringCapture: event.target.checked })}
                />
                <EyeOff size={16} />
                捕获时隐藏弹幕
              </label>
            </div>
            <Field label="敏感应用">
              <textarea value={settingsDraft.sensitiveAppsText} onChange={(event) => updateDraft({ sensitiveAppsText: event.target.value })} />
            </Field>
            <button className="primary-action compact" onClick={saveSettings} disabled={saving}>
              <Save size={18} />
              {saving ? "保存中" : "保存设置"}
            </button>
          </div>

          <div className="danmaku-panel">
            <div className="section-title">
              <Eye size={18} />
              最近弹幕
            </div>
            <div className="message-list">
              {state.recentDanmaku.length === 0 ? (
                <p className="empty">暂无弹幕</p>
              ) : (
                state.recentDanmaku.map((message) => (
                  <article key={message.id}>
                    <strong>{message.text}</strong>
                    <span>{formatTime(message.shownAt)}</span>
                  </article>
                ))
              )}
            </div>
            <div className="section-title subtle">
              <Shield size={16} />
              只保存摘要
            </div>
            <div className="section-title subtle">
              <Bug size={16} />
              弹幕生成 Debug
            </div>
            <div className="mini-debug-list">
              {danmakuDebugEvents.length === 0 ? (
                <p className="empty">暂无弹幕请求</p>
              ) : (
                danmakuDebugEvents.map((event) => (
                  <details key={event.id} className={`mini-debug-event ${event.phase}`}>
                    <summary>
                      <span>{event.phase}</span>
                      <code>{event.model}</code>
                      <small>{event.durationMs === null ? "pending" : formatDuration(event.durationMs)}</small>
                      <small>{formatTime(event.at)}</small>
                    </summary>
                    <strong>Request</strong>
                    <pre>{formatJson(event.request)}</pre>
                    <strong>Response</strong>
                    <pre>{formatJson(event.response)}</pre>
                  </details>
                ))
              )}
            </div>
            <div className="diagnostic-list">
              <div className="section-title subtle">诊断日志</div>
              {(state.diagnostics ?? []).length === 0 ? (
                <p className="empty">暂无错误</p>
              ) : (
                (state.diagnostics ?? []).slice(0, 6).map((item) => (
                  <article key={item.id} className={item.level}>
                    <strong>{item.source}</strong>
                    <span>{formatTime(item.at)}</span>
                    <p>{item.message}</p>
                  </article>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="debug-panel">
          <div className="section-title">
            <Bug size={18} />
            AI Debug
          </div>
          <div className="debug-feed">
            {(state.aiDebugEvents ?? []).length === 0 ? (
              <p className="empty">暂无 AI 请求记录</p>
            ) : (
              (state.aiDebugEvents ?? []).slice(0, 20).map((event) => (
                <details key={event.id} className={`debug-event ${event.phase}`}>
                  <summary>
                    <span className="debug-pill">{event.phase}</span>
                    <strong>{event.provider} / {event.purpose}</strong>
                    <code>{event.model}</code>
                    <span>{event.durationMs === null ? "pending" : formatDuration(event.durationMs)}</span>
                    <span>{formatTime(event.at)}</span>
                  </summary>
                  <div className="debug-meta">
                    <span>endpoint: {event.endpoint}</span>
                    <span>timeout: {formatDuration(event.timeoutMs)}</span>
                    <span>status: {event.status ?? "-"}</span>
                  </div>
                  {event.imagePreviewDataUrl ? (
                    <div className="debug-image">
                      <strong>Contact Sheet</strong>
                      <img src={event.imagePreviewDataUrl} alt="AI request contact sheet" />
                    </div>
                  ) : null}
                  <div className="debug-columns">
                    <div>
                      <strong>Request</strong>
                      <pre>{formatJson(event.request)}</pre>
                    </div>
                    <div>
                      <strong>Response</strong>
                      <pre>{formatJson(event.response)}</pre>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );

  function updateDraft(patch: Partial<SettingsDraft>) {
    setSettingsDraft((current) => (current ? { ...current, ...patch } : current));
    setSettingsDirty(true);
  }
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
    hideOverlayDuringCapture: settings.hideOverlayDuringCapture,
    sensitiveAppsText: settings.sensitiveApps.join("\n"),
  };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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
