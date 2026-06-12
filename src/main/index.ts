import { app, BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, mergeSettings, toPublicSettings } from "../shared/defaults";
import { normalizeBaseUrlForProvider } from "./ai/providers";
import type {
  AiDebugEvent,
  AppSettings,
  AppState,
  DanmakuMessage,
  DiagnosticEvent,
  EngineStatus,
} from "../shared/types";
import { DatabaseService } from "./database";
import { DanmakuService } from "./services/danmaku";
import { MemoryService } from "./services/memory";
import { ObserverService } from "./services/observer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let database: DatabaseService;
let memoryService: MemoryService;
let observerService: ObserverService;
let overlayActiveCount = 0;
let overlayHasPlayed = false;
let diagnosticId = 0;
let aiDebugId = 0;
const diagnostics: DiagnosticEvent[] = [];
const aiDebugEvents: AiDebugEvent[] = [];
let engineStatus: EngineStatus = {
  state: "idle",
  message: "等待启动观察",
  lastRunAt: null,
};

app.setName("PC Audience");

process.on("uncaughtException", (error) => {
  recordDiagnostic("error", "main", `未捕获异常：${formatError(error)}`);
});

process.on("unhandledRejection", (reason) => {
  recordDiagnostic("error", "main", `未处理 Promise：${formatError(reason)}`);
});

