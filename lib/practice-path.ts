import type { Ohlc, PracticeDay } from "./practice-market";

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1D";

const FRAME_MINUTES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };
/** One sub-tick per real second at 1x. A 1-minute candle takes 60 seconds to reach its close. */
export const SUBTICKS = 480;
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
  // Two neighbouring points parked on the same extreme make a candle that opens and closes at its high or low
  // (a "T"), which real 1-minute candles almost never do. Pull the spare one back inside the range.
  for (let i = 1; i < 5; i += 1) {
    for (const extreme of [bar.h, bar.l]) {
      const touchesPrev = Math.abs(points[i - 1] - extreme) < 1e-9;
      const touchesNext = Math.abs(points[i + 1] - extreme) < 1e-9;
      if (Math.abs(points[i] - extreme) < 1e-9 && (touchesPrev || touchesNext) && i !== maxAt && i !== minAt) {
        const pull = 0.3 + 0.25 * Math.abs(noise[i] % 1);
        points[i] = extreme + (extreme === bar.h ? -1 : 1) * span * pull;
      }
    }
  }
  for (let i = 1; i < 5; i += 1) {
    if (i === maxAt || i === minAt) continue;
    for (const [j, extreme] of [[i - 1, bar.h], [i + 1, bar.h], [i - 1, bar.l], [i + 1, bar.l]] as const) {
      // An end point (the 5-minute open or close) sitting on an extreme next to a designated extreme point.
      if (Math.abs(points[j] - extreme) < 1e-9 && Math.abs(points[i] - extreme) < 1e-9) {
        points[i] = extreme + (extreme === bar.h ? -1 : 1) * span * 0.35;
      }
    }
  }
  return points;
}

/** Deterministic 0..1 value from a candle's own numbers, so wick lengths vary but replay identically. */
function wobble(open: number, close: number, index: number, salt: number): number {
  const x = Math.sin(open * 12.9898 + close * 78.233 + index * 37.719 + salt * 11.13) * 43758.5453;
  return x - Math.floor(x);
}

