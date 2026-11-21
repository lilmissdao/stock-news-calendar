import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };
/** One sub-tick per real second at 1x. A 1-minute candle takes 60 seconds to reach its close. */
export const SUBTICKS = 60;
/** 9:30–10:00 AM ET. Thirty real 1-minute bars. */
export const SESSION_MINUTES = 30;

type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barOf(tuple: Ohlc): { o: number; h: number; l: number; c: number } {
  const [o, h, l, c] = tuple;
  return { o, h: Math.max(h, o, c), l: Math.min(l, o, c), c };
}

function placeMinutes(bars: Ohlc[], start: number): MinuteBar[] {
  return bars.slice(0, SESSION_MINUTES).map((tuple, index) => {
    const bar = barOf(tuple);
    return { t: start + index * 60, o: bar.o, h: bar.h, l: bar.l, c: bar.c };
  });
}

/** The stored bars are already real 1-minute OHLC. The seed only shapes the live path inside each bar. */
export function buildSession(day: PracticeDay, _seed = 1): { TQQQ: MinuteBar[]; SQQQ: MinuteBar[] } {
  return { TQQQ: placeMinutes(day.tqqq, day.start), SQQQ: placeMinutes(day.sqqq, day.start) };
}

export function minuteSeed(daySeed: number, minute: number): number {
  return (daySeed + minute * 997) >>> 0;
}

export type PriceWindow = { from: number; to: number };

/** Visible price range for the candles on screen. A prior close from the other ticker is left out. */
export function priceWindow(bars: { h: number; l: number; o?: number; c?: number }[], priorClose: number | null): PriceWindow | null {
  if (!bars.length) return null;
  let high = Math.max(...bars.map((bar) => Math.max(bar.h, bar.o ?? bar.h, bar.c ?? bar.h)));
  let low = Math.min(...bars.map((bar) => Math.min(bar.l, bar.o ?? bar.l, bar.c ?? bar.l)));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  if (high < low) [high, low] = [low, high];
  const mid = (high + low) / 2 || Math.abs(high) || 1;
  if (priorClose !== null && Number.isFinite(priorClose) && Math.abs(priorClose - mid) / mid <= 0.04) {
    high = Math.max(high, priorClose);
    low = Math.min(low, priorClose);
  }
  const pad = Math.max((high - low) * 0.2, Math.abs(mid) * 0.004, 0.05);
  return { from: low - pad, to: high + pad };
}

export function candleInView(range: PriceWindow, time: { from: number; to: number }, bar: { h: number; l: number; c: number }, index: number): boolean {
  const priceOk = bar.l >= range.from - 1e-6 && bar.h <= range.to + 1e-6 && bar.c >= range.from && bar.c <= range.to;
  const timeOk = index >= time.from - 1e-6 && index <= time.to + 1e-6;
  return priceOk && timeOk;
}

/** True when the chart must call setData. A ticker switch keeps the same timestamps, so it is not an in-place update of the last bar. */
export function seriesNeedsReset(previousId: string | null, nextId: string, previous: MinuteBar[] | null, next: MinuteBar[]): boolean {
  if (previousId !== nextId || !previous || previous.length !== next.length || next.length === 0) return true;
  for (let i = 0; i < previous.length - 1; i += 1) {
    const before = previous[i];
    const after = next[i];
    if (before.t !== after.t || before.o !== after.o || before.h !== after.h || before.l !== after.l || before.c !== after.c) return true;
  }
  return previous[previous.length - 1].t !== next[next.length - 1].t;
}

/** Completed minutes in the 9:30–10:00 window, plus the candle that is still forming. */
export function chartBars(
  minutes: MinuteBar[],
  cursor: number,
  tick: number,
  daySeed: number,
  sign: number,
  timeframe: Timeframe,
  daily: MinuteBar | null = null,
): MinuteBar[] {
  if (timeframe === "1D" && daily) return [{ ...daily }];
  if (minutes.length === 0) return [];
  const last = Math.min(minutes.length, SESSION_MINUTES) - 1;
  const minute = Math.max(0, Math.min(cursor, last));
  const formed = Math.max(0, Math.min(tick, SUBTICKS));
  const completeThrough = formed >= SUBTICKS ? minute : minute - 1;
  const bars = minutes.slice(0, Math.max(0, completeThrough + 1));
  if (formed < SUBTICKS) {
    const bar = minutes[minute];
    bars.push(formingBar(bar, subpath(bar, minuteSeed(daySeed, minute), sign), formed));
  }
  return aggregate(bars, timeframe, bars.length);
}

