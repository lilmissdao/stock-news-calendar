import { minuteSeed, SESSION_MINUTES, SUBTICKS, subpath, type MinuteBar, type Timeframe } from "./practice-path";
import {
  STARTING_CASH,
  accountValue,
  addLots,
  buyShares,
  closeLots,
  emptyPosition,
  sellFees,
  sellShares,
  type ClosedTrade,
  type Position,
  type Ticker,
} from "./practice-trade";

export type Speed = 1 | 2 | 5 | 15;
export const SPEEDS: Speed[] = [1, 2, 5, 15];
const CANDLE_MS = 60_000;

/** Milliseconds between live sub-ticks. 1x is one sub-tick per second. */
export function tickMs(speed: Speed): number {
  return Math.round(CANDLE_MS / speed / SUBTICKS);
}

/** How many sub-ticks belong in this much real time. */
export function ticksDue(elapsedMs: number, speed: Speed): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.floor(elapsedMs / tickMs(speed));
}

/** Time left until the forming candle reaches its close. */
export function minuteLeft(tick: number, speed: Speed): string {
  const clamped = Math.max(0, Math.min(SUBTICKS, tick));
  const seconds = Math.round(((SUBTICKS - clamped) * 60) / speed / SUBTICKS);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")} left in this minute`;
}
export type Phase = "play" | "day" | "batch";
export type Marker = { minute: number; ticker: Ticker; side: "buy" | "sell" };
export type DayResult = { date: string; dollars: number; pct: number; equity: number; drawdown: number; fees: number };
export type BatchSummary = {
  startDate: string;
  endDate: string;
  days: DayResult[];
  trades: ClosedTrade[];
  fees: number;
  startEquity: number;
  endEquity: number;
  holdTqqq: number;
  winRate: number | null;
  best: number | null;
  worst: number | null;
  avgHold: number | null;
  maxDrawdown: number;
};
export type EquityPoint = { label: string; value: number };

export type GameState = {
  cash: number;
  positions: Record<Ticker, Position>;
  batchStart: number;
  /** Index into the session book for the day on screen. */
  session: number;
  day: number;
  seeds: number[];
  cursor: number;
  /** 0–60. 60 means the current minute has reached its close. */
  tick: number;
  startedAt: string;
  playing: boolean;
  speed: Speed;
  timeframe: Timeframe;
  ticker: Ticker;
  phase: Phase;
  dayStartEquity: number;
  dayFees: number;
  dayPeak: number;
  dayDrawdown: number;
  markers: Marker[];
  batchTrades: ClosedTrade[];
  batchDays: DayResult[];
  batchFees: number;
  batchStartEquity: number;
  /** How many sessions are in this batch. Five, or fewer at the end of the book. */
  batchDaysTotal: number;
  /** Hold-TQQQ value for the whole batch, filled in when a day ends. */
  batchHold: number;
  history: { batches: BatchSummary[]; equity: EquityPoint[] };
};

const LAST_MINUTE = SESSION_MINUTES - 1;
export const BATCH_LENGTH = 5;

export function batchLength(dayCount: number, batchStart: number): number {
  if (dayCount <= 0) return 1;
  const start = Math.max(0, Math.min(dayCount - 1, Math.floor(batchStart)));
  return Math.max(1, Math.min(BATCH_LENGTH, dayCount - start));
}

/** An unplayed session when any remain, otherwise any session in the book. */
export function pickSession(dayCount: number, blocked: Iterable<number>, random: () => number): number {
  if (dayCount <= 0) return 0;
  const skip = new Set<number>();
  for (const value of blocked) {
    const index = Math.floor(value);
    if (index >= 0 && index < dayCount) skip.add(index);
  }
  const open: number[] = [];
  for (let index = 0; index < dayCount; index += 1) if (!skip.has(index)) open.push(index);
  const pool = open.length > 0 ? open : Array.from({ length: dayCount }, (_, index) => index);
  const choice = Math.floor(random() * pool.length);
  return pool[Math.max(0, Math.min(pool.length - 1, choice))];
}

export function newGame(dayCount: number, random: () => number = Math.random, speed: Speed = 1, played: number[] = []): GameState {
  return fresh(pickSession(dayCount, played, random), STARTING_CASH, { batches: [], equity: [{ label: "Start", value: STARTING_CASH }] }, random, speed, dayCount);
}

