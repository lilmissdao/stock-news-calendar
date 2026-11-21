import { parseCycle, CYCLE_KEY, type CycleFile } from "./practice-cycle";
import { loadGame, type GameState, type Speed } from "./practice-engine";
import { hasProgress, HISTORY_KEY, parseHistory, SPEED_KEY, type HistoryFile } from "./practice-history";
import { loadScenarios, saveScenarios, STORAGE_KEY as SIM_KEY, type Scenario } from "./simulator";
import {
  codeFromInput,
  emptyMeta,
  historyFile,
  isSyncCode,
  newSyncCode,
  sanitizeSync,
  SYNC_CODE_KEY,
  SYNC_META_KEY,
  type SyncDoc,
  type SyncMeta,
} from "./sync";

export const PRACTICE_KEY = "snc-practice:v1";
export const REALISTIC_KEY = "snc-practice-realistic";
export const CHART_KEY = "snc-practice-chart-h";
export const THEME_KEY = "snc-theme";

const DAY_COUNT = 400;
let applying = false;
let timer = 0;
let running = false;
let queued = false;
let watched = false;

export function isApplyingSync(): boolean {
  return applying;
}

export function readMeta(): SyncMeta {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_META_KEY) || "null") as Partial<SyncMeta> | null;
    if (!parsed || typeof parsed !== "object") return emptyMeta();
    return {
      gameAt: numberAt(parsed.gameAt),
      cycleAt: numberAt(parsed.cycleAt),
      settingsAt: numberAt(parsed.settingsAt),
      simulatorAt: numberAt(parsed.simulatorAt),
      deletedIds: Array.isArray(parsed.deletedIds) ? parsed.deletedIds.filter((id): id is string => typeof id === "string") : [],
      clearedAt: numberAt(parsed.clearedAt) || null,
    };
  } catch {
    return emptyMeta();
  }
}

function writeMeta(meta: SyncMeta) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

