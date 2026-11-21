import { parseCycle, type CycleFile } from "./practice-cycle";
import { loadGame, type GameState } from "./practice-engine";
import { hasProgress, parseHistory, type ArchivedGame, type HistoryFile } from "./practice-history";
import { sanitizeScenarios, type Scenario } from "./simulator";

export const SYNC_CODE_KEY = "snc-sync-code";
export const SYNC_META_KEY = "snc-sync-meta";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type SyncSettings = {
  speed: number | null;
  realistic: boolean | null;
  chartH: number | null;
  theme: "light" | "dark" | null;
  at: number;
};

export type SyncMeta = {
  gameAt: number;
  cycleAt: number;
  settingsAt: number;
  simulatorAt: number;
  deletedIds: string[];
  clearedAt: number | null;
};

export type SyncDoc = {
  v: 1;
  practice: {
    games: ArchivedGame[];
    deletedIds: string[];
    clearedAt: number | null;
    game: GameState | null;
    gameAt: number;
    cycle: CycleFile | null;
    cycleAt: number;
    settings: SyncSettings;
  };
  simulator: {
    scenarios: Scenario[];
    at: number;
  };
};

export function emptyMeta(): SyncMeta {
  return { gameAt: 0, cycleAt: 0, settingsAt: 0, simulatorAt: 0, deletedIds: [], clearedAt: null };
}

export function emptySync(): SyncDoc {
  return {
    v: 1,
    practice: {
      games: [],
      deletedIds: [],
      clearedAt: null,
      game: null,
      gameAt: 0,
      cycle: null,
      cycleAt: 0,
      settings: { speed: null, realistic: null, chartH: null, theme: null, at: 0 },
    },
    simulator: { scenarios: [], at: 0 },
  };
}

export function isSyncCode(value: string): boolean {
  return /^[a-z2-9]{8,12}$/.test(value);
}

export function newSyncCode(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function codeFromInput(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const linked = trimmed.match(/sync=([a-z2-9]{8,12})/);
  if (linked) return linked[1];
  return isSyncCode(trimmed) ? trimmed : null;
}

function stamp(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function endedAt(game: ArchivedGame): number {
  const parsed = Date.parse(game.endedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function keepGame(game: ArchivedGame, deleted: Set<string>, clearedAt: number | null): boolean {
  if (!game.id || deleted.has(game.id)) return false;
  if (clearedAt !== null && endedAt(game) <= clearedAt) return false;
  return true;
}

function preferGame(left: ArchivedGame, right: ArchivedGame): ArchivedGame {
  const days = (game: ArchivedGame) => game.batches.reduce((sum, batch) => sum + batch.days.length, 0);
  const leftDays = days(left);
  const rightDays = days(right);
  if (rightDays !== leftDays) return rightDays > leftDays ? right : left;
  return endedAt(right) >= endedAt(left) ? right : left;
}

function mergeGames(left: ArchivedGame[], right: ArchivedGame[], deleted: Set<string>, clearedAt: number | null): ArchivedGame[] {
  const byId = new Map<string, ArchivedGame>();
  for (const game of [...left, ...right]) {
    if (!keepGame(game, deleted, clearedAt)) continue;
    const current = byId.get(game.id);
    byId.set(game.id, current ? preferGame(current, game) : game);
  }
  return [...byId.values()].sort((a, b) => endedAt(a) - endedAt(b) || a.number - b.number);
}

function progressScore(game: GameState): number {
  return game.day * 1_000_000 + game.cursor * 1_000 + game.tick + (hasProgress(game) ? 1 : 0);
}

function mergeSession(
  left: { game: GameState | null; gameAt: number },
  right: { game: GameState | null; gameAt: number },
): { game: GameState | null; gameAt: number } {
  if (left.gameAt !== right.gameAt) return left.gameAt > right.gameAt ? left : right;
  if (!left.game) return right;
  if (!right.game) return left;
  return progressScore(right.game) >= progressScore(left.game) ? right : left;
}

function mergeSettings(left: SyncSettings, right: SyncSettings): SyncSettings {
  if (left.at !== right.at) return left.at > right.at ? left : right;
  return {
    speed: right.speed ?? left.speed,
    realistic: right.realistic ?? left.realistic,
    chartH: right.chartH ?? left.chartH,
    theme: right.theme ?? left.theme,
    at: Math.max(left.at, right.at),
  };
}

function mergeScenarios(
  left: { scenarios: Scenario[]; at: number },
  right: { scenarios: Scenario[]; at: number },
): { scenarios: Scenario[]; at: number } {
  if (left.at !== right.at) return left.at > right.at ? left : right;
  const byId = new Map<string, Scenario>();
  for (const scenario of left.scenarios) byId.set(scenario.id, scenario);
  for (const scenario of right.scenarios) byId.set(scenario.id, scenario);
  return { scenarios: [...byId.values()], at: left.at };
}

export function mergeSync(left: SyncDoc, right: SyncDoc): SyncDoc {
  const deletedIds = [...new Set([...left.practice.deletedIds, ...right.practice.deletedIds])].slice(-500);
  const clearedAt = Math.max(left.practice.clearedAt ?? 0, right.practice.clearedAt ?? 0) || null;
  const session = mergeSession(left.practice, right.practice);
  const cycle = left.practice.cycleAt === right.practice.cycleAt
    ? right.practice.cycle ?? left.practice.cycle
    : left.practice.cycleAt > right.practice.cycleAt
      ? left.practice.cycle
      : right.practice.cycle;
  const cycleAt = Math.max(left.practice.cycleAt, right.practice.cycleAt);
  const simulator = mergeScenarios(left.simulator, right.simulator);
  return {
    v: 1,
    practice: {
      games: mergeGames(left.practice.games, right.practice.games, new Set(deletedIds), clearedAt),
      deletedIds,
      clearedAt,
      game: session.game,
      gameAt: session.gameAt,
      cycle,
      cycleAt,
      settings: mergeSettings(left.practice.settings, right.practice.settings),
    },
    simulator,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function sanitizeSync(value: unknown, dayCount = 400): SyncDoc {
  const row = asObject(value);
  const practice = asObject(row?.practice);
  const simulator = asObject(row?.simulator);
  const history = parseHistory(practice ? JSON.stringify({ v: 1, games: practice.games }) : null);
  const game = practice?.game ? loadGame(JSON.stringify(practice.game), dayCount) : null;
  const settings = asObject(practice?.settings);
  const theme = settings?.theme === "dark" || settings?.theme === "light" ? settings.theme : null;
  const chartH = stamp(settings?.chartH);
  const deleted = Array.isArray(practice?.deletedIds)
    ? practice.deletedIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 80).slice(-500)
    : [];
  const scenarios = sanitizeScenarios(simulator?.scenarios) ?? [];
  return {
    v: 1,
    practice: {
      games: history.games,
      deletedIds: deleted,
      clearedAt: stamp(practice?.clearedAt) || null,
      game,
      gameAt: stamp(practice?.gameAt),
      cycle: practice?.cycle ? parseCycle(JSON.stringify(practice.cycle)) : null,
      cycleAt: stamp(practice?.cycleAt),
      settings: {
        speed: stamp(settings?.speed) || null,
        realistic: typeof settings?.realistic === "boolean" ? settings.realistic : null,
        chartH: chartH >= 220 && chartH <= 1200 ? chartH : null,
        theme,
        at: stamp(settings?.at),
      },
    },
    simulator: { scenarios, at: stamp(simulator?.at) },
  };
}

export function historyFile(doc: SyncDoc): HistoryFile {
  return { v: 1, games: doc.practice.games };
}
