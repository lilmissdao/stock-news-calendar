import { STARTING_CASH } from "./practice-trade";
import {
  coerceSpeed,
  loadGame,
  summarizeBatch,
  type BatchSummary,
  type DayResult,
  type GameState,
  type Speed,
} from "./practice-engine";

export const HISTORY_KEY = "snc-practice-history:v1";
export const SPEED_KEY = "snc-practice-speed";

export type ArchivedGame = {
  id: string;
  number: number;
  playedAt: string;
  endedAt: string;
  batches: BatchSummary[];
  endingBalance: number;
  startBalance: number;
};

export type HistoryFile = { v: 1; games: ArchivedGame[] };

export function emptyHistory(): HistoryFile {
  return { v: 1, games: [] };
}

function isBatch(value: unknown): value is BatchSummary {
  if (!value || typeof value !== "object") return false;
  const batch = value as Partial<BatchSummary>;
  return Array.isArray(batch.days) && typeof batch.startEquity === "number" && typeof batch.endEquity === "number";
}

function cleanBatch(value: BatchSummary): BatchSummary {
  return { ...value, trades: Array.isArray(value.trades) ? value.trades : [], days: value.days };
}

function cleanGame(value: unknown, index: number): ArchivedGame | null {
  if (!value || typeof value !== "object") return null;
  const game = value as Partial<ArchivedGame>;
  if (!Array.isArray(game.batches)) return null;
  const batches = game.batches.filter(isBatch).map(cleanBatch);
  const last = batches[batches.length - 1];
  return {
    id: typeof game.id === "string" ? game.id : `g${index}`,
    number: typeof game.number === "number" ? game.number : index + 1,
    playedAt: typeof game.playedAt === "string" ? game.playedAt : "",
    endedAt: typeof game.endedAt === "string" ? game.endedAt : "",
    batches,
    endingBalance: typeof game.endingBalance === "number" ? game.endingBalance : last?.endEquity ?? 0,
    startBalance: typeof game.startBalance === "number" ? game.startBalance : batches[0]?.startEquity ?? STARTING_CASH,
  };
}

export function parseHistory(raw: string | null): HistoryFile {
  if (!raw) return emptyHistory();
  try {
    const parsed = JSON.parse(raw) as Partial<HistoryFile> | PracticeExport;
    const games = Array.isArray((parsed as HistoryFile).games)
      ? (parsed as HistoryFile).games
      : (parsed as PracticeExport).history?.games;
    if (!Array.isArray(games)) return emptyHistory();
    return { v: 1, games: games.map(cleanGame).filter((game): game is ArchivedGame => game !== null) };
  } catch {
    return emptyHistory();
  }
}

export function hasProgress(state: GameState): boolean {
  const shares = state.positions.TQQQ.shares + state.positions.SQQQ.shares;
  return (
    state.history.batches.length > 0 ||
    state.batchDays.length > 0 ||
    state.batchTrades.length > 0 ||
    state.markers.length > 0 ||
    state.day > 0 ||
    state.cursor > 0 ||
    state.tick > 0 ||
    shares > 0 ||
    state.dayFees > 0 ||
    Math.round(state.cash) !== STARTING_CASH
  );
}

export function archiveCurrent(
  state: GameState,
  history: HistoryFile,
  endingBalance: number,
  currentDate: string,
  pendingHold: number,
): HistoryFile {
  if (!hasProgress(state)) return history;
  const batches = [...state.history.batches];
  if (state.phase !== "batch") {
    const days = [...state.batchDays];
    const open = state.positions.TQQQ.shares + state.positions.SQQQ.shares > 0;
    const started = state.phase === "play" && (state.cursor > 0 || state.tick > 0 || state.markers.length > 0 || state.dayFees > 0 || open);
    if (started) {
      days.push({
        date: currentDate,
        dollars: endingBalance - state.dayStartEquity,
        pct: state.dayStartEquity > 0 ? endingBalance / state.dayStartEquity - 1 : 0,
        equity: endingBalance,
        drawdown: state.dayDrawdown,
        fees: state.dayFees,
      });
    }
    if (days.length > 0 || state.batchTrades.length > 0) {
      const end = days.length ? days[days.length - 1].equity : endingBalance;
      batches.push(summarizeBatch(days, state.batchTrades, state.batchStartEquity, end, state.batchFees, pendingHold));
    }
  }
  if (batches.length === 0) return history;
  const game: ArchivedGame = {
    id: `g${Date.now().toString(36)}`,
    number: history.games.length + 1,
    playedAt: state.startedAt || new Date().toISOString(),
    endedAt: new Date().toISOString(),
    batches,
    endingBalance,
    startBalance: state.history.equity[0]?.value || STARTING_CASH,
  };
  return { v: 1, games: [...history.games, game] };
}

export type BatchPoint = { returnPct: number; winRate: number | null };

export function completedBatches(batches: BatchSummary[]): BatchSummary[] {
  return batches.filter((batch) => batch.days.length >= 5);
}

export function progressPoints(history: HistoryFile, current: BatchSummary[]): BatchPoint[] {
  const batches = [...history.games.flatMap((game) => completedBatches(game.batches)), ...completedBatches(current)];
  return batches.map((batch) => ({
    returnPct: batch.startEquity ? batch.endEquity / batch.startEquity - 1 : 0,
    winRate: batch.winRate,
  }));
}

export function chronologicalDays(history: HistoryFile, currentBatches: BatchSummary[], pending: DayResult[]): DayResult[] {
  return [...history.games.flatMap((game) => game.batches.flatMap((batch) => batch.days)), ...currentBatches.flatMap((batch) => batch.days), ...pending];
}