function numberAt(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function readSyncCode(): string | null {
  try {
    const code = localStorage.getItem(SYNC_CODE_KEY)?.trim().toLowerCase() ?? "";
    return isSyncCode(code) ? code : null;
  } catch {
    return null;
  }
}

export function writeSyncCode(code: string) {
  localStorage.setItem(SYNC_CODE_KEY, code);
}

export function adoptSyncCode(search = ""): string | null {
  const params = new URLSearchParams(search || (typeof window === "undefined" ? "" : window.location.search));
  const fromLink = codeFromInput(params.get("sync") ?? "");
  if (fromLink) {
    writeSyncCode(fromLink);
    params.delete("sync");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    return fromLink;
  }
  return readSyncCode();
}

export function linkSyncCode(input: string): string | null {
  const code = codeFromInput(input);
  if (!code) return null;
  writeSyncCode(code);
  return code;
}

export function createSyncCode(): string {
  const code = newSyncCode();
  writeSyncCode(code);
  return code;
}

export function tombstoneGame(id: string) {
  const meta = readMeta();
  if (!meta.deletedIds.includes(id)) meta.deletedIds.push(id);
  writeMeta(meta);
}

export function tombstoneAll(ids: string[]) {
  const meta = readMeta();
  meta.clearedAt = Date.now();
  meta.deletedIds = [...new Set([...meta.deletedIds, ...ids])].slice(-500);
  writeMeta(meta);
}

export function touchSection(section: "game" | "cycle" | "settings" | "simulator") {
  const meta = readMeta();
  const now = Date.now();
  if (section === "game") meta.gameAt = now;
  if (section === "cycle") meta.cycleAt = now;
  if (section === "settings") meta.settingsAt = now;
  if (section === "simulator") meta.simulatorAt = now;
  writeMeta(meta);
}

function readSettings(meta: SyncMeta): SyncDoc["practice"]["settings"] {
  const speed = Number(localStorage.getItem(SPEED_KEY));
  const realistic = localStorage.getItem(REALISTIC_KEY);
  const theme = localStorage.getItem(THEME_KEY);
  const chartH = Number(localStorage.getItem(CHART_KEY));
  return {
    speed: speed === 1 || speed === 2 || speed === 5 || speed === 15 ? speed : null,
    realistic: realistic === null ? null : realistic !== "0",
    chartH: chartH >= 220 && chartH <= 1200 ? chartH : null,
    theme: theme === "dark" || theme === "light" ? theme : null,
    at: meta.settingsAt,
  };
}

export function snapshotFromStorage(): SyncDoc {
  const meta = readMeta();
  const history = parseHistory(localStorage.getItem(HISTORY_KEY));
  const game = loadGame(localStorage.getItem(PRACTICE_KEY), DAY_COUNT);
  const cycle = localStorage.getItem(CYCLE_KEY) ? parseCycle(localStorage.getItem(CYCLE_KEY)) : null;
  const started = game ? Date.parse(game.startedAt) : 0;
  const gameAt = meta.gameAt || (game && hasProgress(game) && Number.isFinite(started) ? started : 0);
  return sanitizeSync({
    v: 1,
    practice: {
      games: history.games,
      deletedIds: meta.deletedIds,
      clearedAt: meta.clearedAt,
      game,
      gameAt,
      cycle,
      cycleAt: meta.cycleAt,
      settings: readSettings(meta),
    },
    simulator: { scenarios: loadScenarios() ?? [], at: meta.simulatorAt },
  });
}

function publish(status: "synced" | "offline" | "error", doc?: SyncDoc, wrote?: Partial<SyncEventDetail>) {
  window.dispatchEvent(new CustomEvent("snc-sync", { detail: { status, doc, ...wrote } }));
}

function applyDoc(doc: SyncDoc) {
  const meta = readMeta();
  const historyChanged = JSON.stringify(doc.practice.games) !== JSON.stringify(parseHistory(localStorage.getItem(HISTORY_KEY)).games);
  const scenariosChanged = doc.simulator.at > meta.simulatorAt;
  const wroteGame = !!doc.practice.game && doc.practice.gameAt > meta.gameAt;
  const wroteCycle = !!doc.practice.cycle && doc.practice.cycleAt > meta.cycleAt;
  const wroteSettings = doc.practice.settings.at > meta.settingsAt;
  if (!wroteGame && !wroteCycle && !wroteSettings && !historyChanged && !scenariosChanged && doc.practice.deletedIds.join() === meta.deletedIds.join()) {
    publish("synced", doc);
    return;
  }
  applying = true;
  if (historyChanged || doc.practice.deletedIds.join() !== meta.deletedIds.join()) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyFile(doc)));
  }
  if (wroteGame) localStorage.setItem(PRACTICE_KEY, JSON.stringify(doc.practice.game));
  if (wroteCycle) localStorage.setItem(CYCLE_KEY, JSON.stringify(doc.practice.cycle));
  const settings = doc.practice.settings;
  if (wroteSettings) {
    if (settings.speed) localStorage.setItem(SPEED_KEY, String(settings.speed));
    if (settings.realistic !== null) localStorage.setItem(REALISTIC_KEY, settings.realistic ? "1" : "0");
    if (settings.chartH) localStorage.setItem(CHART_KEY, String(settings.chartH));
    if (settings.theme) {
      localStorage.setItem(THEME_KEY, settings.theme);
      document.documentElement.dataset.theme = settings.theme;
    }
  }
  if (scenariosChanged) saveScenarios(doc.simulator.scenarios);
  writeMeta({
    gameAt: Math.max(meta.gameAt, doc.practice.gameAt),
    cycleAt: Math.max(meta.cycleAt, doc.practice.cycleAt),
    settingsAt: Math.max(meta.settingsAt, settings.at),
    simulatorAt: Math.max(meta.simulatorAt, doc.simulator.at),
    deletedIds: doc.practice.deletedIds,
    clearedAt: doc.practice.clearedAt,
  });
  publish("synced", doc, { wroteGame, wroteHistory: historyChanged, wroteCycle, wroteSettings, wroteScenarios: scenariosChanged });
  window.setTimeout(() => {
    applying = false;
  }, 500);
}

async function runSync() {
  const code = readSyncCode();
  if (!code) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    const local = snapshotFromStorage();
    const meta = readMeta();
    writeMeta({
      ...meta,
      gameAt: Math.max(meta.gameAt, local.practice.gameAt),
      cycleAt: Math.max(meta.cycleAt, local.practice.cycleAt),
      settingsAt: Math.max(meta.settingsAt, local.practice.settings.at),
      simulatorAt: Math.max(meta.simulatorAt, local.simulator.at),
    });
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, doc: local }),
    });
    if (!response.ok) {
      publish(response.status === 503 ? "offline" : "error");
      return;
    }
    applyDoc(sanitizeSync(await response.json()));
  } catch {
    publish("offline");
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void runSync();
    }
  }
}

export function scheduleSync(delay = 800) {
  if (typeof window === "undefined" || !readSyncCode()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runSync(), delay);
}

export function watchSync() {
  if (watched || typeof window === "undefined") return;
  watched = true;
  const refresh = () => {
    if (document.visibilityState === "visible") scheduleSync(0);
  };
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
}

export function syncNow() {
  scheduleSync(0);
}

export type SyncEventDetail = {
  status: "synced" | "offline" | "error";
  doc?: SyncDoc;
  wroteGame?: boolean;
  wroteHistory?: boolean;
  wroteCycle?: boolean;
  wroteSettings?: boolean;
  wroteScenarios?: boolean;
};

export type { CycleFile, GameState, HistoryFile, Scenario, Speed, SyncDoc };