export function coerceSpeed(value: unknown): Speed {
  const speed = Number(value);
  if (speed === 60) return 15;
  return (SPEEDS as number[]).includes(speed) ? (speed as Speed) : 1;
}

function fresh(batchStart: number, cash: number, history: GameState["history"], random: () => number, speed: Speed, dayCount: number): GameState {
  return {
    cash,
    positions: { TQQQ: emptyPosition(), SQQQ: emptyPosition() },
    batchStart,
    session: batchStart,
    day: 0,
    seeds: [0, 1, 2, 3, 4].map(() => Math.floor(random() * 1_000_000_000)),
    cursor: 0,
    tick: 0,
    startedAt: new Date().toISOString(),
    playing: false,
    speed,
    timeframe: "1m",
    ticker: "TQQQ",
    phase: "play",
    dayStartEquity: cash,
    dayFees: 0,
    dayPeak: cash,
    dayDrawdown: 0,
    markers: [],
    batchTrades: [],
    batchDays: [],
    batchFees: 0,
    batchStartEquity: cash,
    batchDaysTotal: Math.max(1, Math.min(BATCH_LENGTH, dayCount)),
    batchHold: 0,
    history,
  };
}

export function loadGame(raw: string | null, dayCount: number): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed?.positions?.TQQQ || !parsed.positions.SQQQ || parsed.seeds?.length !== 5) return null;
    if (parsed.batchStart < 0 || parsed.batchStart >= dayCount) return null;
    if (parsed.cursor < 0) return null;
    // Older saves have no sub-tick, or a cursor from the full 6.5-hour day.
    // Those playheads sit on a finished candle or past 10:00, so Play appears to do nothing.
    const legacy = typeof parsed.tick !== "number" || parsed.cursor > LAST_MINUTE;
    let cursor = legacy ? 0 : parsed.cursor;
    let tick = legacy ? 0 : parsed.tick;
    tick = Math.max(0, Math.min(SUBTICKS, Math.round(tick)));
    const startedAt = parsed.startedAt || parsed.history?.batches?.[0]?.startDate || new Date().toISOString();
    const savedSession = Number((parsed as GameState).session);
    const hasSession = Number.isInteger(savedSession) && savedSession >= 0 && savedSession < dayCount;
    const room = hasSession ? Math.max(1, Math.min(BATCH_LENGTH, dayCount)) : batchLength(dayCount, parsed.batchStart);
    const savedLength = Number(parsed.batchDaysTotal);
    const batchDaysTotal = savedLength >= 1 && savedLength <= room ? savedLength : room;
    const legacySession = parsed.batchStart + (Number.isFinite(parsed.day) ? parsed.day : 0);
    const session = hasSession ? savedSession : Math.max(0, Math.min(dayCount - 1, legacySession));
    return {
      ...parsed,
      cursor,
      tick,
      speed: coerceSpeed(parsed.speed),
      startedAt,
      playing: false,
      session,
      batchDaysTotal,
      batchHold: Number.isFinite(parsed.batchHold) ? parsed.batchHold : 0,
    };
  } catch {
    return null;
  }
}

function livePrices(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): { t: number; s: number } {
  const last = Math.max(0, Math.min(tqqq.length, SESSION_MINUTES) - 1);
  const minute = Math.max(0, Math.min(state.cursor, last));
  const tick = Math.max(0, Math.min(state.tick, SUBTICKS));
  const tBar = tqqq[minute];
  const sBar = sqqq[minute];
  if (!tBar || !sBar) return { t: 0, s: 0 };
  const seed = minuteSeed(state.seeds[state.day] || 1, minute);
  return { t: subpath(tBar, seed, 1)[tick], s: subpath(sBar, seed, -1)[tick] };
}

export function liveQuote(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): { TQQQ: number; SQQQ: number } {
  const prices = livePrices(state, tqqq, sqqq);
  return { TQQQ: prices.t, SQQQ: prices.s };
}

export function equityNow(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): number {
  const prices = livePrices(state, tqqq, sqqq);
  return accountValue(state.cash, state.positions.TQQQ, state.positions.SQQQ, prices.t, prices.s);
}

