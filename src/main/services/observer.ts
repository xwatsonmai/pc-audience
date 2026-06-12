import activeWindow from "active-win";
import { BrowserWindow, desktopCapturer, screen, type DesktopCapturerSource } from "electron";
import { PNG } from "pngjs";
import { createDanmakuProvider, createVisionProvider, getConfigIssue, type AiDebugSink } from "../ai/providers";
import { composeContactSheetPng } from "../../shared/contactSheet";
import { isSensitiveApp } from "../../shared/privacy";
import type {
  ActiveWindowInfo,
  AppSettings,
  DanmakuMessage,
  EngineStatus,
  ObservationDraft,
} from "../../shared/types";
import { DanmakuService } from "./danmaku";
import { MemoryService } from "./memory";

interface ObserverOptions {
  getSettings: () => AppSettings;
  getTodayTask: () => string;
  getOverlayWindow: () => BrowserWindow | null;
  hasVisibleDanmaku: () => boolean;
  onStatus: (status: EngineStatus) => void;
  onStateChanged: () => void;
  onDanmaku: (messages: DanmakuMessage[]) => void;
  onAiDebug: AiDebugSink;
}

export class ObserverService {
  private frameRing: Buffer[] = [];
  private lastCapturedDisplayId: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly memory: MemoryService,
    private readonly danmaku: DanmakuService,
    private readonly options: ObserverOptions,
  ) {}

  start(): void {
    this.restartTimer();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  updateSettings(): void {
    this.restartTimer();
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.tick();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus("error", message, new Date().toISOString());
      this.options.onStateChanged();
    } finally {
      this.running = false;
    }
  }

  private restartTimer(): void {
    this.stop();
    const settings = this.options.getSettings();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, settings.observeIntervalMs);
  }

  private async tick(): Promise<void> {
    const settings = this.options.getSettings();
    const now = new Date().toISOString();

    if (settings.paused) {
      this.setStatus("paused", "观察已暂停", now);
      return;
    }

    const configIssue = getConfigIssue(settings);
    if (configIssue) {
      this.setStatus("needs_config", configIssue, now);
      return;
    }

    const active = await getActiveWindowInfo();
    if (isSensitiveApp(active.appName, settings.sensitiveApps)) {
      this.memory.recordObservation(sensitiveObservation(now, active));
      this.setStatus("sensitive_skipped", `已跳过敏感应用：${active.appName}`, now);
      this.options.onStateChanged();
      return;
    }

    this.setStatus("capturing", "正在抽取屏幕帧", now);
    const capture = await this.captureFrame(settings);
    if (this.lastCapturedDisplayId !== null && this.lastCapturedDisplayId !== capture.displayId) {
      this.frameRing = [];
    }
    this.lastCapturedDisplayId = capture.displayId;
    this.frameRing.push(capture.frame);
    this.frameRing = this.frameRing.slice(-6);

    this.setStatus("analyzing", "正在请求视觉模型", now);
    const contactSheet = composeContactSheetPng(this.frameRing);
    const visionProvider = createVisionProvider(settings, this.options.onAiDebug);
    const draft = await visionProvider.analyze({
      imageBase64: contactSheet.toString("base64"),
      frameCount: this.frameRing.length,
      capturedAt: now,
      activeWindow: active,
      todayTask: this.options.getTodayTask(),
      language: settings.language,
    });

    if (draft.isSensitive) {
      this.memory.recordObservation({
        ...draft,
        summary: "视觉模型判断可能是敏感内容，已跳过弹幕。",
        isSensitive: true,
      });
      this.setStatus("sensitive_skipped", "视觉模型判断当前画面可能敏感", now);
      this.options.onStateChanged();
      return;
    }

    const { observation, currentSegment, rollups } = this.memory.recordObservation(draft);
    const context = this.memory.getContext();
    const danmakuProvider = createDanmakuProvider(settings, this.options.onAiDebug);
    await this.danmaku.generateAndStore(
      danmakuProvider,
      {
        observation,
        currentSegment,
        recentSegments: context.recentSegments,
        rollups,
        todayTask: this.options.getTodayTask(),
        language: settings.language,
        persona: settings.persona,
        recentMessages: context.recentDanmaku,
        maxMessages: computeDanmakuGenerationSize(settings.maxDanmakuPerRound),
        reserveMessages: computeDanmakuReserveSize(settings.maxDanmakuPerRound),
      },
      this.options.onDanmaku,
    );

    this.setStatus("idle", "已完成一轮观察", now);
    this.options.onStateChanged();
  }

  private async captureFrame(settings: AppSettings): Promise<{ frame: Buffer; displayId: number }> {
    const cursorDisplay = getCursorDisplay();
    const overlay = this.options.getOverlayWindow();
    const shouldRestoreOverlay =
      settings.hideOverlayDuringCapture &&
      !this.options.hasVisibleDanmaku() &&
      overlay?.isVisible() &&
      !overlay.isDestroyed();

    if (shouldRestoreOverlay && overlay) {
      overlay.hide();
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 640, height: 360 },
      });
      const source = selectSourceForDisplay(sources, cursorDisplay.id) ?? sources.find((item) => !item.thumbnail.isEmpty());
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error("没有获取到屏幕缩略图，请确认屏幕录制权限");
      }
      const sourceDisplay = getDisplayForSource(source) ?? cursorDisplay;
      return {
        frame: drawCursorOnFrame(
          source.thumbnail.toPNG(),
          sourceDisplay,
          screen.getCursorScreenPoint(),
        ),
        displayId: sourceDisplay.id,
      };
    } finally {
      if (shouldRestoreOverlay && overlay && !overlay.isDestroyed()) {
        overlay.showInactive();
        overlay.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  }

  private setStatus(state: EngineStatus["state"], message: string, lastRunAt: string | null): void {
    this.options.onStatus({ state, message, lastRunAt });
  }
}