function candles(points: number[], origin: number, minuteBase: number, high: number, low: number): MinuteBar[] {
  const bars: MinuteBar[] = [];
  for (let i = 0; i < 5; i += 1) {
    const open = points[i];
    const close = points[i + 1];
    const bodyHigh = Math.max(open, close);
    const bodyLow = Math.min(open, close);
    // Wicks reach a little past the body, scaled to the move, not most of the way to the 5-minute extremes.
    const body = bodyHigh - bodyLow;
    const unit = Math.max(body, (high - low) * 0.12);
    let top = bodyHigh + Math.min(Math.max(0, high - bodyHigh), unit * (0.2 + 1.3 * wobble(open, close, i, 1)));
    let bottom = bodyLow - Math.min(Math.max(0, bodyLow - low), unit * (0.2 + 1.3 * wobble(open, close, i, 2)));
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

/**
 * The session's real 1-minute bars (9:30–9:59 ET), joined so each candle opens at the previous close.
 * Older books held 5-minute bars; those are still split into 1-minute candles, with SQQQ mirroring TQQQ.
 * `seed` only matters for the 5-minute fallback.
 */
export function buildSession(day: PracticeDay, seed: number): { TQQQ: MinuteBar[]; SQQQ: MinuteBar[] } {
  if (day.tqqq.length <= SESSION_MINUTES) {
    const real = (bars: Ohlc[]) =>
      bars.slice(0, SESSION_MINUTES).map((tuple, index) => {
        const bar = barOf(tuple);
        return { t: day.start + index * 60, o: bar.o, h: Math.max(bar.h, bar.o, bar.c), l: Math.min(bar.l, bar.o, bar.c), c: bar.c };
      });
    return { TQQQ: joined(real(day.tqqq)), SQQQ: joined(real(day.sqqq)) };
  }
  const rng = mulberry32(seed);
  const tqqq: MinuteBar[] = [];
  const sqqq: MinuteBar[] = [];
  for (let i = 0; i < Math.ceil(SESSION_MINUTES / 5); i += 1) {
    const noise = bridge(rng);
    const tBar = barOf(day.tqqq[i]);
    const sBar = barOf(day.sqqq[i]);
    const tMinutes = candles(shape(day.tqqq[i], noise, 1), day.start, i * 5, tBar.h, tBar.l);
    tqqq.push(...tMinutes);
    sqqq.push(...(mirrorMinutes(tMinutes, tBar, sBar) ?? candles(shape(day.sqqq[i], noise, -1), day.start, i * 5, sBar.h, sBar.l)));
  }
  return { TQQQ: joined(tqqq), SQQQ: joined(sqqq) };
}

/**
 * SQQQ's 1-minute candles inside one real 5-minute bar, as the mirror image of TQQQ's: when TQQQ is at its 5-minute
 * high, SQQQ is at its 5-minute low, and every price in between maps linearly. The 5-minute open and close stay real.
 * Without this the two were split separately and could hit their extremes in different minutes.
 */
function mirrorMinutes(tMinutes: MinuteBar[], tBar: { o: number; h: number; l: number; c: number }, sBar: { o: number; h: number; l: number; c: number }): MinuteBar[] | null {
  const tSpan = tBar.h - tBar.l;
  const sSpan = sBar.h - sBar.l;
  if (!(tSpan > 1e-9) || !(sSpan > 1e-9)) return null;
  const map = (price: number) => Math.min(sBar.h, Math.max(sBar.l, sBar.h - ((price - tBar.l) / tSpan) * sSpan));
  const last = tMinutes.length - 1;
  return tMinutes.map((bar, index) => {
    const o = index === 0 ? sBar.o : map(bar.o);
    const c = index === last ? sBar.c : map(bar.c);
    // TQQQ's low is SQQQ's high and the other way round.
    const h = Math.max(map(bar.l), o, c);
    const l = Math.min(map(bar.h), o, c);
    return { t: bar.t, o, h, l, c };
  });
}

/**
 * Each candle opens exactly where the one before it closed, so the tape flows from candle to candle.
 * Closes are kept; when the open moves, the wick stretches just enough to include it.
 */
function joined(bars: MinuteBar[]): MinuteBar[] {
  return bars.map((bar, index) => {
    if (index === 0) return bar;
    const o = bars[index - 1].c;
    return { ...bar, o, h: Math.max(bar.h, o), l: Math.min(bar.l, o) };
  });
}

export function minuteSeed(daySeed: number, minute: number): number {
  return (daySeed + minute * 997) >>> 0;
}

export type PriceWindow = { from: number; to: number };

/** Visible price range: framed on the candles only. The prior close is never pulled in, so a gap can't squash the candles into a sliver. */
export function priceWindow(bars: { h: number; l: number; o?: number; c?: number }[]): PriceWindow | null {
  if (!bars.length) return null;
  let high = Math.max(...bars.map((bar) => Math.max(bar.h, bar.o ?? bar.h, bar.c ?? bar.h)));
  let low = Math.min(...bars.map((bar) => Math.min(bar.l, bar.o ?? bar.l, bar.c ?? bar.l)));
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
  if (high < low) [high, low] = [low, high];
  const mid = (high + low) / 2 || Math.abs(high) || 1;
  const pad = Math.max((high - low) * 0.15, Math.abs(mid) * 0.0008, 0.02);
  return { from: low - pad, to: high + pad };
}

/** A price range widened to include the bar with a little headroom, or null when the bar already fits. */
export function growToInclude(range: PriceWindow, bar: { h: number; l: number }): PriceWindow | null {
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);
  if (bar.l >= low && bar.h <= high) return null;
  const from = Math.min(low, bar.l);
  const to = Math.max(high, bar.h);
  const room = (to - from) * 0.08;
  return { from: bar.l < low ? from - room : from, to: bar.h > high ? to + room : to };
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
    bars.push(formingBar(bar, subpath(bar, minuteSeed(daySeed, minute), sign, minute === 0), formed));
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
  /** Small tick-to-tick chop, shared by TQQQ and SQQQ (mirrored), so the tape never sits still. */
  chop: number[];
  /** How busy the tape is at each print (always > 0): bursts of fast trading, then quiet drifts. */
  activity: number[];
  /** A random walk over the minute, stepped by activity, for up-and-down swings of every size. */
  walk: number[];
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
  const early = Math.round(n * 0.065) + Math.floor(rng() * Math.floor(n * 0.24));
  let late = Math.floor(n * 0.42) + Math.floor(rng() * Math.floor(n * 0.32));
  const gap = Math.round(n * 0.13);
  if (late - early < gap) late = Math.min(n - gap, early + gap);
  const sharpFlip = rng() < 0.1;
  const wiggle = [0, 1, 2].map(() => {
    const count = 1 + Math.floor(rng() * 2);
    return Array.from({ length: count }, () => ({ m: 2 + Math.floor(rng() * 3), a: (rng() * 2 - 1) * (0.6 + rng() * 0.4) }));
  });
  const ease = [0, 1, 2].map(() => 0.3 + rng() * 0.6);
  const chop: number[] = [];
  let drift = 0;
  for (let k = 0; k <= n; k += 1) {
    // Smooth mean-reverting noise (about -1.5 to 1.5): gentle back-and-forth around the trail, not tick-to-tick jitter.
    drift = drift * 0.93 + (rng() + rng() + rng() - 1.5) * 0.5;
    chop.push(drift);
  }
  const activity: number[] = [];
  const walk: number[] = [0];
  let mood = 0;
  let velocity = 0;
  for (let k = 0; k <= n; k += 1) {
    // Slowly changing mood: a burst lasts a few seconds, so speed comes in spurts instead of a steady glide.
    mood = mood * 0.97 + (rng() + rng() + rng() - 1.5) * 0.42;
    activity.push(Math.exp(1.15 * mood));
    // The walk has momentum, so it makes clean swings (some quick, some slow) rather than tick-to-tick jitter.
    velocity = velocity * 0.94 + (rng() + rng() + rng() - 1.5) * Math.sqrt(activity[k]);
    if (k > 0) walk.push(walk[k - 1] + velocity);
  }
  const plan = { early, late, sharpFlip, wiggle, ease, chop, activity, walk };
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

function inside(price: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, price));
}

