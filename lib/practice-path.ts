import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };

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
  const points = noise.map((value, index) => bar.o + (bar.c - bar.o) * (index / 5) + sign * value * span * 0.35);
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

function candles(points: number[], origin: number, minuteBase: number): MinuteBar[] {
  const bars: MinuteBar[] = [];
  for (let i = 0; i < 5; i += 1) {
    const open = points[i];
    const close = points[i + 1];
    bars.push({ t: origin + (minuteBase + i) * 60, o: open, h: Math.max(open, close), l: Math.min(open, close), c: close });
  }
  return bars;
}

export function buildSession(day: PracticeDay, seed: number): { TQQQ: MinuteBar[]; SQQQ: MinuteBar[] } {
  const rng = mulberry32(seed);
  const tqqq: MinuteBar[] = [];
  const sqqq: MinuteBar[] = [];
  for (let i = 0; i < day.tqqq.length; i += 1) {
    const noise = bridge(rng);
    tqqq.push(...candles(shape(day.tqqq[i], noise, 1), day.start, i * 5));
    sqqq.push(...candles(shape(day.sqqq[i], noise, -1), day.start, i * 5));
  }
  return { TQQQ: tqqq, SQQQ: sqqq };
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

export function clock(unix: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}
