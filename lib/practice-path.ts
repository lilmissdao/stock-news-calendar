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

type TapePlan = {
  /** Tick where the first wick is tagged. */
  early: number;
  /** Tick where the second wick is tagged. */
  late: number;
  /** Small-bodied bars only: take the far wick first. */
  sharpFlip: boolean;
  /** Pullback shape inside each leg, shared by TQQQ and SQQQ so they wiggle against each other. */
  wiggle: { m: number; a: number }[][];
  /** How bunched up each leg's travel is. 0 is even speed, 1 is fast in the middle. */
  ease: number[];
};

const plans = new Map<number, TapePlan>();
const paths = new Map<string, number[]>();

function planOf(seed: number): TapePlan {
  const key = seed >>> 0;
  const cached = plans.get(key);
  if (cached) return cached;
  const rng = mulberry32(key);
  const n = SUBTICKS;
  // Most of a real minute's range prints early. The first wick lands in the first ~30%, the second by ~75%.
  const early = 8 + Math.floor(rng() * Math.floor(n * 0.24));
  let late = Math.floor(n * 0.42) + Math.floor(rng() * Math.floor(n * 0.32));
  if (late - early < 16) late = Math.min(n - 16, early + 16);
  const sharpFlip = rng() < 0.1;
  const wiggle = [0, 1, 2].map(() => {
    const count = 1 + Math.floor(rng() * 2);
    return Array.from({ length: count }, () => ({ m: 2 + Math.floor(rng() * 3), a: (rng() * 2 - 1) * (0.6 + rng() * 0.4) }));
  });
  const ease = [0, 1, 2].map(() => 0.3 + rng() * 0.6);
  const plan = { early, late, sharpFlip, wiggle, ease };
  plans.set(key, plan);
  return plan;
}

/**
 * Which wick prints first.
 * A green bar usually dips into its lower wick, runs up through the body into the upper wick, then settles at the close.
 * A red bar is the mirror. A near-doji goes to whichever wick is closer to the open.
 * Only bars with a small body sometimes take the far wick first; a strong body never does.
 */
function lowFirstOf(plan: TapePlan, open: number, high: number, low: number, close: number): boolean {
  const span = high - low;
  const body = close - open;
  let lowFirst: boolean;
  if (span > 0 && Math.abs(body) >= span * 0.08) lowFirst = body > 0;
  else lowFirst = Math.abs(open - low) <= Math.abs(open - high);
  if (plan.sharpFlip && span > 0 && Math.abs(body) < span * 0.3) lowFirst = !lowFirst;
  return lowFirst;
}

/** Where this tape tags the high and the low on a bar that takes its low first, such as a strong green bar. */
export function sharedTape(seed: number): SharedTape {
  const plan = planOf(seed);
  return { lo: plan.early, hi: plan.late };
}

function cents(price: number, low: number, high: number): number {
  const next = Math.round(price * 100) / 100;
  if (next < low) return low;
  if (next > high) return high;
  return next;
}

function moved(left: number, right: number): boolean {
  return Math.abs(right - left) >= 0.0095;
}

/** Keep a price on one side of the open, so the body only changes color where the path really crosses it. */
function onSide(price: number, side: number, open: number, low: number, high: number): number {
  if (side > 0 && price <= open) return Math.min(high, open + 0.01);
  if (side < 0 && price >= open) return Math.max(low, open - 0.01);
  return price;
}

function sideOf(price: number, open: number): number {
  if (price > open + 1e-9) return 1;
  if (price < open - 1e-9) return -1;
  return 0;
}

/** Monotone 0→1 time warp. Higher `ease` moves faster mid-leg and slower near the anchors. */
function warp(u: number, ease: number): number {
  const s = u * u * (3 - 2 * u);
  return (1 - ease) * u + ease * s;
}

/**
 * One leg between two anchors. It drifts toward the target with a couple of shallow pullbacks,
 * never crosses the open more than once, and only lands on the target at the last print.
 */