/**
 * Keep a price inside the bar and on its side of the open by bouncing off the limit instead of sticking to it.
 * Touching the open is allowed (a doji for an instant); going through it to the other color is not.
 */
function bounce(price: number, side: number, open: number, low: number, high: number): number {
  // The allowed band: the whole bar, or just its own side of the open while the color must hold.
  const lo = side > 0 ? Math.min(high, Math.max(low, open)) : low;
  const hi = side < 0 ? Math.max(low, Math.min(high, open)) : high;
  const width = hi - lo;
  if (!(width > 1e-9)) return inside(lo, low, high);
  // Fold an overshoot back into the band like a ball off a wall, so price never parks on an edge.
  const phase = (((price - lo) / width) % 2 + 2) % 2;
  return inside(lo + (phase <= 1 ? phase : 2 - phase) * width, low, high);
}

/** Which side of the open a price is on. Within a third of a cent counts as at the open, so a near-touch can't pin the tape. */
function sideOf(price: number, open: number): number {
  if (price > open + 0.003) return 1;
  if (price < open - 0.003) return -1;
  return 0;
}


/**
 * One leg between two anchors (open, a wick, the other wick, the close). Price works toward the target on a
 * busy-time clock, so it moves in quick bursts and slow drifts, and a random walk pinned to zero at both anchors
 * adds up-and-down swings of different sizes. It never crosses the open more than once, folds back off the
 * wicks instead of parking on them, and lands on the target exactly. `leg` is the leg's position in the bar.
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
  swingScale = 1,
) {
  const steps = to - from;
  if (steps <= 0) {
    points[to] = end;
    return;
  }
  const { open, low, high } = bar;
  const span = high - low;
  const travel = Math.abs(end - start);
  // Small cent-level chop on top of the swings below.
  const chopAmp = Math.min(0.01, Math.max(0.002, span * 0.009));
  const startSide = sideOf(start, open);
  const endSide = sideOf(end, open);
  const fade = Math.max(3, Math.round(steps * 0.08));
  // Busy-time clock for this leg: progress runs fast during bursts and crawls when the tape is quiet.
  const busy: number[] = [0];
  for (let k = 1; k <= steps; k += 1) busy.push(busy[k - 1] + plan.activity[(from + k) % plan.activity.length]);
  const total = busy[steps] || 1;
  // A random walk pinned to zero at both anchors (a Brownian bridge), scaled to the leg: real swings up and down.
  const w0 = plan.walk[from % plan.walk.length];
  const w1 = plan.walk[to % plan.walk.length];
  const swing = Math.min((travel * 0.28 + span * 0.05) * swingScale, span * 0.24 * Math.max(1, swingScale));
  const pinned: number[] = [0];
  let reach = 0;
  for (let k = 1; k < steps; k += 1) {
    const value = plan.walk[(from + k) % plan.walk.length] - w0 - (busy[k] / total) * (w1 - w0);
    pinned.push(value);
    reach = Math.max(reach, Math.abs(value));
  }
  const raw: number[] = [];
  for (let k = 1; k < steps; k += 1) {
    const tau = busy[k] / total;
    // Scaled so the leg's biggest swing is about `swing`; smaller ones come and go along the way.
    const bridge = reach > 0 ? pinned[k] / reach : 0;
    // Chop fades in and out near the anchors so each one is still hit exactly and approached smoothly.
    const nearEdge = Math.min(1, Math.min(k, steps - k) / fade);
    const chop = plan.chop[(from + k) % plan.chop.length] * chopAmp * nearEdge;
    raw[k] = start + (end - start) * tau + sign * (swing * bridge + chop);
  }
  // A leg that changes color crosses the open once, at the print where the wiggling price itself last crosses it,
  // so switching sides is seamless. Earlier dips past the open are mirrored back instead of flipping the color.
  let crossAt = steps;
  if (startSide !== 0 && endSide !== 0 && startSide !== endSide) {
    crossAt = 1;
    for (let k = steps - 1; k >= 1; k -= 1) {
      if (sideOf(raw[k], open) === startSide) {
        crossAt = k + 1;
        break;
      }
    }
  }
  for (let k = 1; k < steps; k += 1) {
    let side = startSide === 0 ? endSide : endSide === 0 ? startSide : k < crossAt ? startSide : endSide;
    // Both ends sit at the open: hold to whichever side the leg leans, so it can't flicker across.
    if (side === 0) side = Math.sign(end - open) || Math.sign(start - open) || Math.sign(raw[k] - open);
    points[from + k] = bounce(raw[k], side, open, low, high);
  }
  points[to] = end;
}

/**
 * Prices inside one real 1-minute bar.
 * Green bars usually take the lower wick, then the body and upper wick, then settle at the close. Red bars are the mirror.
 * Each leg wanders a little on the way. SQQQ uses its own inverse bar and the opposite wiggle, so it moves against TQQQ.
 */