function track(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): GameState {
  const value = equityNow(state, tqqq, sqqq);
  const peak = Math.max(state.dayPeak, value);
  const drop = peak > 0 ? (peak - value) / peak : 0;
  return { ...state, dayPeak: peak, dayDrawdown: Math.max(state.dayDrawdown, drop) };
}

export function trade(state: GameState, ticker: Ticker, side: "buy" | "sell", fraction: number, price: number, date = ""): GameState {
  if (state.phase !== "play" || !(price > 0)) return state;
  if (side === "buy") {
    const fill = buyShares(state.cash, price, fraction);
    if (fill.shares <= 0) return state;
    return {
      ...state,
      cash: fill.cash,
      dayFees: state.dayFees + fill.fee,
      batchFees: state.batchFees + fill.fee,
      positions: { ...state.positions, [ticker]: addLots(state.positions[ticker], fill.shares, price, state.cursor) },
      markers: [...state.markers, { minute: state.cursor, ticker, side: "buy" }],
    };
  }
  const held = state.positions[ticker].shares;
  const fill = sellShares(held, price, fraction, date);
  if (fill.shares <= 0) return state;
  const closed = closeLots(state.positions[ticker], fill.shares, price, state.cursor, ticker, fill.fee);
  return {
    ...state,
    cash: state.cash + fill.proceeds,
    dayFees: state.dayFees + fill.fee,
    batchFees: state.batchFees + fill.fee,
    positions: { ...state.positions, [ticker]: closed.position },
    batchTrades: [...state.batchTrades, ...closed.trades],
    markers: [...state.markers, { minute: state.cursor, ticker, side: "sell" }],
  };
}

function liquidate(state: GameState, tqqqPrice: number, sqqqPrice: number, date: string): GameState {
  let next = state;
  if (next.positions.TQQQ.shares > 0) next = trade({ ...next, phase: "play" }, "TQQQ", "sell", 1, tqqqPrice, date);
  if (next.positions.SQQQ.shares > 0) next = trade({ ...next, phase: "play" }, "SQQQ", "sell", 1, sqqqPrice, date);
  return next;
}

function finishDay(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, holdTqqq: number): GameState {
  const prices = livePrices(state, tqqq, sqqq);
  const flat = track(liquidate(state, prices.t, prices.s, date), tqqq, sqqq);
  const equity = flat.cash;
  const result: DayResult = {
    date,
    dollars: equity - state.dayStartEquity,
    pct: state.dayStartEquity > 0 ? equity / state.dayStartEquity - 1 : 0,
    equity,
    drawdown: flat.dayDrawdown,
    fees: flat.dayFees,
  };
  const batchDays = [...state.batchDays, result];
  const history = { ...state.history, equity: [...state.history.equity, { label: date, value: equity }] };
  return { ...flat, phase: "day", playing: false, batchDays, history, batchHold: holdTqqq };
}

export function summarizeBatch(
  days: DayResult[],
  trades: ClosedTrade[],
  startEquity: number,
  endEquity: number,
  fees: number,
  holdTqqq: number,
): BatchSummary {
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const pnls = trades.map((trade) => trade.pnl);
  const holds = trades.map((trade) => trade.exitMinute - trade.entryMinute);
  return {
    startDate: days[0]?.date ?? "",
    endDate: days[days.length - 1]?.date ?? "",
    days,
    trades,
    fees,
    startEquity,
    endEquity,
    holdTqqq,
    winRate: trades.length ? wins / trades.length : null,
    best: pnls.length ? Math.max(...pnls) : null,
    worst: pnls.length ? Math.min(...pnls) : null,
    avgHold: holds.length ? holds.reduce((sum, value) => sum + value, 0) / holds.length : null,
    maxDrawdown: Math.max(0, ...days.map((day) => day.drawdown)),
  };
}

export function sessionHoldValue(startEquity: number, windows: { open: number; close: number; date?: string }[]): number {
  return windows.reduce((equity, window) => holdTqqqValue(equity, window.open, window.close, window.date ?? ""), startEquity);
}

/** Buy the open and sell the close at those exact prices. The sell pays Robinhood's regulatory fees. */
export function holdTqqqValue(startEquity: number, open: number, close: number, date = ""): number {
  if (!(open > 0) || !(close > 0)) return startEquity;
  const shares = Math.floor(startEquity / open);
  if (shares <= 0) return startEquity;
  const cash = startEquity - shares * open;
  return cash + shares * close - sellFees(shares, close, date);
}

