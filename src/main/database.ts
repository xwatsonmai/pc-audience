import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import { DEFAULT_SETTINGS, mergeSettings } from "../shared/defaults";
import type {
  AppSettings,
  BehaviorSegment,
  DanmakuMessage,
  MemoryRollup,
  ObservationDraft,
  ObservationRecord,
} from "../shared/types";

type Row = Record<string, unknown>;

const APP_SETTING_KEYS = new Set<keyof AppSettings>([
  "visionProviderMode",
  "textProviderMode",
  "openAiBaseUrl",
  "openAiApiKey",
  "openAiVisionModel",
  "openAiTextModel",
  "ollamaBaseUrl",
  "ollamaVisionModel",
  "ollamaTextModel",
  "persona",
  "paused",
  "observeIntervalMs",
  "maxDanmakuPerRound",
  "danmakuSpeed",
  "hideOverlayDuringCapture",
  "sensitiveApps",
]);

export class DatabaseService {
  private db: Database | null = null;

  constructor(private readonly options: { databasePath?: string; inMemory?: boolean }) {}

  async initialize(): Promise<void> {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");
    const SQL = await initSqlJs({
      locateFile: () => wasmPath,
    });

    const data =
      this.options.databasePath && fs.existsSync(this.options.databasePath)
        ? fs.readFileSync(this.options.databasePath)
        : undefined;
    this.db = new SQL.Database(data);
    this.migrate();
    this.migrateStoredSettings();
    this.persist();
  }

  getSettings(): AppSettings {
    const rows = this.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const patch: Partial<AppSettings> = {};
    for (const row of rows) {
      if (!isAppSettingKey(row.key)) {
        continue;
      }
      try {
        Object.assign(patch, { [row.key]: JSON.parse(row.value) });
      } catch {
        // Ignore corrupt setting rows and keep defaults.
      }
    }
    return mergeSettings(DEFAULT_SETTINGS, patch);
  }