export function subpath(bar: MinuteBar, seed: number, sign = 1, opening = false): number[] {
  const key = `${seed >>> 0}:${sign}:${opening ? 1 : 0}:${bar.o}:${bar.h}:${bar.l}:${bar.c}`;
  const hit = paths.get(key);
  if (hit) return hit;
  const points = (opening && openingPath(bar, seed, sign >= 0 ? 1 : -1)) || makePath(bar, seed, sign >= 0 ? 1 : -1);
  if (paths.size > 48) paths.delete(paths.keys().next().value as string);
  paths.set(key, points);
  return points;
}

/** How often the 9:30 candle gets the spike-and-retreat shape. More often than not, but not always. */
export const OPENING_SPIKE_ODDS = 0.7;

export type OpeningPlan = {
  /** Tick where the fast spike tags its extreme. */
  spike: number;
  /** Tick where the retreat bottoms out. */
  retreat: number;
  /** Share of the spike given back (0.6–0.9). */
  giveBack: number;
};

/**
 * The 9:30 candle's plan, or null when this day's opening minute is an ordinary candle. TQQQ and SQQQ share it,
 * so they spike and retreat at the same moments, in opposite directions.
 */
export function openingPlan(seed: number): OpeningPlan | null {
  const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  if (rng() >= OPENING_SPIKE_ODDS) return null;
  const n = SUBTICKS;
  // A fast spike in the first ~4–12% of the minute, then most of it given back by ~22–38%.
  const spike = Math.round(n * (0.04 + rng() * 0.08));
  const retreat = Math.max(spike + Math.round(n * 0.1), Math.round(n * (0.22 + rng() * 0.16)));
  const giveBack = 0.6 + rng() * 0.3;
  return { spike, retreat, giveBack };
}

/**
 * The opening minute: one fast push to an extreme, a quick retreat that gives back most of it, then a slower,
 * choppier drift for the rest of the minute that still tags the other extreme and lands on the real close.
 * The spike goes the candle's way (up on a green candle); a near-doji spikes toward its longer wick.
 */