export function tickForward(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, hold: number): GameState {
  if (state.phase !== "play" || tqqq.length === 0) return state;
  const last = Math.min(tqqq.length, SESSION_MINUTES) - 1;
  const cursor = Math.min(state.cursor, last);
  if (state.tick < SUBTICKS) {
    const next = track({ ...state, cursor, tick: state.tick + 1 }, tqqq, sqqq);
    if (next.cursor >= last && next.tick >= SUBTICKS) return finishDay(next, tqqq, sqqq, date, hold);
    return next;
  }
  if (cursor >= last) return finishDay({ ...state, cursor, tick: SUBTICKS }, tqqq, sqqq, date, hold);
  return track({ ...state, cursor: cursor + 1, tick: 0 }, tqqq, sqqq);
}

export function stepMinute(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, hold: number): GameState {
  if (state.phase !== "play" || tqqq.length === 0) return state;
  const last = Math.min(tqqq.length, SESSION_MINUTES) - 1;
  const cursor = Math.min(state.cursor, last);
  if (state.tick < SUBTICKS) {
    const done = track({ ...state, cursor, tick: SUBTICKS }, tqqq, sqqq);
    if (done.cursor >= last) return finishDay(done, tqqq, sqqq, date, hold);
    return done;
  }
  if (cursor >= last) return finishDay({ ...state, cursor, tick: SUBTICKS }, tqqq, sqqq, date, hold);
  const done = track({ ...state, cursor: cursor + 1, tick: SUBTICKS }, tqqq, sqqq);
  if (done.cursor >= last) return finishDay(done, tqqq, sqqq, date, hold);
  return done;
}

export function fastForward(state: GameState, steps: number, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, hold: number): GameState {
  let next = state;
  const cap = Math.max(0, Math.min(Math.floor(steps), 8000));
  for (let step = 0; step < cap && next.phase === "play"; step += 1) next = tickForward(next, tqqq, sqqq, date, hold);
  return next;
}

export function advance(state: GameState, steps: number, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, hold: number): GameState {
  let next = state;
  for (let step = 0; step < steps && next.phase === "play"; step += 1) next = stepMinute(next, tqqq, sqqq, date, hold);
  return next;
}

function closeBatch(state: GameState): GameState {
  if (state.phase === "batch") return state;
  const equity = state.batchDays.length ? state.batchDays[state.batchDays.length - 1].equity : state.cash;
  const summary = summarizeBatch(state.batchDays, state.batchTrades, state.batchStartEquity, equity, state.batchFees, state.batchHold);
  return {
    ...state,
    phase: "batch",
    playing: false,
    history: { equity: state.history.equity, batches: [...state.history.batches, summary] },
  };
}

function resetDay(state: GameState, session: number, day: number): GameState {
  return {
    ...state,
    session,
    day,
    cursor: 0,
    tick: 0,
    playing: false,
    phase: "play",
    dayStartEquity: state.cash,
    dayFees: 0,
    dayPeak: state.cash,
    dayDrawdown: 0,
    markers: [],
  };
}

/** Leave the day review for a random session. The fifth day records the batch, then continues. */
export function nextDay(state: GameState, dayCount: number, played: number[] = [], random: () => number = Math.random): GameState {
  if (state.phase === "batch") return nextBatch(state, dayCount, played, random);
  if (state.phase !== "day") return state;
  if (state.day + 1 < state.batchDaysTotal) return resetDay(state, pickSession(dayCount, played, random), state.day + 1);
  const closed = closeBatch(state);
  const advanced = nextBatch(closed, dayCount, played, random);
  return advanced === closed ? closed : advanced;
}

/** Open the five-day review without leaving the book. */
export function openBatchReview(state: GameState): GameState {
  if (state.phase !== "day" || state.day + 1 < state.batchDaysTotal) return state;
  return closeBatch(state);
}

export function nextBatch(state: GameState, dayCount: number, played: number[] = [], random: () => number = Math.random): GameState {
  if (state.phase !== "batch" || dayCount <= 0) return state;
  const game = fresh(pickSession(dayCount, played, random), state.cash, state.history, random, state.speed, dayCount);
  return { ...game, startedAt: state.startedAt, ticker: state.ticker, timeframe: state.timeframe };
}
