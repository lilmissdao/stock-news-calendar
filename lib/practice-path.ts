import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };
/**
 * Sub-ticks inside one minute. About 3 a second at 1x, on an irregular cadence.
 * Tick 0 is the open. Tick SUBTICKS is the close. A full minute is 60 real seconds at 1x.
 */
export const SUBTICKS = 180;
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

type Jerk = { at: number; dir: number; size: number; len: number; reverse: boolean };
type TapePlan = { hi: number; lo: number; noise: number[]; jerks: Jerk[] };

const plans = new Map<number, TapePlan>();
const paths = new Map<string, number[]>();

function planOf(seed: number): TapePlan {
  const key = seed >>> 0;
  const cached = plans.get(key);
  if (cached) return cached;
  const rng = mulberry32(key);
  const n = SUBTICKS;
  const lowFirst = rng() < 0.5;
  const early = 24 + Math.floor(rng() * Math.floor(n * 0.26));
  let late = Math.floor(n * 0.5) + Math.floor(rng() * Math.floor(n * 0.26));
  if (late - early < 28) late = Math.min(n - 36, early + 28);
  const lo = lowFirst ? early : late;
  const hi = lowFirst ? late : early;
  const noise: number[] = [];
  for (let i = 0; i < n; i += 1) noise.push(rng() * 2 - 1);
  const jerks: Jerk[] = [];
  const used = [lo, hi];
  const extra = rng() < 0.5 ? 1 : 0;
  let guard = 0;
  while (jerks.length < extra && guard < 20) {
    guard += 1;
    const len = 2 + Math.floor(rng() * 2);
    const at = 28 + Math.floor(rng() * (n - 80));
    if (used.some((point) => Math.abs(point - at) < 12)) continue;
    used.push(at);
    jerks.push({
      at,
      dir: rng() < 0.5 ? -1 : 1,
      size: 0.1 + rng() * 0.08,
      len,
      reverse: rng() < 0.65,
    });
  }
  const plan = { hi, lo, noise, jerks };
  plans.set(key, plan);
  return plan;
}

/** Where this minute's shared tape tags the high and the low. SQQQ swaps the two. */
export function sharedTape(seed: number): SharedTape {
  const plan = planOf(seed);
  return { hi: plan.hi, lo: plan.lo };
}

function cents(price: number, low: number, high: number): number {
  const next = Math.round(price * 100) / 100;
  if (next < low) return low;
  if (next > high) return high;
  return next;
}

function poke(points: number[], at: number, target: number, low: number, high: number) {
  const span = Math.max(high - low, 0.01);
  const len = 3;
  const origin = Math.max(1, at - len);
  const away = target - Math.sign(target - (low + high) / 2 || 1) * Math.max(0.04, span * 0.16);
  points[origin] = cents(away, low, high);
  const start = points[origin];
  const steps = at - origin;
  for (let k = 1; k <= steps; k += 1) {
    const eased = (k / steps) ** 2;
    const idx = origin + k;
    points[idx] = idx === at ? target : cents(start + (target - start) * eased, low, high);
  }
  points[at] = target;
  if (at + 1 < points.length - 1) {
    points[at + 1] = cents(target + (start - target) * 0.62, low, high);
  }
  if (at + 2 < points.length - 1) {
    points[at + 2] = cents(target + (start - target) * 0.84, low, high);
  }
}

function applyJerk(points: number[], jerk: Jerk, flip: number, low: number, high: number, innerLow: number, innerHigh: number) {
  const len = jerk.len;
  const at = jerk.at;
  const from = at - len;
  if (from < 2 || at + 2 >= points.length - 8) return;
  const start = points[from];
  const dir = jerk.dir * flip || flip;
  let target = start + dir * (high - low) * jerk.size;
  target = Math.min(innerHigh, Math.max(innerLow, target));
  if (Math.abs(target - start) < 0.02) target = start + (dir > 0 ? 0.04 : -0.04) * Math.sign(dir || 1);
  target = Math.min(innerHigh, Math.max(innerLow, target));
  for (let k = 1; k <= len; k += 1) {
    const eased = (k / len) ** 2;
    points[from + k] = cents(start + (target - start) * eased, low, high);
  }
  if (jerk.reverse && at + 2 < points.length - 8) {
    const back = start + (target - start) * 0.28;
    points[at + 1] = cents(target + (back - target) * 0.55, low, high);
    points[at + 2] = cents(back, low, high);
  }
}

function land(points: number[], close: number, low: number, high: number) {
  const n = points.length - 1;
  const start = Math.max(1, n - 8);
  let prev = points[start];
  for (let i = start + 1; i < n; i += 1) {
    const remain = n - i;
    const need = close - prev;
    const dir = need === 0 ? (prev > low ? -1 : 1) : Math.sign(need);
    const step = Math.max(0.01, Math.min(Math.abs(need) / remain, 0.04));
    let next = cents(prev + dir * step, low, high);
    if (Math.abs(next - prev) < 0.009) {
      const alt = prev + (prev - low >= high - prev ? -0.01 : 0.01);
      next = cents(alt, low, high);
    }
    points[i] = next;
    prev = next;
  }
  points[n] = close;
  if (Math.abs(points[n] - points[n - 1]) < 0.009) {
    const nudged = points[n] - 0.01 >= low ? points[n] - 0.01 : points[n] + 0.01;
    if (nudged >= low && nudged <= high) points[n - 1] = Math.round(nudged * 100) / 100;
  }
}