  saveSettings(settings: AppSettings): void {
    for (const [key, value] of Object.entries(settings)) {
      this.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, JSON.stringify(value)],
        false,
      );
    }
    this.persist();
  }

  getTodayTask(dateKey: string): string {
    const row = this.get<{ task_text: string }>(
      "SELECT task_text FROM daily_tasks WHERE task_date = ?",
      [dateKey],
    );
    return row?.task_text ?? "";
  }

  setTodayTask(dateKey: string, taskText: string, now: string): void {
    this.run(
      `INSERT INTO daily_tasks (task_date, task_text, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(task_date) DO UPDATE SET task_text = excluded.task_text, updated_at = excluded.updated_at`,
      [dateKey, taskText, now],
    );
  }

  insertObservation(draft: ObservationDraft): ObservationRecord {
    this.run(
      `INSERT INTO observations (
        captured_at, activity_label, app_name, window_title, summary, confidence,
        possible_intent, task_relation, is_sensitive, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        draft.capturedAt,
        draft.activityLabel,
        draft.appName,
        draft.windowTitle,
        draft.summary,
        draft.confidence,
        draft.possibleIntent,
        draft.taskRelation,
        draft.isSensitive ? 1 : 0,
        draft.source,
      ],
    );
    const id = this.lastInsertId();
    return { id, ...draft };
  }

  getLatestObservation(): ObservationRecord | null {
    const row = this.get<Row>("SELECT * FROM observations ORDER BY id DESC LIMIT 1");
    return row ? mapObservation(row) : null;
  }

  getCurrentSegment(): BehaviorSegment | null {
    const row = this.get<Row>(
      "SELECT * FROM behavior_segments WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1",
    );
    return row ? mapSegment(row) : null;
  }

  getRecentSegments(limit = 8): BehaviorSegment[] {
    return this.all<Row>(
      "SELECT * FROM behavior_segments ORDER BY started_at DESC, id DESC LIMIT ?",
      [limit],
    ).map(mapSegment);
  }

  getSegmentsSince(iso: string): BehaviorSegment[] {
    return this.all<Row>(
      "SELECT * FROM behavior_segments WHERE updated_at >= ? ORDER BY started_at ASC, id ASC",
      [iso],
    ).map(mapSegment);
  }

  closeCurrentSegment(endedAt: string): void {
    this.run(
      "UPDATE behavior_segments SET ended_at = ?, updated_at = ? WHERE ended_at IS NULL",
      [endedAt, endedAt],
    );
  }

  createSegment(observation: ObservationRecord): BehaviorSegment {
    this.run(
      `INSERT INTO behavior_segments (
        started_at, ended_at, activity_label, app_name, summary, task_relation,
        observation_count, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, 1, ?)`,
      [
        observation.capturedAt,
        observation.activityLabel,
        observation.appName,
        observation.summary,
        observation.taskRelation,
        observation.capturedAt,
      ],
    );
    const id = this.lastInsertId();
    return {
      id,
      startedAt: observation.capturedAt,
      endedAt: null,
      activityLabel: observation.activityLabel,
      appName: observation.appName,
      summary: observation.summary,
      taskRelation: observation.taskRelation,
      observationCount: 1,
      updatedAt: observation.capturedAt,
    };
  }

  extendSegment(segment: BehaviorSegment, observation: ObservationRecord): BehaviorSegment {
    const summary =
      segment.summary === observation.summary
        ? segment.summary
        : `${segment.summary} / ${observation.summary}`;
    this.run(
      `UPDATE behavior_segments
       SET summary = ?, task_relation = ?, observation_count = observation_count + 1, updated_at = ?
       WHERE id = ?`,
      [summary.slice(0, 800), observation.taskRelation, observation.capturedAt, segment.id],
    );
    return {
      ...segment,
      summary: summary.slice(0, 800),
      taskRelation: observation.taskRelation,
      observationCount: segment.observationCount + 1,
      updatedAt: observation.capturedAt,
    };
  }

  upsertRollup(scope: MemoryRollup["scope"], startedAt: string, endedAt: string, summary: string): MemoryRollup {
    const now = new Date().toISOString();
    this.run(
      `INSERT INTO memory_rollups (scope, started_at, ended_at, summary, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(scope) DO UPDATE SET
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        summary = excluded.summary,
        updated_at = excluded.updated_at`,
      [scope, startedAt, endedAt, summary, now],
    );
    const row = this.get<Row>("SELECT * FROM memory_rollups WHERE scope = ?", [scope]);
    if (!row) {
      throw new Error("Failed to read rollup after write");
    }
    return mapRollup(row);
  }

  getRollups(): MemoryRollup[] {
    return this.all<Row>("SELECT * FROM memory_rollups ORDER BY scope ASC").map(mapRollup);
  }

  insertDanmaku(
    input: Omit<DanmakuMessage, "id" | "createdAt" | "shownAt">,
    now: string,
  ): DanmakuMessage {
    this.run(
      `INSERT INTO danmaku_messages (
        created_at, shown_at, persona, speaker, text, reason, observation_id, segment_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        now,
        input.persona,
        input.speaker ?? "",
        input.text,
        input.reason ?? "",
        input.observationId,
        input.segmentId,
      ],
    );
    return {
      id: this.lastInsertId(),
      createdAt: now,
      shownAt: now,
      ...input,
    };
  }

  getRecentDanmaku(limit = 12): DanmakuMessage[] {
    return this.all<Row>(
      "SELECT * FROM danmaku_messages ORDER BY id DESC LIMIT ?",
      [limit],
    ).map(mapDanmaku);
  }

  private migrate(): void {
    this.raw().run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_date TEXT NOT NULL UNIQUE,
        task_text TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at TEXT NOT NULL,
        activity_label TEXT NOT NULL,
        app_name TEXT NOT NULL,
        window_title TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0,
        possible_intent TEXT NOT NULL DEFAULT '',
        task_relation TEXT NOT NULL DEFAULT 'unknown',
        is_sensitive INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS behavior_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        activity_label TEXT NOT NULL,
        app_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        task_relation TEXT NOT NULL DEFAULT 'unknown',
        observation_count INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memory_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        summary TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS danmaku_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        shown_at TEXT NOT NULL,
        persona TEXT NOT NULL,
        speaker TEXT,
        text TEXT NOT NULL,
        reason TEXT,
        observation_id INTEGER,
        segment_id INTEGER
      );
    `);

    this.addColumnIfMissing("danmaku_messages", "speaker", "TEXT");
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const columns = this.all<{ name: string }>(`PRAGMA table_info(${table})`).map((row) => row.name);
    if (!columns.includes(column)) {
      this.raw().run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  private migrateStoredSettings(): void {
    this.migrateProviderRoutes();

    const version = this.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'danmakuDensityVersion'",
    );
    if (version) {
      return;
    }

    const storedDensity = this.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'maxDanmakuPerRound'",
    );
    const parsedDensity = storedDensity ? parseStoredNumber(storedDensity.value) : null;
    if (!storedDensity || parsedDensity === null || parsedDensity === 2) {
      this.run(
        "INSERT INTO settings (key, value) VALUES ('maxDanmakuPerRound', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [JSON.stringify(DEFAULT_SETTINGS.maxDanmakuPerRound)],
        false,
      );
    }
    this.run(
      "INSERT INTO settings (key, value) VALUES ('danmakuDensityVersion', '1')",
      [],
      false,
    );
  }

  private migrateProviderRoutes(): void {
    const visionMode = this.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'visionProviderMode'",
    );
    const textMode = this.get<{ value: string }>(
      "SELECT value FROM settings WHERE key = 'textProviderMode'",
    );
    const legacyMode = parseProviderMode(
      this.get<{ value: string }>("SELECT value FROM settings WHERE key = 'providerMode'")?.value,
    );
    const fallbackMode = legacyMode ?? DEFAULT_SETTINGS.visionProviderMode;

    if (!visionMode) {
      this.run(
        "INSERT INTO settings (key, value) VALUES ('visionProviderMode', ?)",
        [JSON.stringify(fallbackMode)],
        false,
      );
    }
    if (!textMode) {
      this.run(
        "INSERT INTO settings (key, value) VALUES ('textProviderMode', ?)",
        [JSON.stringify(fallbackMode)],
        false,
      );
    }
  }

  private run(sql: string, params: unknown[] = [], shouldPersist = true): void {
    this.raw().run(sql, params as never[]);
    if (shouldPersist) {
      this.persist();
    }
  }

  private get<T extends Row>(sql: string, params: unknown[] = []): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  private all<T extends Row>(sql: string, params: unknown[] = []): T[] {
    const result = this.raw().exec(sql, params as never[]);
    if (result.length === 0) {
      return [];
    }
    const { columns, values } = result[0];
    return values.map((row) =>
      Object.fromEntries(row.map((value, index) => [columns[index], value])),
    ) as T[];
  }

  private lastInsertId(): number {
    const row = this.get<{ id: number }>("SELECT last_insert_rowid() AS id");
    return Number(row?.id ?? 0);
  }

  private persist(): void {
    if (this.options.inMemory || !this.options.databasePath || !this.db) {
      return;
    }
    fs.mkdirSync(path.dirname(this.options.databasePath), { recursive: true });
    fs.writeFileSync(this.options.databasePath, Buffer.from(this.db.export()));
  }

  private raw(): Database {
    if (!this.db) {
      throw new Error("DatabaseService is not initialized");
    }
    return this.db;
  }
}

function mapObservation(row: Row): ObservationRecord {
  return {
    id: Number(row.id),
    capturedAt: String(row.captured_at),
    activityLabel: String(row.activity_label),
    appName: String(row.app_name),
    windowTitle: String(row.window_title ?? ""),
    summary: String(row.summary),
    confidence: Number(row.confidence),
    possibleIntent: String(row.possible_intent ?? ""),
    taskRelation: String(row.task_relation) as ObservationRecord["taskRelation"],
    isSensitive: Number(row.is_sensitive) === 1,
    source: String(row.source) as ObservationRecord["source"],
  };
}

function mapSegment(row: Row): BehaviorSegment {
  return {
    id: Number(row.id),
    startedAt: String(row.started_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    activityLabel: String(row.activity_label),
    appName: String(row.app_name),
    summary: String(row.summary),
    taskRelation: String(row.task_relation) as BehaviorSegment["taskRelation"],
    observationCount: Number(row.observation_count),
    updatedAt: String(row.updated_at),
  };
}

function mapRollup(row: Row): MemoryRollup {
  return {
    id: Number(row.id),
    scope: String(row.scope) as MemoryRollup["scope"],
    startedAt: String(row.started_at),
    endedAt: String(row.ended_at),
    summary: String(row.summary),
    updatedAt: String(row.updated_at),
  };
}

function mapDanmaku(row: Row): DanmakuMessage {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    shownAt: String(row.shown_at),
    persona: String(row.persona) as DanmakuMessage["persona"],
    speaker: row.speaker ? String(row.speaker) : "",
    text: String(row.text),
    reason: row.reason ? String(row.reason) : "",
    observationId: row.observation_id === null ? null : Number(row.observation_id),
    segmentId: row.segment_id === null ? null : Number(row.segment_id),
  };
}

function parseStoredNumber(value: string): number | null {
  try {
    const parsed = Number(JSON.parse(value));
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseProviderMode(value: string | undefined): AppSettings["visionProviderMode"] | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed === "openai" || parsed === "ollama" ? parsed : null;
  } catch {
    return null;
  }
}

function isAppSettingKey(value: string): value is keyof AppSettings {
  return APP_SETTING_KEYS.has(value as keyof AppSettings);
}