function fillLeg(
  points: number[],
  from: number,
  to: number,
  start: number,
  end: number,
  bar: { open: number; low: number; high: number },
  plan: TapePlan,
  leg: number,
  sign: number,
) {
  const steps = to - from;
  if (steps <= 0) {
    points[to] = end;
    return;
  }
  const { open, low, high } = bar;
  const travel = Math.abs(end - start);
  const amp = Math.min(travel * 0.16 + (high - low) * 0.08, (high - low) * 0.2);
  const shape = plan.wiggle[leg % plan.wiggle.length];
  const ease = plan.ease[leg % plan.ease.length];
  const startSide = sideOf(start, open);
  const endSide = sideOf(end, open);
  // The one tick where this leg is allowed to switch sides of the open.
  let crossAt = steps;
  if (startSide !== 0 && endSide !== 0 && startSide !== endSide) {
    for (let k = 1; k <= steps; k += 1) {
      if (sideOf(start + (end - start) * warp(k / steps, ease), open) !== startSide) {
        crossAt = k;
        break;
      }
    }
  }
  const dir = Math.sign(end - start) || 1;
  let prev = start;
  for (let k = 1; k < steps; k += 1) {
    const u = k / steps;
    let wobble = 0;
    for (const { m, a } of shape) wobble += a * Math.sin(Math.PI * m * u);
    // The envelope keeps the leg's first and last prints heading toward their anchors.
    const envelope = Math.sin(Math.PI * u);
    let price = start + (end - start) * warp(u, ease) + sign * amp * wobble * envelope * 0.6;
    price = cents(price, low, high);
    if (Math.abs(price - end) < 0.009) price = cents(end - dir * 0.01, low, high);
    const side = startSide === 0 ? endSide : endSide === 0 ? startSide : k < crossAt ? startSide : endSide;
    price = onSide(price, side, open, low, high);
    if (k === 1 && !moved(prev, price)) price = onSide(cents(prev + dir * 0.01, low, high), side, open, low, high);
    points[from + k] = price;
    prev = price;
  }
  points[to] = end;
}

/** Nudge a repeated print one cent toward the next print, without crossing the open. */
function settle(points: number[], pins: Set<number>, open: number, low: number, high: number) {
  for (let i = 1; i < points.length; i += 1) {
    if (pins.has(i) || moved(points[i - 1], points[i])) continue;
    const next = pins.has(i + 1) || i + 1 >= points.length ? points[i] : points[i + 1];
    const dir = Math.sign(next - points[i - 1]);
    if (dir === 0) continue;
    const nudged = cents(points[i - 1] + dir * 0.01, low, high);
    const side = sideOf(points[i], open) || sideOf(points[i - 1], open);
    if (moved(points[i - 1], nudged) && (side === 0 || sideOf(nudged, open) !== -side)) points[i] = nudged;
  }
}

/**
 * Prices inside one real 1-minute bar.
 * Green bars usually take the lower wick, then the body and upper wick, then settle at the close. Red bars are the mirror.
 * Each leg wanders a little on the way. SQQQ uses its own inverse bar and the opposite wiggle, so it moves against TQQQ.
 */
export function subpath(bar: MinuteBar, seed: number, sign = 1): number[] {
  const key = `${seed >>> 0}:${sign}:${bar.o}:${bar.h}:${bar.l}:${bar.c}`;
  const hit = paths.get(key);
  if (hit) return hit;
  const points = makePath(bar, seed, sign >= 0 ? 1 : -1);
  if (paths.size > 48) paths.delete(paths.keys().next().value as string);
  paths.set(key, points);
  return points;
}

function makePath(bar: MinuteBar, seed: number, sign: number): number[] {
  const n = SUBTICKS;
  const low = Math.min(bar.l, bar.o, bar.c);
  const high = Math.max(bar.h, bar.o, bar.c);
  const span = high - low;
  const points = new Array<number>(n + 1).fill(bar.o);
  points[n] = bar.c;
  if (!(span >= 0.02)) return points;
  const plan = planOf(seed);
  const lowFirst = lowFirstOf(plan, bar.o, high, low, bar.c);
  let lo = lowFirst ? plan.early : plan.late;
  let hi = lowFirst ? plan.late : plan.early;
  if (Math.abs(bar.o - low) < 1e-6) lo = 0;
  if (Math.abs(bar.o - high) < 1e-6) hi = 0;
  const anchors = [
    { t: 0, p: bar.o },
    { t: lo, p: low },
    { t: hi, p: high },
    { t: n, p: bar.c },
  ].sort((a, b) => a.t - b.t || a.p - b.p);
  const shape = { open: bar.o, low, high };
  points[0] = bar.o;
  let leg = 0;
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const from = anchors[i];
    const to = anchors[i + 1];
    if (to.t <= from.t) continue;
    fillLeg(points, from.t, to.t, points[from.t] ?? from.p, to.p, shape, plan, leg, sign);
    leg += 1;
  }
  points[0] = bar.o;
  points[lo] = low;
  points[hi] = high;
  points[n] = bar.c;
  settle(points, new Set([0, n, hi, lo]), bar.o, low, high);
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
