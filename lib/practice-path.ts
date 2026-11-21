import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };
/**
 * Sub-ticks inside one minute. About 2 a second at 1x, on an irregular cadence.
 * Tick 0 is the open. Tick SUBTICKS is the close. A full minute is 60 real seconds at 1x.
 */
export const SUBTICKS = 120;
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

function candleBounds(bars: { h: number; l: number; o?: number; c?: number }[]): { high: number; low: number } | null {
  if (!bars.length) return null;
  let high = Math.max(...bars.map((bar) => Math.max(bar.h, bar.o ?? bar.h, bar.c ?? bar.h)));
  let low = Math.min(...bars.map((bar) => Math.min(bar.l, bar.o ?? bar.l, bar.c ?? bar.l)));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  if (high < low) [high, low] = [low, high];
  return { high, low };
}

/** An average-cost line is drawn only when it sits near the candles. Farther lines use the overlay label. */
export function keepAnchor(bars: { h: number; l: number; o?: number; c?: number }[], price: number): boolean {
  const bounds = candleBounds(bars);
  if (!bounds || !Number.isFinite(price)) return false;
  const span = Math.max(bounds.high - bounds.low, 0.05);
  const room = span * 0.5;
  return price >= bounds.low - room && price <= bounds.high + room;
}

/** Visible price range. A far prior close is left out. Nearby anchors, such as average-cost lines, are kept. */
export function priceWindow(
  bars: { h: number; l: number; o?: number; c?: number }[],
  priorClose: number | null,
  anchors: number[] = [],
): PriceWindow | null {
  const bounds = candleBounds(bars);
  if (!bounds) return null;
  let { high, low } = bounds;
  const mid = (high + low) / 2 || Math.abs(high) || 1;
  if (priorClose !== null && Number.isFinite(priorClose) && Math.abs(priorClose - mid) / mid <= 0.04) {
    high = Math.max(high, priorClose);
    low = Math.min(low, priorClose);
  }
  for (const price of anchors) {
    if (keepAnchor(bars, price)) {
      high = Math.max(high, price);
      low = Math.min(low, price);
    }
  }
  const pad = Math.max((high - low) * 0.12, 0.02);
  return { from: low - pad, to: high + pad };
}

/**
 * Logical range for the candles that exist so far.
 * One candle is centered and capped at about 48px wide. More candles zoom out just enough to keep all of them,
 * with the latest bar a little in from the right.
 */