export function aggregate(minutes: MinuteBar[], timeframe: Timeframe, revealed: number): MinuteBar[] {
  const visible = minutes.slice(0, Math.max(0, revealed));
  const size = timeframe === "1D" ? Math.max(visible.length, 1) : FRAME_MINUTES[timeframe];
  const bars: MinuteBar[] = [];
  for (let i = 0; i < visible.length; i += size) {
    const slice = visible.slice(i, i + size);
    if (slice.length === 0) continue;
    bars.push({
      t: slice[0].t,
      o: slice[0].o,
      h: Math.max(...slice.map((bar) => bar.h)),
      l: Math.min(...slice.map((bar) => bar.l)),
      c: slice[slice.length - 1].c,
    });
  }
  return bars;
}

export type SharedTape = { unit: number[]; hi: number; lo: number };

/** Small deviations around the open-to-close line. SQQQ mirrors the same tape. */
export function sharedTape(seed: number): SharedTape {
  const rng = mulberry32(seed >>> 0);
  const count = SUBTICKS;
  const unit = [0];
  for (let i = 1; i < count; i += 1) {
    const pull = -unit[i - 1] * 0.15;
    const step = (rng() - 0.5) * 0.22 + pull;
    unit.push(Math.max(-1, Math.min(1, unit[i - 1] + step)));
  }
  unit.push(0);
  let hi = 8 + Math.floor(rng() * (count - 16));
  let lo = 8 + Math.floor(rng() * (count - 16));
  if (Math.abs(hi - lo) < 10) lo = hi + 12 < count - 6 ? hi + 12 : hi - 12;
  if (lo === hi) lo = hi > 10 ? hi - 8 : hi + 8;
  return { unit, hi, lo };
}

function approach(points: number[], at: number, target: number, low: number, high: number) {
  const radius = 4;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = at + offset;
    if (index <= 0 || index >= points.length - 1) continue;
    const weight = 1 - Math.abs(offset) / (radius + 1);
    const next = points[index] + (target - points[index]) * weight;
    points[index] = Math.min(high, Math.max(low, next));
  }
  if (at > 0 && at < points.length - 1) points[at] = Math.min(high, Math.max(low, target));
}

/** Prices inside one 1-minute candle. Sign −1 mirrors the shared tape. */
export function subpath(bar: MinuteBar, seed: number, sign = 1): number[] {
  const tape = sharedTape(seed);
  const count = SUBTICKS;
  const span = Math.max(bar.h - bar.l, 0);
  const openU = span > 0 ? (bar.o - bar.l) / span : 0;
  const closeU = span > 0 ? (bar.c - bar.l) / span : 0;
  const points = tape.unit.map((unit, index) => {
    if (index === 0) return bar.o;
    if (index === count) return bar.c;
    const base = openU + (closeU - openU) * (index / count);
    const swung = base + (sign < 0 ? -unit : unit) * 0.22;
    const placed = Math.min(1, Math.max(0, swung));
    return bar.l + placed * span;
  });
  const highAt = sign < 0 ? tape.lo : tape.hi;
  const lowAt = sign < 0 ? tape.hi : tape.lo;
  approach(points, lowAt, bar.l, bar.l, bar.h);
  approach(points, highAt, bar.h, bar.l, bar.h);
  points[0] = bar.o;
  points[count] = bar.c;
  return points;
}

export function formingBar(bar: MinuteBar, path: number[], tick: number): MinuteBar {
  const index = Math.max(0, Math.min(tick, path.length - 1));
  const seen = path.slice(0, index + 1);
  return { t: bar.t, o: bar.o, c: path[index], h: Math.max(...seen), l: Math.min(...seen) };
}

export function avgCostLabel(kind: "tqqq" | "sqqq", avg: number): string {
  const text = avg.toFixed(2);
  return kind === "sqqq" ? `SQQQ avg ${text}` : `Avg ${text}`;
}

/**
 * TQQQ price at which SQQQ would be back at `sqqqAvg`.
 * Percent moves are treated as opposite, measured from the two prices at this fill.
 * A level more than 20% from that TQQQ price would sit off the candle window, so it is left for an overlay.
 */
export function sqqqBreakevenTqqq(tqqqNow: number, sqqqNow: number, sqqqAvg: number): number | null {
  if (!(tqqqNow > 0) || !(sqqqNow > 0) || !(sqqqAvg > 0)) return null;
  const level = tqqqNow * (2 - sqqqAvg / sqqqNow);
  if (!Number.isFinite(level) || level <= 0) return null;
  if (Math.abs(level - tqqqNow) / tqqqNow > 0.2) return null;
  return level;
}

export function clock(unix: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}