void app.whenReady().then(async () => {
  database = new DatabaseService({
    databasePath: path.join(app.getPath("userData"), "pc-audience.sqlite"),
  });
  await database.initialize();
  if (!database.getSettings()) {
    database.saveSettings(DEFAULT_SETTINGS);
  }

  memoryService = new MemoryService(database);
  const danmakuService = new DanmakuService(database);

  registerIpc();
  mainWindow = createMainWindow();

  observerService = new ObserverService(memoryService, danmakuService, {
    getSettings: () => database.getSettings(),
    getTodayTask: () => database.getTodayTask(todayKey()),
    getOverlayWindow: () => overlayWindow,
    hasVisibleDanmaku: () => overlayActiveCount > 0,
    onStatus: (status) => {
      engineStatus = status;
      if (status.state === "error") {
        recordDiagnostic("error", "observer", status.message);
      } else {
        broadcastState();
      }
    },
    onStateChanged: broadcastState,
    onDanmaku: (messages) => {
      broadcastDanmaku(messages);
      broadcastState();
    },
    onAiDebug: recordAiDebug,
  });
  observerService.start();

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  observerService?.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpc(): void {
  ipcMain.handle("app:get-state", () => getAppState());
  ipcMain.handle("app:update-settings", (_event, patch: Partial<AppSettings>) => {
    const current = database.getSettings();
    const normalizedPatch = { ...patch };
    if (normalizedPatch.openAiApiKey === "") {
      delete normalizedPatch.openAiApiKey;
    }
    if (normalizedPatch.ollamaBaseUrl) {
      normalizedPatch.ollamaBaseUrl = normalizeBaseUrlForProvider("ollama", normalizedPatch.ollamaBaseUrl);
    }
    if (normalizedPatch.openAiBaseUrl) {
      normalizedPatch.openAiBaseUrl = normalizeBaseUrlForProvider("openai", normalizedPatch.openAiBaseUrl);
    }
    const next = mergeSettings(current, normalizedPatch);
    database.saveSettings(next);
    observerService?.updateSettings();
    broadcastState();
    return getAppState();
  });
  ipcMain.handle("app:set-task", (_event, taskText: string) => {
    database.setTodayTask(todayKey(), taskText.trim(), new Date().toISOString());
    broadcastState();
    return getAppState();
  });
  ipcMain.handle("app:toggle-paused", (_event, paused: boolean) => {
    const next = mergeSettings(database.getSettings(), { paused });
    database.saveSettings(next);
    observerService?.updateSettings();
    broadcastState();
    return getAppState();
  });
  ipcMain.handle("app:observe-now", async () => {
    await observerService?.runOnce();
    return getAppState();
  });
  ipcMain.on("overlay:activity", (_event, activeCount: number) => {
    overlayActiveCount = Math.max(0, Math.min(128, Math.round(Number(activeCount) || 0)));
    if (overlayActiveCount > 0) {
      overlayHasPlayed = true;
    }
    if (
      overlayActiveCount === 0 &&
      overlayHasPlayed &&
      overlayWindow &&
      !overlayWindow.isDestroyed()
    ) {
      const finishedWindow = overlayWindow;
      overlayWindow = null;
      overlayHasPlayed = false;
      finishedWindow.close();
    }
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1380,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    title: "PC Audience",
    backgroundColor: "#f8fcff",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle("PC Audience");
  });
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  attachWindowDiagnostics(window, "main");
  void loadRenderer(window, "main");
  return window;
}

function createOverlayWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const window = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAlwaysOnTop(true, "floating");
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  window.on("closed", () => {
    if (overlayWindow === window) {
      overlayWindow = null;
      overlayActiveCount = 0;
      overlayHasPlayed = false;
    }
  });
  attachWindowDiagnostics(window, "overlay");
  void loadRenderer(window, "overlay");
  return window;
}

async function loadRenderer(window: BrowserWindow, route: "main" | "overlay"): Promise<void> {
  window.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
    const text = `${message} (${sourceId}:${line})`;
    console.log(`[renderer:${route}] ${text}`);
    if (message.includes("Error") || message.includes("error") || message.includes("失败")) {
      recordDiagnostic("error", `renderer:${route}`, text);
    }
  });
  const hash = route === "overlay" ? "#/overlay" : "#/main";
  if (process.env.ELECTRON_RENDERER_URL) {
    await window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${hash}`);
  } else {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: `/${route}` });
  }
}

function getAppState(): AppState {
  const context = memoryService?.getContext() ?? {
    latestObservation: null,
    currentSegment: null,
    recentSegments: [],
    rollups: [],
    recentDanmaku: [],
  };
  const settings = database?.getSettings() ?? DEFAULT_SETTINGS;
  return {
    settings: toPublicSettings(settings),
    todayTask: database?.getTodayTask(todayKey()) ?? "",
    engineStatus,
    latestObservation: context.latestObservation,
    currentSegment: context.currentSegment,
    recentSegments: context.recentSegments,
    rollups: context.rollups,
    recentDanmaku: context.recentDanmaku,
    diagnostics: diagnostics.slice().reverse(),
    aiDebugEvents: aiDebugEvents.slice().reverse(),
  };
}

function broadcastState(): void {
  const state = getAppState();
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send("app:state", state);
    }
  }
}

function broadcastDanmaku(messages: DanmakuMessage[]): void {
  if (messages.length === 0) {
    return;
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    sendDanmakuToOverlay(overlayWindow, messages, false);
    return;
  }
  overlayWindow = createOverlayWindow();
  sendDanmakuToOverlay(overlayWindow, messages, true);
}

function sendDanmakuToOverlay(
  window: BrowserWindow,
  messages: DanmakuMessage[],
  waitForLoad: boolean,
): void {
  moveOverlayToPrimaryDisplay(window);
  if (!window.isVisible()) {
    window.showInactive();
    window.setIgnoreMouseEvents(true, { forward: true });
  }
  const send = () => {
    if (!window.isDestroyed()) {
      window.webContents.send("danmaku:push", messages);
    }
  };
  if (waitForLoad) {
    window.webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function moveOverlayToPrimaryDisplay(window: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  window.setBounds({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  });
}

function attachWindowDiagnostics(window: BrowserWindow, route: "main" | "overlay"): void {
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    recordDiagnostic(
      "error",
      `renderer:${route}`,
      `加载失败 ${validatedUrl}: ${errorCode} ${errorDescription}`,
    );
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    recordDiagnostic("error", `renderer:${route}`, `渲染进程退出：${details.reason}`);
  });
}

function recordDiagnostic(
  level: DiagnosticEvent["level"],
  source: string,
  message: string,
): void {
  diagnostics.push({
    id: ++diagnosticId,
    at: new Date().toISOString(),
    level,
    source,
    message: message.slice(0, 1_000),
  });
  diagnostics.splice(0, Math.max(0, diagnostics.length - 40));
  if (level === "error") {
    engineStatus = {
      state: "error",
      message: message.slice(0, 160),
      lastRunAt: new Date().toISOString(),
    };
  }
  broadcastState();
}

function recordAiDebug(event: Omit<AiDebugEvent, "id" | "at">): void {
  const existing = aiDebugEvents.find((item) => item.requestId === event.requestId);
  if (existing) {
    Object.assign(existing, {
      ...event,
      at: new Date().toISOString(),
      imagePreviewDataUrl: event.imagePreviewDataUrl ?? existing.imagePreviewDataUrl,
    });
  } else {
    aiDebugEvents.push({
      id: ++aiDebugId,
      at: new Date().toISOString(),
      ...event,
    });
  }
  aiDebugEvents.splice(0, Math.max(0, aiDebugEvents.length - 50));
  broadcastState();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}