function moved(left: number, right: number): boolean {
  return Math.abs(right - left) >= 0.0095;
}

function pushAway(prev: number, dir: number, low: number, high: number, avoid: number[] = []): number {
  for (const extra of [0.01, 0.015, 0.02, 0.03, 0.04, 0.05]) {
    for (const way of [dir, -dir]) {
      const next = Math.round((prev + way * extra) * 100) / 100;
      if (next < low || next > high || !moved(prev, next)) continue;
      if (avoid.every((price) => moved(price, next))) return next;
    }
  }
  return Math.min(high, Math.max(low, prev));
}

/** Breaks up repeated prints without pulling the path outside the real bar. */
function spread(points: number[], open: number, close: number, low: number, high: number, hi: number, lo: number) {
  const n = points.length - 1;
  const pins = new Set([0, n, hi, lo]);
  points[0] = open;
  points[n] = close;
  points[hi] = high;
  points[lo] = low;
  const cap = high - low >= 0.02 ? high - 0.01 : high;
  const floor = high - low >= 0.02 ? low + 0.01 : low;
  for (let i = 1; i < n; i += 1) {
    if (pins.has(i)) continue;
    let price = Math.min(cap, Math.max(floor, points[i]));
    if (!moved(points[i - 1], price)) price = pushAway(points[i - 1], points[i - 1] > (low + high) / 2 ? -1 : 1, floor, cap);
    points[i] = price;
  }
  const span = Math.max(high - low, 0.01);
  for (const [at, target] of [
    [hi, high],
    [lo, low],
  ] as const) {
    const prev = at - 1;
    if (prev <= 0 || pins.has(prev)) continue;
    const minJump = Math.max(0.03, span * 0.12);
    if (moved(points[prev], target) && Math.abs(target - points[prev]) >= minJump - 1e-9) continue;
    const away = target >= (low + high) / 2 ? target - minJump : target + minJump;
    points[prev] = Math.min(cap, Math.max(floor, Math.round(away * 100) / 100));
    if (!moved(points[prev - 1], points[prev])) points[prev - 1] = pushAway(points[prev], points[prev] > points[prev - 1] ? -1 : 1, floor, cap);
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 1; i < n; i += 1) {
      if (pins.has(i) || i === hi - 1 || i === lo - 1) continue;
      const avoid = [points[i - 1], points[i + 1]];
      if (avoid.some((price) => !moved(points[i], price))) {
        points[i] = pushAway(points[i - 1], i % 2 === 0 ? -1 : 1, floor, cap, avoid);
      }
    }
  }
  if (!pins.has(n - 1) && !moved(points[n - 1], close)) {
    points[n - 1] = pushAway(close, close > (low + high) / 2 ? -1 : 1, floor, cap, [points[n - 2]]);
  }
  points[0] = open;
  points[n] = close;
  points[hi] = high;
  points[lo] = low;
}

/**
 * Prices inside one real 1-minute bar.
 * The walk is seeded by the minute, starts at the open, tags the real high and low with fast spikes,
 * and ends at the close. Sign −1 runs the same tape in the opposite direction for SQQQ.
 */
export function subpath(bar: MinuteBar, seed: number, sign = 1): number[] {
  const key = `${seed >>> 0}:${sign < 0 ? 0 : 1}:${bar.o}:${bar.h}:${bar.l}:${bar.c}`;
  const hit = paths.get(key);
  if (hit) return hit;
  const points = makePath(bar, seed, sign);
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
  const flip = sign < 0 ? -1 : 1;
  const hi = sign < 0 ? plan.lo : plan.hi;
  const lo = sign < 0 ? plan.hi : plan.lo;
  const pad = Math.min(0.01, span / 3);
  const innerLow = low + pad;
  const innerHigh = high - pad;
  const mid = (low + high) / 2;
  let prev = bar.o;
  for (let i = 1; i < n; i += 1) {
    const pull = (mid - prev) * 0.07 + (bar.c - prev) * 0.035;
    const noise = plan.noise[i] * flip * Math.min(span * 0.035, 0.04);
    const desired = pull + noise;
    let dir = desired === 0 ? flip : Math.sign(desired);
    if (dir === 0) dir = 1;
    const steps = 1;
    let next = prev + dir * steps * 0.01;
    if (next > innerHigh || next < innerLow) {
      dir *= -1;
      next = prev + dir * 0.01;
    }
    next = cents(next, innerLow, innerHigh);
    if (Math.abs(next - prev) < 0.009) {
      const alt = prev + (prev - innerLow <= innerHigh - prev ? 0.01 : -0.01);
      next = cents(alt, innerLow, innerHigh);
    }
    points[i] = Math.abs(next - prev) < 0.009 ? prev : next;
    prev = points[i];
  }
  points[0] = bar.o;
  points[n] = bar.c;
  for (const jerk of plan.jerks) applyJerk(points, jerk, flip, low, high, innerLow, innerHigh);
  poke(points, hi, high, low, high);
  poke(points, lo, low, low, high);
  land(points, bar.c, low, high);
  spread(points, bar.o, bar.c, low, high, hi, lo);
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
