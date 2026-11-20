import type { PracticeMarket } from "./practice-market";
import type { MinuteBar, Timeframe } from "./practice-path";
import {
  STARTING_CASH,
  accountValue,
  addLots,
  buyShares,
  closeLots,
  emptyPosition,
  mark,
  secFee,
  sellShares,
  type ClosedTrade,
  type Position,
  type Ticker,
} from "./practice-trade";

export type Speed = 1 | 5 | 15 | 60;
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
  day: number;
  seeds: number[];
  cursor: number;
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
  history: { batches: BatchSummary[]; equity: EquityPoint[] };
};

const LAST_MINUTE = 389;

export function newGame(dayCount: number, random: () => number = Math.random): GameState {
  const start = Math.max(0, dayCount - 5);
  return fresh(Math.floor(random() * (start + 1)), STARTING_CASH, { batches: [], equity: [{ label: "Start", value: STARTING_CASH }] }, random);
}

function fresh(batchStart: number, cash: number, history: GameState["history"], random: () => number): GameState {
  return {
    cash,
    positions: { TQQQ: emptyPosition(), SQQQ: emptyPosition() },
    batchStart,
    day: 0,
    seeds: [0, 1, 2, 3, 4].map(() => Math.floor(random() * 1_000_000_000)),
    cursor: 0,
    playing: false,
    speed: 1,
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
    history,
  };
}

export function loadGame(raw: string | null, dayCount: number): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed?.positions?.TQQQ || !parsed.positions.SQQQ || parsed.seeds?.length !== 5) return null;
    if (parsed.batchStart < 0 || parsed.batchStart + 4 >= dayCount) return null;
    if (parsed.cursor < 0 || parsed.cursor > LAST_MINUTE) return null;
    return { ...parsed, playing: false };
  } catch {
    return null;
  }
}

export function equityNow(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): number {
  return accountValue(state.cash, state.positions.TQQQ, state.positions.SQQQ, mark(tqqq, state.cursor), mark(sqqq, state.cursor));
}

function track(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[]): GameState {
  const value = equityNow(state, tqqq, sqqq);
  const peak = Math.max(state.dayPeak, value);
  const drop = peak > 0 ? (peak - value) / peak : 0;
  return { ...state, dayPeak: peak, dayDrawdown: Math.max(state.dayDrawdown, drop) };
}

export function trade(state: GameState, ticker: Ticker, side: "buy" | "sell", fraction: number, price: number): GameState {
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
  const fill = sellShares(held, price, fraction);
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

function liquidate(state: GameState, tqqqPrice: number, sqqqPrice: number): GameState {
  let next = state;
  if (next.positions.TQQQ.shares > 0) next = trade({ ...next, phase: "play" }, "TQQQ", "sell", 1, tqqqPrice);
  if (next.positions.SQQQ.shares > 0) next = trade({ ...next, phase: "play" }, "SQQQ", "sell", 1, sqqqPrice);
  return next;
}

function finishDay(state: GameState, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, holdTqqq: number): GameState {
  const flat = track(liquidate(state, mark(tqqq, state.cursor), mark(sqqq, state.cursor)), tqqq, sqqq);
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
  if (state.day < 4) {
    return { ...flat, phase: "day", playing: false, batchDays, history };
  }
  const summary = summarize(batchDays, flat.batchTrades, state.batchStartEquity, equity, flat.batchFees, holdTqqq);
  return { ...flat, phase: "batch", playing: false, batchDays, history: { equity: history.equity, batches: [...state.history.batches, summary] } };
}

function summarize(
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

export function holdTqqqValue(startEquity: number, open: number, close: number): number {
  if (!(open > 0) || !(close > 0)) return startEquity;
  const shares = Math.floor(startEquity / (open + 0.01));
  if (shares <= 0) return startEquity;
  const cash = startEquity - shares * open - shares * 0.01;
  const gross = shares * close;
  return cash + gross - shares * 0.01 - secFee(gross);
}

export function advance(state: GameState, steps: number, tqqq: MinuteBar[], sqqq: MinuteBar[], date: string, holdClose: number): GameState {
  if (state.phase !== "play" || state.cursor >= tqqq.length - 1) return state;
  let next = state;
  const last = tqqq.length - 1;
  for (let step = 0; step < steps && next.cursor < last && next.phase === "play"; step += 1) {
    next = track({ ...next, cursor: next.cursor + 1 }, tqqq, sqqq);
    if (next.cursor >= last) next = finishDay(next, tqqq, sqqq, date, holdClose);
  }
  return next;
}

export function nextDay(state: GameState): GameState {
  if (state.phase !== "day") return state;
  return {
    ...state,
    day: state.day + 1,
    cursor: 0,
    playing: false,
    phase: "play",
    dayStartEquity: state.cash,
    dayFees: 0,
    dayPeak: state.cash,
    dayDrawdown: 0,
    markers: [],
  };
}

export function nextBatch(state: GameState, dayCount: number, random: () => number = Math.random): GameState {
  const start = Math.max(0, dayCount - 5);
  return fresh(Math.floor(random() * (start + 1)), state.cash, state.history, random);
}
