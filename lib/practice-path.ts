import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };
/** One sub-tick per real second at 1x. A 1-minute candle takes 60 seconds to reach its close. */
export const SUBTICKS = 60;
/** 9:30–10:00 AM ET. Six real 5-minute bars. */
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

function gaussian(rng: Rng): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

/** Brownian bridge of 6 points, pinned at 0 on both ends. */
function bridge(rng: Rng): number[] {
  const raw = [0];
  for (let i = 1; i <= 5; i += 1) raw.push(raw[i - 1] + gaussian(rng));
  const end = raw[5];
  return raw.map((value, index) => value - (index / 5) * end);
}

function barOf(tuple: Ohlc): { o: number; h: number; l: number; c: number } {
  const [o, h, l, c] = tuple;
  return { o, h: Math.max(h, o, c), l: Math.min(l, o, c), c };
}

function shape(tuple: Ohlc, noise: number[], sign: number): number[] {
  const bar = barOf(tuple);
  const span = Math.max(bar.h - bar.l, 0);
  const points = noise.map((value, index) => bar.o + (bar.c - bar.o) * (index / 5) + sign * value * span * 0.9);
  points[0] = bar.o;
  points[5] = bar.c;
  for (let i = 1; i < 5; i += 1) points[i] = Math.min(bar.h, Math.max(bar.l, points[i]));
  let maxAt = 1;
  let minAt = 2;
  for (let i = 1; i < 5; i += 1) {
    if (points[i] > points[maxAt]) maxAt = i;
    if (points[i] < points[minAt]) minAt = i;
  }
  if (maxAt === minAt) minAt = maxAt === 1 ? 3 : 1;
  if (points[maxAt] < bar.h) points[maxAt] = bar.h;
  if (points[minAt] > bar.l) points[minAt] = bar.l;
  points[0] = bar.o;
  points[5] = bar.c;
  for (let i = 1; i < 5; i += 1) points[i] = Math.min(bar.h, Math.max(bar.l, points[i]));
  if (Math.max(...points) < bar.h) points[maxAt] = bar.h;
  if (Math.min(...points) > bar.l) points[minAt] = bar.l;
  points[0] = bar.o;
  points[5] = bar.c;
  return points;
}

function candles(points: number[], origin: number, minuteBase: number, high: number, low: number): MinuteBar[] {
  const bars: MinuteBar[] = [];
  for (let i = 0; i < 5; i += 1) {
    const open = points[i];
    const close = points[i + 1];
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    let top = bodyHigh + Math.max(0, high - bodyHigh) * 0.72;
    let bottom = bodyLow - Math.max(0, bodyLow - low) * 0.72;
    if (Math.abs(open - high) < 1e-8 || Math.abs(close - high) < 1e-8) top = high;
    if (Math.abs(open - low) < 1e-8 || Math.abs(close - low) < 1e-8) bottom = low;
    top = Math.min(high, Math.max(top, bodyHigh));
    bottom = Math.max(low, Math.min(bottom, bodyLow));
    bars.push({ t: origin + (minuteBase + i) * 60, o: open, h: top, l: bottom, c: close });
  }
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < bars.length; i += 1) {
    if (bars[i].h > bars[hi].h) hi = i;
    if (bars[i].l < bars[lo].l) lo = i;
  }
  if (bars[hi].h < high) bars[hi].h = high;
  if (bars[lo].l > low) bars[lo].l = low;
  return bars;
}

export function buildSession(day: PracticeDay, seed: number): { TQQQ: MinuteBar[]; SQQQ: MinuteBar[] } {
  const rng = mulberry32(seed);
  const tqqq: MinuteBar[] = [];
  const sqqq: MinuteBar[] = [];
  for (let i = 0; i < day.tqqq.length; i += 1) {
    const noise = bridge(rng);
    const tBar = barOf(day.tqqq[i]);
    const sBar = barOf(day.sqqq[i]);
    tqqq.push(...candles(shape(day.tqqq[i], noise, 1), day.start, i * 5, tBar.h, tBar.l));
    sqqq.push(...candles(shape(day.sqqq[i], noise, -1), day.start, i * 5, sBar.h, sBar.l));
  }
  return { TQQQ: tqqq, SQQQ: sqqq };
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
export function chartBars(minutes: MinuteBar[], cursor: number, tick: number, daySeed: number, sign: number, timeframe: Timeframe): MinuteBar[] {
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

/** One random path in 0–1 for a minute. SQQQ uses the mirror of the same tape. */
export function sharedTape(seed: number): SharedTape {
  const rng = mulberry32(seed >>> 0);
  const count = SUBTICKS;
  const unit = [0];
  for (let i = 1; i < count; i += 1) {
    const dir = rng() < 0.5 ? -1 : 1;
    let next = unit[i - 1] + dir * (0.08 + rng() * 0.14);
    next = Math.min(1, Math.max(0, next));
    if (Math.abs(next - unit[i - 1]) < 0.06) next = Math.min(1, Math.max(0, unit[i - 1] + dir * 0.08));
    unit.push(next);
  }
  unit.push(0);
  let hi = 1 + Math.floor(rng() * Math.max(1, count - 2));
  let lo = 1 + Math.floor(rng() * Math.max(1, count - 2));
  if (lo === hi) lo = hi > 1 ? hi - 1 : hi + 1;
  unit[hi] = 1;
  unit[lo] = 0;
  return { unit, hi, lo };
}

/** Prices inside one 1-minute candle. Sign −1 mirrors the shared tape. */
export function subpath(bar: MinuteBar, seed: number, sign = 1): number[] {
  const tape = sharedTape(seed);
  const count = SUBTICKS;
  const span = Math.max(bar.h - bar.l, 0);
  const points = tape.unit.map((unit, index) => {
    if (index === 0) return bar.o;
    if (index === count) return bar.c;
    const placed = sign < 0 ? 1 - unit : unit;
    return bar.l + placed * span;
  });
  points[sign < 0 ? tape.lo : tape.hi] = bar.h;
  points[sign < 0 ? tape.hi : tape.lo] = bar.l;
  points[0] = bar.o;
  points[count] = bar.c;
  const minStep = span >= 0.05 ? 0.01 : 0;
  if (minStep > 0) {
    for (let i = 1; i < count; i += 1) {
      if (points[i] === bar.h || points[i] === bar.l) continue;
      if (Math.abs(points[i] - points[i - 1]) >= minStep - 1e-9) continue;
      const dir = (i % 2 === 0 ? 1 : -1) * (sign < 0 ? -1 : 1);
      points[i] = Math.min(bar.h, Math.max(bar.l, points[i - 1] + dir * minStep));
    }
  }
  points[sign < 0 ? tape.lo : tape.hi] = bar.h;
  points[sign < 0 ? tape.hi : tape.lo] = bar.l;
  points[0] = bar.o;
  points[count] = bar.c;
  return points;
}

export function formingBar(bar: MinuteBar, path: number[], tick: number): MinuteBar {
  const index = Math.max(0, Math.min(tick, path.length - 1));
  const seen = path.slice(0, index + 1);
  return { t: bar.t, o: bar.o, c: path[index], h: Math.max(...seen), l: Math.min(...seen) };
}

export function clock(unix: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}