export function progressiveRange(count: number, plotWidth: number): { from: number; to: number } {
  const last = Math.max(0, count - 1);
  const width = Math.max(plotWidth, 160);
  const maxSpacing = 48;
  const minSlots = Math.max(width / maxSpacing, 5);
  const rightPad = 1.5;
  if (count <= 1) {
    const half = minSlots / 2;
    return { from: -half, to: half };
  }
  const natural = last + rightPad + 0.6;
  if (natural >= minSlots) return { from: -0.6, to: last + rightPad };
  return { from: last + rightPad - minSlots, to: last + rightPad };
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

export type SharedTape = { hi: number; lo: number };

type TapePlan = { early: number; late: number; sharpFlip: boolean };

const plans = new Map<number, TapePlan>();
const paths = new Map<string, number[]>();

function planOf(seed: number): TapePlan {
  const key = seed >>> 0;
  const cached = plans.get(key);
  if (cached) return cached;
  const rng = mulberry32(key);
  const n = SUBTICKS;
  const early = 10 + Math.floor(rng() * Math.floor(n * 0.28));
  let late = Math.floor(n * 0.46) + Math.floor(rng() * Math.floor(n * 0.28));
  if (late - early < 14) late = Math.min(n - 16, early + 14);
  const sharpFlip = rng() < 0.16;
  const plan = { early, late, sharpFlip };
  plans.set(key, plan);
  return plan;
}

function extremes(plan: TapePlan, low: number, high: number, open: number): { hi: number; lo: number } {
  let lowFirst = Math.abs(open - low) <= Math.abs(open - high);
  if (plan.sharpFlip) lowFirst = !lowFirst;
  return { lo: lowFirst ? plan.early : plan.late, hi: lowFirst ? plan.late : plan.early };
}

/** Where this tape tags the high and the low when the open is nearer the low. */
export function sharedTape(seed: number): SharedTape {
  return extremes(planOf(seed), 0, 1, 0);
}

function cents(price: number, low: number, high: number): number {
  const next = Math.round(price * 100) / 100;
  if (next < low) return low;
  if (next > high) return high;
  return next;
}

/** Walk from one anchor to the next in small steps. Only the last print sits on the anchor. */
function fillSegment(points: number[], from: number, to: number, start: number, end: number, low: number, high: number) {
  const steps = to - from;
  if (steps <= 0) {
    points[to] = end;
    return;
  }
  const dir = Math.sign(end - start) || 1;
  let prev = start;
  let held = 0;
  for (let k = 1; k <= steps; k += 1) {
    if (k === steps) {
      points[to] = end;
      continue;
    }
    let price = cents(start + (end - start) * (k / steps), low, high);
    if (Math.abs(price - end) < 0.009) price = cents(end - dir * 0.01, low, high);
    if (!moved(prev, price)) {
      held += 1;
      if (held >= 3) {
        let breath = cents(prev + dir * 0.01, low, high);
        if (Math.abs(breath - prev) < 0.004) breath = cents(prev - dir * 0.01, low, high);
        if (Math.abs(breath - prev) >= 0.004) {
          price = breath;
          held = 0;
        }
      }
    } else held = 0;
    points[from + k] = price;
    prev = price;
  }
  points[to] = end;
}

function moved(left: number, right: number): boolean {
  return Math.abs(right - left) >= 0.0095;
}

/** Nudge a repeated print one cent toward the next anchor, without flipping direction. */
function settle(points: number[], pins: Set<number>, low: number, high: number) {
  for (let i = 1; i < points.length; i += 1) {
    if (pins.has(i) || moved(points[i - 1], points[i])) continue;
    const next = pins.has(i + 1) || i + 1 >= points.length ? points[i] : points[i + 1];
    const dir = Math.sign(next - points[i - 1]);
    if (dir === 0) continue;
    const nudged = cents(points[i - 1] + dir * 0.01, low, high);
    if (moved(points[i - 1], nudged)) points[i] = nudged;
  }
}

/**
 * Prices inside one real 1-minute bar.
 * Most bars travel from the open to the nearer extreme, then the other, then the close.
 * About one bar in eight runs to the far extreme first. SQQQ uses its own inverse bar, so it moves against TQQQ.
 */
export function subpath(bar: MinuteBar, seed: number, _sign = 1): number[] {
  const key = `${seed >>> 0}:${bar.o}:${bar.h}:${bar.l}:${bar.c}`;
  const hit = paths.get(key);
  if (hit) return hit;
  const points = makePath(bar, seed);
  if (paths.size > 48) paths.delete(paths.keys().next().value as string);
  paths.set(key, points);
  return points;
}

function makePath(bar: MinuteBar, seed: number): number[] {
  const n = SUBTICKS;
  const low = Math.min(bar.l, bar.o, bar.c);
  const high = Math.max(bar.h, bar.o, bar.c);
  const span = high - low;
  const points = new Array<number>(n + 1).fill(bar.o);
  points[n] = bar.c;
  if (!(span >= 0.02)) return points;
  const plan = planOf(seed);
  let { hi, lo } = extremes(plan, low, high, bar.o);
  if (Math.abs(bar.o - low) < 1e-6) lo = 0;
  if (Math.abs(bar.o - high) < 1e-6) hi = 0;
  const anchors = [
    { t: 0, p: bar.o },
    { t: lo, p: low },
    { t: hi, p: high },
    { t: n, p: bar.c },
  ].sort((a, b) => a.t - b.t || a.p - b.p);
  points[0] = bar.o;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const from = anchors[i];
    const to = anchors[i + 1];
    if (to.t <= from.t) continue;
    fillSegment(points, from.t, to.t, points[from.t] ?? from.p, to.p, low, high);
  }
  points[0] = bar.o;
  points[lo] = low;
  points[hi] = high;
  points[n] = bar.c;
  if (!moved(points[0], points[1])) {
    const next = anchors.find((anchor) => anchor.t > 0);
    const dir = Math.sign((next?.p ?? points[0]) - points[0]) || 1;
    const nudged = cents(points[0] + dir * 0.01, low, high);
    if (moved(points[0], nudged)) points[1] = nudged;
  }
  settle(points, new Set([0, n, hi, lo]), low, high);
  points[0] = bar.o;
  points[lo] = low;
  points[hi] = high;
  points[n] = bar.c;
  return points;
}

export function formingBar(bar: MinuteBar, path: number[], tick: number): MinuteBar {
  const index = Math.max(0, Math.min(tick, path.length - 1));
  let high = path[0];
  let low = path[0];
  for (let i = 1; i <= index; i += 1) {
    if (path[i] > high) high = path[i];
    if (path[i] < low) low = path[i];
  }
  return { t: bar.t, o: bar.o, c: path[index], h: high, l: low };
}

export function avgCostLabel(kind: "tqqq" | "sqqq", avg: number): string {
  const text = avg.toFixed(2);
  return kind === "sqqq" ? `SQQQ ${text}` : `TQQQ ${text}`;
}

/** True when a price-scale tag has room beside the prices already labeled there. */
export function axisLabelFits(price: number, occupied: number[], span: number, plotHeight: number): boolean {
  if (!Number.isFinite(price) || !(span > 0) || !(plotHeight > 0)) return true;
  const gap = (22 / plotHeight) * span;
  return occupied.every((other) => !Number.isFinite(other) || Math.abs(other - price) >= gap);
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