function computeDanmakuReserveSize(density: number): number {
  return Math.min(48, Math.max(18, Math.round(density * 4)));
}

function computeDanmakuGenerationSize(density: number): number {
  return Math.min(12, Math.max(6, Math.round(density)));
}

function getCursorDisplay(): Electron.Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function selectSourceForDisplay(
  sources: DesktopCapturerSource[],
  displayId: number,
): DesktopCapturerSource | undefined {
  return sources.find((source) => source.display_id === String(displayId));
}

function getDisplayForSource(source: DesktopCapturerSource): Electron.Display | undefined {
  const id = Number(source.display_id);
  return screen.getAllDisplays().find((display) => display.id === id);
}

function drawCursorOnFrame(
  frame: Buffer,
  display: Electron.Display,
  cursorPoint: Electron.Point,
): Buffer {
  const localX = cursorPoint.x - display.bounds.x;
  const localY = cursorPoint.y - display.bounds.y;
  if (
    localX < 0 ||
    localY < 0 ||
    localX > display.bounds.width ||
    localY > display.bounds.height
  ) {
    return frame;
  }

  const png = PNG.sync.read(frame);
  const x = Math.round((localX / display.bounds.width) * png.width);
  const y = Math.round((localY / display.bounds.height) * png.height);
  const size = Math.max(18, Math.round(Math.min(png.width, png.height) * 0.065));
  const points = [
    [x, y],
    [x, y + size],
    [x + Math.round(size * 0.28), y + Math.round(size * 0.72)],
    [x + Math.round(size * 0.46), y + Math.round(size * 1.04)],
    [x + Math.round(size * 0.66), y + Math.round(size * 0.93)],
    [x + Math.round(size * 0.48), y + Math.round(size * 0.62)],
    [x + Math.round(size * 0.86), y + Math.round(size * 0.62)],
  ] as Array<[number, number]>;

  fillPolygon(png, points.map(([px, py]) => [px + 2, py + 2] as [number, number]), [0, 0, 0, 120]);
  fillPolygon(png, points, [255, 255, 255, 255]);
  drawPolygonOutline(png, points, [12, 12, 12, 255]);
  return PNG.sync.write(png);
}

function fillPolygon(png: PNG, points: Array<[number, number]>, color: [number, number, number, number]): void {
  const minX = Math.max(0, Math.min(...points.map(([x]) => x)));
  const maxX = Math.min(png.width - 1, Math.max(...points.map(([x]) => x)));
  const minY = Math.max(0, Math.min(...points.map(([, y]) => y)));
  const maxY = Math.min(png.height - 1, Math.max(...points.map(([, y]) => y)));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (isPointInPolygon(x + 0.5, y + 0.5, points)) {
        setPixel(png, x, y, color);
      }
    }
  }
}

function drawPolygonOutline(png: PNG, points: Array<[number, number]>, color: [number, number, number, number]): void {
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    drawLine(png, start[0], start[1], end[0], end[1], color);
  }
}

function drawLine(
  png: PNG,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: [number, number, number, number],
): void {
  let x = startX;
  let y = startY;
  const dx = Math.abs(endX - startX);
  const sx = startX < endX ? 1 : -1;
  const dy = -Math.abs(endY - startY);
  const sy = startY < endY ? 1 : -1;
  let error = dx + dy;

  while (true) {
    setPixel(png, x, y, color);
    setPixel(png, x + 1, y, color);
    setPixel(png, x, y + 1, color);
    if (x === endX && y === endY) {
      break;
    }
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
}

function setPixel(png: PNG, x: number, y: number, color: [number, number, number, number]): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }
  const index = (png.width * y + x) << 2;
  png.data[index] = color[0];
  png.data[index + 1] = color[1];
  png.data[index + 2] = color[2];
  png.data[index + 3] = color[3];
}

function isPointInPolygon(x: number, y: number, points: Array<[number, number]>): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

async function getActiveWindowInfo(): Promise<ActiveWindowInfo> {
  try {
    const window = await activeWindow({
      accessibilityPermission: false,
      screenRecordingPermission: false,
    });
    return {
      appName: window?.owner.name || "Unknown",
      windowTitle: window?.title || "",
    };
  } catch {
    return {
      appName: "Unknown",
      windowTitle: "",
    };
  }
}

function sensitiveObservation(capturedAt: string, active: ActiveWindowInfo): ObservationDraft {
  return {
    capturedAt,
    activityLabel: "sensitive",
    appName: active.appName,
    windowTitle: "",
    summary: "命中敏感应用名单，本轮没有截图和 AI 分析。",
    confidence: 1,
    possibleIntent: "privacy_skip",
    taskRelation: "unknown",
    isSensitive: true,
    source: "system_skip",
  };
}