function openingPath(bar: MinuteBar, seed: number, sign: number): number[] | null {
  const plan = openingPlan(seed);
  const n = SUBTICKS;
  const low = Math.min(bar.l, bar.o, bar.c);
  const high = Math.max(bar.h, bar.o, bar.c);
  const span = high - low;
  if (!plan || !(span > 1e-6)) return null;
  const body = bar.c - bar.o;
  const up = Math.abs(body) >= span * 0.08 ? body > 0 : high - bar.o >= bar.o - low;
  const peak = up ? high : low;
  const other = up ? low : high;
  const move = Math.abs(peak - bar.o);
  // No room to spike (the open is the extreme): use the normal shape.
  if (!(move > 0.005)) return null;
  // Give back most of the spike, but never past the other extreme.
  let back = peak + (up ? -1 : 1) * move * plan.giveBack;
  back = up ? Math.max(back, other) : Math.min(back, other);
  const otherTagged = Math.abs(back - other) < 1e-9 || Math.abs(bar.o - other) < 1e-9;
  const rng = mulberry32((seed ^ 0x27d4eb2d) >>> 0);
  const anchors = [
    { t: 0, p: bar.o },
    { t: plan.spike, p: peak },
    { t: plan.retreat, p: back },
  ];
  if (!otherTagged) {
    // The far wick prints soon after the retreat (by mid-minute), so the rest of the minute is the slower drift back.
    const from = plan.retreat + Math.round(n * 0.06);
    const to = Math.max(from + 1, Math.round(n * 0.55));
    anchors.push({ t: Math.min(to, from + Math.floor(rng() * Math.max(1, to - from))), p: other });
  }
  anchors.push({ t: n, p: bar.c });
  const points = new Array<number>(n + 1).fill(bar.o);
  const tape = planOf(seed);
  const shape = { open: bar.o, low, high };
  // The spike and the retreat are quick and direct; the rest of the minute swings wider.
  const swings = [0.25, 0.5, 1.7, 1.7];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const from = anchors[i];
    const to = anchors[i + 1];
    if (to.t <= from.t) continue;
    fillLeg(points, from.t, to.t, points[from.t] ?? from.p, to.p, shape, tape, i, sign, swings[i] ?? 1.7);
  }
  for (const anchor of anchors) points[anchor.t] = anchor.p;
  return points;
}

function makePath(bar: MinuteBar, seed: number, sign: number): number[] {
  const n = SUBTICKS;
  const low = Math.min(bar.l, bar.o, bar.c);
  const high = Math.max(bar.h, bar.o, bar.c);
  const span = high - low;
  const points = new Array<number>(n + 1).fill(bar.o);
  points[n] = bar.c;
  if (!(span > 1e-6)) return points;
  const plan = planOf(seed);
  const lowFirst = lowFirstOf(plan, bar.o, high, low, bar.c);
  let lo = lowFirst ? plan.early : plan.late;
  let hi = lowFirst ? plan.late : plan.early;
  // With under two cents between the open and the first wick there is nowhere to wander, so it is tagged within the first few seconds.
  const quick = Math.max(2, Math.round(n / 40));
  if (Math.abs(bar.o - low) < 1e-6) lo = 0;
  else if (bar.o - low < 0.005) lo = 1;
  else if (bar.o - low < 0.02 && lo === plan.early) lo = quick;
  if (Math.abs(bar.o - high) < 1e-6) hi = 0;
  else if (high - bar.o < 0.005) hi = 1;
  else if (high - bar.o < 0.02 && hi === plan.early) hi = quick;
  if (lo === hi) {
    if (lowFirst) hi = Math.max(hi + 1, plan.late);
    else lo = Math.max(lo + 1, plan.late);
  }
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
  return points;
}

export function formingBar(bar: MinuteBar, path: number[], tick: number): MinuteBar {
  const index = Math.max(0, Math.min(tick, path.length - 1));
  const seen = path.slice(0, index + 1);
  return { t: bar.t, o: bar.o, c: path[index], h: Math.max(...seen), l: Math.min(...seen) };
}

/** Market time with seconds, e.g. "9:31:18", for the live countdown. */
/**
 * The on-screen clock. Candles replay slowed to PLAYBACK_PACE, but the clock ticks one second per real second at 1x
 * (faster at higher speeds), so it runs ahead of the candle times on the chart.
 */
export function playClock(openUnix: number, cursor: number, tick: number): number {
  const ticks = Math.max(0, cursor) * SUBTICKS + Math.max(0, Math.min(SUBTICKS, tick));
  return openUnix + (ticks * (REAL_CANDLE_MS / 1000)) / SUBTICKS;
}

export function clockSeconds(unix: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(new Date(Math.floor(unix) * 1000))
    .replace(/^0/, "");
}

/** Every replay speed plays at this fraction of its label: 1x takes about 2:51 of real time per one-minute candle. */
export const PLAYBACK_PACE = 0.35;
/** Real milliseconds one candle takes at 1x. */
export const REAL_CANDLE_MS = 60_000 / PLAYBACK_PACE;

/** Real seconds left until the forming candle closes, as m:ss. */
export function secondsLeft(tick: number, speed: number): string {
  const left = Math.max(0, Math.ceil(((SUBTICKS - Math.max(0, Math.min(SUBTICKS, tick))) * (REAL_CANDLE_MS / 1000)) / speed / SUBTICKS - 1e-6));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

export function clock(unix: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unix * 1000));
}