export function combinedWinRate(batches: BatchSummary[]): number | null {
  const trades = batches.flatMap((batch) => batch.trades ?? []);
  if (trades.length) return trades.filter((trade) => trade.pnl > 0).length / trades.length;
  const rates = batches.map((batch) => batch.winRate).filter((rate): rate is number => rate !== null);
  if (!rates.length) return null;
  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

export function holdGap(batches: BatchSummary[], ending: number, start: number): number {
  const hold = batches.reduce((sum, batch) => sum + (batch.holdTqqq - batch.startEquity), 0);
  return ending - start - hold;
}

function batchImprovement(returns: number[]): number | null {
  if (returns.length < 2) return null;
  const size = returns.length >= 6 ? Math.min(5, returns.length) : Math.floor(returns.length / 2);
  const first = average(returns.slice(0, size));
  const last = average(returns.slice(-size));
  if (first === null || last === null) return null;
  return last - first;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export type HistorySummary = {
  games: number;
  batches: number;
  avgReturn: number | null;
  bestReturn: number | null;
  improvement: number | null;
  streak: number | null;
  /** Mean daily return across every day played, in every game. */
  avgDaily: number | null;
};

export function summarizeProgress(history: HistoryFile, currentBatches: BatchSummary[], pending: DayResult[], countCurrentGame: boolean): HistorySummary {
  const batches = [...history.games.flatMap((game) => completedBatches(game.batches)), ...completedBatches(currentBatches)];
  const returns = batches.map((batch) => (batch.startEquity ? batch.endEquity / batch.startEquity - 1 : 0));
  const days = chronologicalDays(history, currentBatches, pending);
  let streak = 0;
  for (let index = days.length - 1; index >= 0; index -= 1) {
    if (days[index].pct > 0) streak += 1;
    else break;
  }
  return {
    games: history.games.length + (countCurrentGame ? 1 : 0),
    batches: batches.length,
    avgReturn: average(returns),
    bestReturn: returns.length ? Math.max(...returns) : null,
    improvement: batchImprovement(returns),
    streak: days.length ? streak : null,
    avgDaily: average(days.map((day) => day.pct)),
  };
}

export type PracticeExport = {
  v: 1;
  exportedAt: string;
  history: HistoryFile;
  game: GameState | null;
  speed: Speed;
};

export function serializeExport(history: HistoryFile, game: GameState | null, speed: Speed): string {
  const payload: PracticeExport = { v: 1, exportedAt: new Date().toISOString(), history, game, speed };
  return JSON.stringify(payload);
}

export function parseExport(raw: string, dayCount: number): { history: HistoryFile; game: GameState | null; speed: Speed | null } | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PracticeExport> & Partial<HistoryFile>;
    if (!Array.isArray(parsed.games) && !parsed.history) return null;
    const history = parseHistory(JSON.stringify(Array.isArray(parsed.games) ? parsed : parsed.history));
    const speed = parsed.speed === undefined ? null : coerceSpeed(parsed.speed);
    const game = parsed.game ? loadGame(JSON.stringify(parsed.game), dayCount) : null;
    return { history, game, speed };
  } catch {
    return null;
  }
}

export type GameRow = {
  id: string;
  number: number;
  title: string;
  playedAt: string;
  batches: BatchSummary[];
  days: number;
  ending: number;
  start: number;
  returnPct: number;
  winRate: number | null;
  trades: number;
  fees: number;
  /** Null when the saved game predates slippage tracking. */
  slippage: number | null;
  vsHold: number;
  /** Mean of the daily returns across every day played in the game; null before the first day. */
  avgDaily: number | null;
};

export function deleteGame(history: HistoryFile, id: string): HistoryFile {
  return { v: 1, games: history.games.filter((game) => game.id !== id) };
}

export function deleteAllHistory(): HistoryFile {
  return emptyHistory();
}

/** Session dates already saved, including days finished in the game still on screen. */
export function playedDates(history: HistoryFile, game: GameState | null): string[] {
  const dates = new Set<string>();
  const take = (days: { date?: string }[] | undefined) => {
    for (const day of days ?? []) if (day?.date) dates.add(day.date);
  };
  for (const archived of history.games) for (const batch of archived.batches) take(batch.days);
  if (game) {
    for (const batch of game.history.batches) take(batch.days);
    take(game.batchDays);
  }
  return [...dates];
}

/** Mean daily return (each day's % change, averaged) across the given batches' days. */
export function avgDailyReturn(batches: BatchSummary[]): number | null {
  return average(batches.flatMap((batch) => batch.days.map((day) => day.pct)));
}

export function rowSlippage(batches: BatchSummary[]): number | null {
  if (batches.length === 0) return 0;
  if (batches.some((batch) => typeof batch.slippage !== "number")) return null;
  return batches.reduce((sum, batch) => sum + (batch.slippage ?? 0), 0);
}

export function rowFromGame(game: ArchivedGame, title = `Game ${game.number}`): GameRow {
  const trades = game.batches.reduce((sum, batch) => sum + (batch.trades?.length ?? 0), 0);
  return {
    id: game.id,
    number: game.number,
    title,
    playedAt: game.playedAt,
    batches: game.batches,
    days: game.batches.reduce((sum, batch) => sum + batch.days.length, 0),
    ending: game.endingBalance,
    start: game.startBalance,
    returnPct: game.startBalance ? game.endingBalance / game.startBalance - 1 : 0,
    winRate: combinedWinRate(game.batches),
    trades,
    fees: game.batches.reduce((sum, batch) => sum + (batch.fees || 0), 0),
    slippage: rowSlippage(game.batches),
    vsHold: holdGap(game.batches, game.endingBalance, game.startBalance),
    avgDaily: avgDailyReturn(game.batches),
  };
}
