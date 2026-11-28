"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Direction Quiz: a random TQQQ session from the past year. Decks: daily turning points and big trend days, unpredictable
 * (choppy and inside) days, or both. The chart shows the day up to "now" with the levels a trader marks (prior day's
 * close/high/low, pre-market high/low, VWAP). For any of the next 5, 15 and 30 minutes she calls Higher, Flat or Lower,
 * then reveals. Every call is saved with its setup, so the report card can show where she goes wrong and drill those
 * moments until she gets them. The date shows once the day is over.
 */

type Ohlc = [number, number, number, number];
type QuizDay = {
  date: string;
  symbol: string;
  kinds: string[];
  start: number;
  bars: Ohlc[];
  vol?: number[];
  pre?: [number, number] | null;
  before: Ohlc[];
  day: Ohlc;
  after: Ohlc[];
};
type QuizIndex = { symbol: string; days: { date: string; kinds: string[] }[] };
type Timeframe = "1m" | "5m";
type Call = "up" | "flat" | "down";
type Tally = { answered: number; correct: number };
type Setup = {
  trend: "rising" | "falling" | "flat";
  prior: "above" | "below";
  vwap: "above" | "below" | "none";
  range: "above" | "inside" | "below" | "forming";
  extreme: "high" | "low" | "between";
  time: "open" | "morning" | "midday" | "afternoon";
  kind: string;
};
type Dim = keyof Setup;
type CallRecord = { date: string; minute: number; horizon: number; call: Call; actual: Call; right: boolean; setup: Setup };
type Stats = {
  v: 1;
  answered: number;
  correct: number;
  flat: number;
  byTimeframe: Record<Timeframe, Tally>;
  byHorizon: Record<string, Tally>;
  byCall?: Partial<Record<Call, Tally>>;
  calls?: CallRecord[];
  days: { date: string; kinds: string[]; answered: number; correct: number; at: string }[];
};
type Result = { horizon: number; call: Call; to: number; change: number; pct: number; actual: Call; right: boolean; why: string[] };
type Reveal = { from: number; to: number; results: Result[]; skipped: boolean; clue: string };
type StartMode = "open" | "random";
type Deck = "patterns" | "choppy" | "mix";
type Deal = "any" | "drill" | "missed";
type Drill = { dim: Dim; value: string };
type Level = { key: string; name: string; label: string; price: number; cls: string };

const STATS_KEY = "snc-quiz:v1";
const PREFS_KEY = "snc-quiz-prefs:v1";
const HORIZONS = [5, 15, 30];
/** Within ±0.15% of the price now counts as Flat; beyond it, Higher or Lower. */
const FLAT = 0.0015;
/** How much of the day is shown before the first call. */
const WARMUP = 15;
const SKIP = 15;
const SESSION = 390;
const CALLS: { call: Call; label: string; cls: string }[] = [
  { call: "up", label: "▲ Higher", cls: "qz-pick-up" },
  { call: "flat", label: "— Flat", cls: "qz-pick-flat" },
  { call: "down", label: "▼ Lower", cls: "qz-pick-down" },
];
const CALL_WORD: Record<Call, string> = { up: "Higher", flat: "Flat", down: "Lower" };
const UNPREDICTABLE = new Set(["Choppy day", "Inside day"]);
const DECKS: { deck: Deck; label: string }[] = [
  { deck: "patterns", label: "Turnarounds & trends" },
  { deck: "choppy", label: "Unpredictable days" },
  { deck: "mix", label: "Mix" },
];
/** A setup needs this many calls before the report card judges it. */
const MIN_SAMPLE = 5;
/** In a drill, this share right over the last 10 calls of the spot counts as "got the hang of it". */
const MASTERY = 0.6;

const DIMS: { dim: Dim; label: string; values: Record<string, string> }[] = [
  { dim: "trend", label: "Last 15 minutes", values: { rising: "Rising for 15 min", falling: "Falling for 15 min", flat: "Flat for 15 min" } },
  { dim: "prior", label: "Against the prior close", values: { above: "Above the prior close", below: "Below the prior close" } },
  { dim: "vwap", label: "Against VWAP", values: { above: "Above VWAP", below: "Below VWAP", none: "No VWAP" } },
  {
    dim: "range",
    label: "Against the 9:30–9:35 range",
    values: { above: "Above the opening range", inside: "Inside the opening range", below: "Below the opening range", forming: "Opening range still forming" },
  },
  { dim: "extreme", label: "Day’s high and low", values: { high: "At the day’s high", low: "At the day’s low", between: "Between the day’s high and low" } },
  { dim: "time", label: "Time of day", values: { open: "The open (9:30–10:00)", morning: "Morning (10:00–11:30)", midday: "Midday (11:30–2:00)", afternoon: "Afternoon (2:00–4:00)" } },
  {
    dim: "kind",
    label: "Type of day",
    values: {
      "Swing low": "Swing-low days",
      "Swing high": "Swing-high days",
      "Big up day": "Big up days",
      "Big down day": "Big down days",
      "Choppy day": "Choppy days",
      "Inside day": "Inside days",
    },
  },
];

function spotName(dim: Dim, value: string): string {
  return DIMS.find((entry) => entry.dim === dim)?.values[value] ?? value;
}

function emptyStats(): Stats {
  return {
    v: 1,
    answered: 0,
    correct: 0,
    flat: 0,
    byTimeframe: { "1m": { answered: 0, correct: 0 }, "5m": { answered: 0, correct: 0 } },
    byHorizon: {},
    byCall: {},
    calls: [],
    days: [],
  };
}

function loadStats(): Stats {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as Stats | null;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.days)) return { ...emptyStats(), ...parsed };
  } catch {
    /* ignore */
  }
  return emptyStats();
}

function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

function bump(tally: Tally | undefined, hit: number): Tally {
  return { answered: (tally?.answered ?? 0) + 1, correct: (tally?.correct ?? 0) + hit };
}

function clock(minute: number): string {
  const total = 9 * 60 + 30 + minute;
  const hour = Math.floor(total / 60);
  const mins = total % 60;
  return `${hour > 12 ? hour - 12 : hour}:${String(mins).padStart(2, "0")}`;
}

function pct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(0)}%`;
}

function signedPct(rate: number): string {
  const text = `${Math.abs(rate * 100).toFixed(2)}%`;
  return rate > 0 ? `+${text}` : rate < 0 ? `-${text}` : text;
}

function signedCents(value: number): string {
  const text = `$${Math.abs(value).toFixed(2)}`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function cents(value: number): string {
  return `${Math.round(Math.abs(value) * 100)}¢`;
}

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** 5-minute candles from 1-minute bars (the last one may be partial). */
function aggregate(bars: Ohlc[], size: number): Ohlc[] {
  const out: Ohlc[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const slice = bars.slice(i, i + size);
    out.push([slice[0][0], Math.max(...slice.map((b) => b[1])), Math.min(...slice.map((b) => b[2])), slice[slice.length - 1][3]]);
  }
  return out;
}

/** VWAP through each minute of the regular session (typical price weighted by volume), or null without volume. */
function vwapSeries(day: QuizDay): number[] | null {
  if (!day.vol || day.vol.length < day.bars.length) return null;
  const out: number[] = [];
  let pv = 0;
  let volume = 0;
  day.bars.forEach((bar, i) => {
    const v = day.vol![i] ?? 0;
    pv += ((bar[1] + bar[2] + bar[3]) / 3) * v;
    volume += v;
    out.push(volume > 0 ? pv / volume : bar[3]);
  });
  return out;
}

/** The fixed levels a trader marks before the open. */
function fixedLevels(day: QuizDay): Level[] {
  const prior = day.before[day.before.length - 1];
  const levels: Level[] = [
    { key: "pc", name: "the prior close", label: "Prior close", price: prior[3], cls: "qz-lv-close" },
    { key: "ph", name: "the prior day’s high", label: "Prior high", price: prior[1], cls: "qz-lv-prior" },
    { key: "pl", name: "the prior day’s low", label: "Prior low", price: prior[2], cls: "qz-lv-prior" },
  ];
  if (day.pre) {
    levels.push({ key: "mh", name: "the pre-market high", label: "Pre-mkt high", price: day.pre[0], cls: "qz-lv-pre" });
    levels.push({ key: "ml", name: "the pre-market low", label: "Pre-mkt low", price: day.pre[1], cls: "qz-lv-pre" });
  }
  return levels;
}

/** Levels known at this minute: the fixed ones and, after 9:35, the opening range. */
function levelsAt(day: QuizDay, from: number): Level[] {
  const levels = fixedLevels(day);
  if (from >= 5) {
    const range = day.bars.slice(0, 5);
    levels.push({ key: "oh", name: "the 9:30–9:35 high", label: "9:30–9:35 high", price: Math.max(...range.map((bar) => bar[1])), cls: "" });
    levels.push({ key: "ol", name: "the 9:30–9:35 low", label: "9:30–9:35 low", price: Math.min(...range.map((bar) => bar[2])), cls: "" });
  }
  return levels;
}

function setupAt(day: QuizDay, from: number, vwap: number[] | null): Setup {
  const now = day.bars[from - 1][3];
  const earlier = from > 15 ? day.bars[from - 16][3] : day.bars[0][0];
  const move = now / earlier - 1;
  const prior = day.before[day.before.length - 1][3];
  let range: Setup["range"] = "forming";
  if (from >= 5) {
    const opening = day.bars.slice(0, 5);
    const high = Math.max(...opening.map((bar) => bar[1]));
    const low = Math.min(...opening.map((bar) => bar[2]));
    range = now > high ? "above" : now < low ? "below" : "inside";
  }
  const sofar = day.bars.slice(0, from);
  const high = Math.max(...sofar.map((bar) => bar[1]));
  const low = Math.min(...sofar.map((bar) => bar[2]));
  const level = vwap ? vwap[from - 1] : null;
  return {
    trend: Math.abs(move) <= FLAT ? "flat" : move > 0 ? "rising" : "falling",
    prior: now >= prior ? "above" : "below",
    vwap: level === null ? "none" : now >= level ? "above" : "below",
    range,
    extreme: high - now <= 0.03 ? "high" : now - low <= 0.03 ? "low" : "between",
    time: from < 30 ? "open" : from < 120 ? "morning" : from < 270 ? "midday" : "afternoon",
    kind: day.kinds[0] ?? "",
  };
}

/** What the chart showed at the moment of the call, in words. */
function describeSetup(day: QuizDay, from: number, vwap: number[] | null): string {
  const now = day.bars[from - 1][3];
  const earlier = from > 15 ? day.bars[from - 16][3] : day.bars[0][0];
  const trend = now / earlier - 1;
  const minutes = Math.min(15, from);
  const prior = day.before[day.before.length - 1][3];
  const parts = [
    Math.abs(trend) <= FLAT ? `flat over the last ${minutes} min` : `${trend > 0 ? "up" : "down"} ${signedPct(trend).replace(/^[+-]/, "")} over the last ${minutes} min`,
    `${now >= prior ? "above" : "below"} the prior close (${money(prior)})`,
  ];
  if (vwap) parts.push(`${now >= vwap[from - 1] ? "above" : "below"} VWAP (${money(vwap[from - 1])})`);
  if (from >= 5) {
    const opening = day.bars.slice(0, 5);
    const high = Math.max(...opening.map((bar) => bar[1]));
    const low = Math.min(...opening.map((bar) => bar[2]));
    parts.push(`${now > high ? "above" : now < low ? "below" : "inside"} the 9:30–9:35 range (${money(low)}–${money(high)})`);
  }
  const sofar = day.bars.slice(0, from);
  const high = Math.max(...sofar.map((bar) => bar[1]));
  const low = Math.min(...sofar.map((bar) => bar[2]));
  parts.push(
    high - now <= 0.03
      ? "right at the day’s high"
      : now - low <= 0.03
        ? "right at the day’s low"
        : high - now < now - low
          ? `${cents(high - now)} under the day’s high`
          : `${cents(now - low)} above the day’s low`,
  );
  return `At ${clock(from)}: ${parts.join(", ")}.`;
}

/** What price did between the call and its time: levels broken, tested or held, new highs or lows, or a tight range. */
function describeMove(day: QuizDay, from: number, to: number, vwap: number[] | null): string[] {
  const events: string[] = [];
  const levels = levelsAt(day, from);
  const sofar = day.bars.slice(0, from);
  let high = Math.max(...sofar.map((bar) => bar[1]));
  let low = Math.min(...sofar.map((bar) => bar[2]));
  let newHigh = false;
  let newLow = false;
  let vwapDone = false;
  const crossed = new Set<string>();
  let previous = day.bars[from - 1][3];
  for (let minute = from; minute < to; minute += 1) {
    const [, h, l, c] = day.bars[minute];
    if (!newHigh && h > high + 0.005) {
      events.push(`made a new high of the day at ${clock(minute)} (${money(h)})`);
      newHigh = true;
    }
    if (!newLow && l < low - 0.005) {
      events.push(`made a new low of the day at ${clock(minute)} (${money(l)})`);
      newLow = true;
    }
    high = Math.max(high, h);
    low = Math.min(low, l);
    if (vwap && !vwapDone) {
      const before = vwap[minute - 1];
      const after = vwap[minute];
      if (previous < before && c > after) {
        events.push(`crossed above VWAP at ${clock(minute)}`);
        vwapDone = true;
      } else if (previous > before && c < after) {
        events.push(`crossed below VWAP at ${clock(minute)}`);
        vwapDone = true;
      }
    }
    for (const level of levels) {
      if (crossed.has(level.key)) continue;
      if (previous < level.price && c > level.price) {
        events.push(`closed above ${level.name} (${money(level.price)}) at ${clock(minute)}`);
        crossed.add(level.key);
      } else if (previous > level.price && c < level.price) {
        events.push(`closed below ${level.name} (${money(level.price)}) at ${clock(minute)}`);
        crossed.add(level.key);
      } else if (previous < level.price && h >= level.price - 0.03 && c < level.price - 0.03) {
        events.push(`tested ${level.name} (${money(level.price)}) at ${clock(minute)} and was turned back`);
        crossed.add(level.key);
      } else if (previous > level.price && l <= level.price + 0.03 && c > level.price + 0.03) {
        events.push(`dipped to ${level.name} (${money(level.price)}) at ${clock(minute)} and held`);
        crossed.add(level.key);
      }
    }
    previous = c;
  }
  const window = day.bars.slice(from, to);
  const top = Math.max(...window.map((bar) => bar[1]));
  const bottom = Math.min(...window.map((bar) => bar[2]));
  const out = events.slice(0, 3);
  if (out.length === 0) out.push(`stayed in a ${cents(top - bottom)} range (${money(bottom)}–${money(top)}) without breaking a key level`);
  out.push(`finished at ${money(day.bars[to - 1][3])}`);
  return out;
}

function inDeck(kinds: string[], deck: Deck): boolean {
  if (deck === "mix") return true;
  const unpredictable = kinds.some((kind) => UNPREDICTABLE.has(kind));
  return deck === "choppy" ? unpredictable : !unpredictable;
}

function shuffle<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type Bucket = { dim: Dim; value: string; tally: Tally };

/** Accuracy per setup. */
function buckets(calls: CallRecord[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const record of calls) {
    for (const { dim } of DIMS) {
      const value = String(record.setup[dim]);
      const key = `${dim}:${value}`;
      const bucket = map.get(key) ?? { dim, value, tally: { answered: 0, correct: 0 } };
      bucket.tally = bump(bucket.tally, record.right ? 1 : 0);
      map.set(key, bucket);
    }
  }
  return [...map.values()];
}

/** Setups with enough calls that are below her overall accuracy, worst first. */
function weakSpots(calls: CallRecord[]): Bucket[] {
  const overall = calls.length ? calls.filter((record) => record.right).length / calls.length : 0;
  return buckets(calls)
    .filter((bucket) => bucket.tally.answered >= MIN_SAMPLE && bucket.value !== "none" && bucket.tally.correct / bucket.tally.answered < overall)
    .sort((a, b) => a.tally.correct / a.tally.answered - b.tally.correct / b.tally.answered || b.tally.answered - a.tally.answered);
}

/** Recent calls in one spot: how many of the last 10 were right. */
function recentInSpot(calls: CallRecord[], drill: Drill): Tally {
  const recent = calls.filter((record) => String(record.setup[drill.dim]) === drill.value).slice(-10);
  return { answered: recent.length, correct: recent.filter((record) => record.right).length };
}

export function QuizApp() {
  const [index, setIndex] = useState<QuizIndex | null>(null);
  const [day, setDay] = useState<QuizDay | null>(null);
  const [cursor, setCursor] = useState(WARMUP);
  const [picks, setPicks] = useState<Partial<Record<number, Call>>>({});
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [score, setScore] = useState<Tally>({ answered: 0, correct: 0 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  /** The row the keyboard's ↑ / F / ↓ keys fill in. */
  const [keyRow, setKeyRow] = useState(15);
  const [startMode, setStartMode] = useState<StartMode>("open");
  const [deck, setDeck] = useState<Deck>("patterns");
  const [deal, setDeal] = useState<Deal>("any");
  const [drill, setDrill] = useState<Drill | null>(null);
  /** Minutes in the day on screen that match the drill's setup. */
  const [drillMinutes, setDrillMinutes] = useState<number[]>([]);
  const [showLevels, setShowLevels] = useState(true);
  const [tab, setTab] = useState<"play" | "report">("play");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setStats(loadStats());
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { timeframe?: Timeframe; startMode?: StartMode; deck?: Deck; showLevels?: boolean };
      if (prefs.timeframe === "1m" || prefs.timeframe === "5m") setTimeframe(prefs.timeframe);
      if (prefs.startMode === "open" || prefs.startMode === "random") setStartMode(prefs.startMode);
      if (prefs.deck === "patterns" || prefs.deck === "choppy" || prefs.deck === "mix") setDeck(prefs.deck);
      if (typeof prefs.showLevels === "boolean") setShowLevels(prefs.showLevels);
    } catch {
      /* ignore */
    }
    fetch("/quiz/index.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: QuizIndex) => setIndex(body))
      .catch(() => setError("Couldn’t load the quiz days. Refresh to try again."));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ timeframe, startMode, deck, showLevels }));
    } catch {
      /* ignore */
    }
  }, [timeframe, startMode, deck, showLevels]);

  const vwap = useMemo(() => (day ? vwapSeries(day) : null), [day]);

  /** 9:45, or with Random time any 5-minute mark from 10:00 to 3:30, so there's always 30 minutes left to call. */
  function startAt(next: QuizDay): number {
    if (startMode === "open") return WARMUP;
    const slots = Math.max(1, Math.floor((next.bars.length - 30 - 30) / 5) + 1);
    return 30 + 5 * Math.floor(Math.random() * slots);
  }

  function startDay(next: QuizDay, at?: number, matches: number[] = []) {
    setDay(next);
    setCursor(at ?? startAt(next));
    setDrillMinutes(matches);
    setPicks({});
    setReveal(null);
    setScore({ answered: 0, correct: 0 });
    setError("");
  }

  async function fetchDay(date: string): Promise<QuizDay> {
    const response = await fetch(`/quiz/${date}.json`);
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as QuizDay;
  }

  /** Deal the next day by the chosen mode: any day in the deck, a day with moments that match the drill, or a missed day. */
  async function newDay(mode: Deal = deal, focus: Drill | null = drill, chosenDeck: Deck = deck) {
    if (!index || index.days.length === 0) return;
    setNotice("");
    const recent = new Set((stats?.days ?? []).slice(-20).map((entry) => entry.date));
    const pool = index.days.filter((entry) => inDeck(entry.kinds, chosenDeck));
    const fresh = pool.filter((entry) => !recent.has(entry.date) && entry.date !== day?.date);
    try {
      if (mode === "missed") {
        const missed = (stats?.days ?? []).filter((entry) => entry.answered >= 3 && entry.correct / entry.answered < 0.5).map((entry) => entry.date);
        const unique = [...new Set(missed)].filter((date) => date !== day?.date && index.days.some((entry) => entry.date === date));
        if (unique.length) {
          startDay(await fetchDay(unique[Math.floor(Math.random() * unique.length)]));
          return;
        }
        setNotice("No missed days yet (days under 50% with at least 3 calls). Dealing any day.");
      }
      if (mode === "drill" && focus) {
        // Look through up to 10 days for moments that match the setup being drilled.
        const order = shuffle(fresh.length ? fresh : pool).slice(0, 10);
        for (const entry of order) {
          const next = await fetchDay(entry.date);
          const series = vwapSeries(next);
          const matches: number[] = [];
          for (let minute = WARMUP; minute + 5 <= next.bars.length; minute += 5) {
            if (String(setupAt(next, minute, series)[focus.dim]) === focus.value) matches.push(minute);
          }
          if (matches.length) {
            startDay(next, matches[0], matches);
            return;
          }
        }
        setNotice(`No day in this deck has “${spotName(focus.dim, focus.value)}”. Try the Mix deck. Dealing any day.`);
      }
      const choices = fresh.length ? fresh : pool.length ? pool : index.days;
      startDay(await fetchDay(choices[Math.floor(Math.random() * choices.length)].date));
    } catch {
      setError("Couldn’t load that day. Try again.");
    }
  }

  useEffect(() => {
    if (index && !day) void newDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const total = day?.bars.length ?? SESSION;
  const done = !!day && cursor >= total;
  const open = HORIZONS.filter((horizon) => cursor + horizon <= total);
  const chosen = open.filter((horizon) => picks[horizon]);
  const furthest = chosen.length ? Math.max(...chosen) : SKIP;
  const priceNow = day ? day.bars[Math.min(cursor, total) - 1][3] : 0;
  const calls = stats?.calls ?? [];
  const drillProgress = drill ? recentInSpot(calls, drill) : null;
  const mastered = !!drillProgress && drillProgress.answered >= 10 && drillProgress.correct / drillProgress.answered >= MASTERY;

  function choose(horizon: number, call: Call) {
    if (reveal || !open.includes(horizon)) return;
    setKeyRow(horizon);
    setPicks((current) => ({ ...current, [horizon]: current[horizon] === call ? undefined : call }));
  }

  function lockIn() {
    if (!day || reveal || done || chosen.length === 0) return;
    const from = cursor;
    const start = day.bars[from - 1][3];
    const setup = setupAt(day, from, vwap);
    const results: Result[] = chosen.map((horizon) => {
      const to = from + horizon;
      const change = day.bars[to - 1][3] - start;
      const rate = change / start;
      const actual: Call = rate > FLAT ? "up" : rate < -FLAT ? "down" : "flat";
      const call = picks[horizon]!;
      return { horizon, call, to, change, pct: rate, actual, right: call === actual, why: describeMove(day, from, to, vwap) };
    });
    const to = from + Math.max(...chosen);
    setReveal({ from, to, results, skipped: false, clue: describeSetup(day, from, vwap) });
    setCursor(to);
    setPicks({});
    const hits = results.filter((result) => result.right).length;
    setScore((current) => ({ answered: current.answered + results.length, correct: current.correct + hits }));
    setStats((current) => {
      const base = current ?? emptyStats();
      const next: Stats = { ...base, byHorizon: { ...base.byHorizon }, byCall: { ...(base.byCall ?? {}) }, byTimeframe: { ...base.byTimeframe } };
      const records: CallRecord[] = [];
      for (const result of results) {
        const hit = result.right ? 1 : 0;
        next.answered += 1;
        next.correct += hit;
        next.byTimeframe[timeframe] = bump(next.byTimeframe[timeframe], hit);
        next.byHorizon[String(result.horizon)] = bump(next.byHorizon[String(result.horizon)], hit);
        next.byCall![result.call] = bump(next.byCall![result.call], hit);
        records.push({ date: day.date, minute: from, horizon: result.horizon, call: result.call, actual: result.actual, right: result.right, setup });
      }
      next.calls = [...(base.calls ?? []), ...records].slice(-3000);
      saveStats(next);
      return next;
    });
  }

  function skip() {
    if (!day || reveal || done) return;
    const to = Math.min(cursor + SKIP, total);
    setReveal({ from: cursor, to, results: [], skipped: true, clue: "" });
    setCursor(to);
    setPicks({});
  }

  function finishDay() {
    if (!day) return;
    setStats((current) => {
      const base = current ?? emptyStats();
      const next = {
        ...base,
        days: [...base.days, { date: day.date, kinds: day.kinds, answered: score.answered, correct: score.correct, at: new Date().toISOString() }].slice(-500),
      };
      saveStats(next);
      return next;
    });
  }

  function goOn() {
    if (!day) return;
    if (done) {
      finishDay();
      void newDay();
      return;
    }
    if (deal === "drill" && drillMinutes.length) {
      // Jump to the next moment in this day that matches the drill; none left ends the day.
      const next = drillMinutes.find((minute) => minute >= cursor && minute + 5 <= total);
      if (next === undefined) {
        setCursor(total);
        return;
      }
      setCursor(next);
    }
    setReveal(null);
  }

  /** Play the same day again from its start. Calls already scored stay in the all-time numbers. */
  function restartDay() {
    if (!day) return;
    const drilling = deal === "drill" && drillMinutes.length > 0;
    startDay(day, drilling ? drillMinutes[0] : undefined, drilling ? drillMinutes : []);
  }

  function startDrill(next: Drill) {
    setDrill(next);
    setDeal("drill");
    setTab("play");
    // A drill on a type of day needs the deck that has it; every other setup can come from any day.
    const target: Deck = next.dim === "kind" ? (UNPREDICTABLE.has(next.value) ? "choppy" : "patterns") : "mix";
    setDeck(target);
    void newDay("drill", next, target);
  }

  function replayDate(date: string) {
    setTab("play");
    setDeal("any");
    void fetchDay(date)
      .then((next) => startDay(next))
      .catch(() => setError("Couldn’t load that day."));
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (tab !== "play" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (!reveal && !done) {
        if (key === "1" || key === "2" || key === "3") setKeyRow(HORIZONS[Number(key) - 1]);
        else if (key === "arrowup" || key === "h") choose(keyRow, "up");
        else if (key === "f") choose(keyRow, "flat");
        else if (key === "arrowdown" || key === "l") choose(keyRow, "down");
        else if (key === "enter" || key === " ") lockIn();
        else if (key === "s") skip();
        else return;
      } else if (key === "enter" || key === " " || key === "arrowright" || key === "n") {
        goOn();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function resetStats() {
    const fresh = emptyStats();
    saveStats(fresh);
    setStats(fresh);
  }

  const rightNow = reveal ? reveal.results.filter((result) => result.right).length : 0;

  return (
    <div className="shell qz-shell">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">For Dao</p>
          <h1>
            <a href="/">Stock News Calendar</a>
          </h1>
        </div>
        <div className="top-actions">
          <nav className="view-switch" aria-label="Views">
            <a href="/">Calendar</a>
            <a href="/simulator">Simulator</a>
            <a href="/practice">Practice</a>
            <a href="/quiz" aria-current="page">
              Quiz
            </a>
          </nav>
        </div>
      </header>
      <main className="qz-main">
        <section className="qz-head">
          <div>
            <h2>Direction quiz</h2>
            <p className="qz-note">
              A random {index?.symbol ?? "TQQQ"} day from the past year, 9:30 to 4:00. From “now”, call where it’ll be 5, 15 and 30 minutes later: higher,
              flat (within ±{(FLAT * 100).toFixed(2)}%) or lower. Make one call or all three, then reveal. The date shows when the day is over.
            </p>
          </div>
          <dl className="qz-stats">
            <div>
              <dt>All-time</dt>
              <dd>{stats && stats.answered ? `${pct(stats.correct / stats.answered)} right` : "—"}</dd>
              <dd className="qz-small">{stats ? `${stats.correct} of ${stats.answered} calls` : ""}</dd>
            </div>
            <div>
              <dt>This day</dt>
              <dd>{score.answered ? `${pct(score.correct / score.answered)} right` : "—"}</dd>
              <dd className="qz-small">{`${score.correct} of ${score.answered} calls`}</dd>
            </div>
          </dl>
        </section>

        <div className="pr-toggle" role="tablist" aria-label="Quiz">
          <button type="button" role="tab" aria-selected={tab === "play"} aria-pressed={tab === "play"} onClick={() => setTab("play")}>
            Play
          </button>
          <button type="button" role="tab" aria-selected={tab === "report"} aria-pressed={tab === "report"} onClick={() => setTab("report")}>
            Report card
          </button>
        </div>

        {tab === "report" ? (
          <ReportCard stats={stats} onDrill={startDrill} onReplay={replayDate} onReset={resetStats} />
        ) : (
          <>
            <div className="qz-controls">
              <div className="pr-toggle" role="group" aria-label="Days to deal">
                {DECKS.map((entry) => (
                  <button
                    key={entry.deck}
                    type="button"
                    aria-pressed={deck === entry.deck}
                    onClick={() => {
                      setDeck(entry.deck);
                      void newDay(deal, drill, entry.deck);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div className="pr-toggle" role="group" aria-label="How days are picked">
                <button
                  type="button"
                  aria-pressed={deal === "any"}
                  onClick={() => {
                    setDeal("any");
                    void newDay("any");
                  }}
                >
                  Any day
                </button>
                <button
                  type="button"
                  aria-pressed={deal === "drill"}
                  onClick={() => {
                    const worst = weakSpots(calls)[0];
                    if (!worst && !drill) {
                      setNotice(`Make a few more calls first (at least ${MIN_SAMPLE} in a setup) so the report card can find a weak spot.`);
                      return;
                    }
                    startDrill(drill ?? { dim: worst.dim, value: worst.value });
                  }}
                >
                  Drill my weak spot
                </button>
                <button
                  type="button"
                  aria-pressed={deal === "missed"}
                  onClick={() => {
                    setDeal("missed");
                    void newDay("missed");
                  }}
                >
                  Days I missed
                </button>
              </div>
            </div>
            <div className="qz-controls">
              <div className="pr-toggle" role="group" aria-label="Chart timeframe">
                {(["1m", "5m"] as Timeframe[]).map((value) => (
                  <button key={value} type="button" aria-pressed={timeframe === value} onClick={() => setTimeframe(value)}>
                    {value === "1m" ? "1 min" : "5 min"}
                  </button>
                ))}
              </div>
              <div className="pr-toggle" role="group" aria-label="Start each day at">
                <button type="button" aria-pressed={startMode === "open"} onClick={() => setStartMode("open")}>
                  Start 9:45
                </button>
                <button type="button" aria-pressed={startMode === "random"} onClick={() => setStartMode("random")}>
                  Start at a random time
                </button>
              </div>
              <div className="pr-toggle" role="group" aria-label="Day">
                <button type="button" aria-pressed={showLevels} onClick={() => setShowLevels((current) => !current)}>
                  Levels
                </button>
                <button type="button" onClick={restartDay} disabled={!day}>
                  Restart this day
                </button>
                <button type="button" onClick={() => void newDay()} disabled={!index}>
                  New day
                </button>
              </div>
            </div>

            {deal === "drill" && drill ? (
              <div className={mastered ? "qz-drill qz-drill-done" : "qz-drill"}>
                <p>
                  <b>Drilling: {spotName(drill.dim, drill.value)}.</b> The chart jumps to moments with this setup.{" "}
                  {drillProgress && drillProgress.answered
                    ? `Last ${drillProgress.answered} calls here: ${drillProgress.correct} right (${pct(drillProgress.correct / drillProgress.answered)}).`
                    : "No calls here yet."}{" "}
                  {mastered ? "You’ve got the hang of this one." : `Goal: ${pct(MASTERY)} of your last 10.`}
                </p>
                {mastered ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      const next = weakSpots(calls).find((bucket) => !(bucket.dim === drill.dim && bucket.value === drill.value));
                      if (next) startDrill({ dim: next.dim, value: next.value });
                      else setNotice("No other weak spots right now.");
                    }}
                  >
                    Drill the next weak spot
                  </button>
                ) : null}
              </div>
            ) : null}
            {notice ? <p className="qz-note">{notice}</p> : null}
            {error ? <p className="qz-error">{error}</p> : null}
            {!day ? <p className="qz-note">Loading a day…</p> : null}

            <div className="qz-board">
              <div className="qz-charts">
                {day ? (
                  <>
                    <DailyContext day={day} done={done} />
                    <IntradayChart
                      day={day}
                      cursor={cursor}
                      timeframe={timeframe}
                      ahead={reveal ? 0 : furthest}
                      reveal={reveal}
                      vwap={showLevels ? vwap : null}
                      levels={showLevels ? fixedLevels(day) : []}
                    />
                    {showLevels ? (
                      <p className="qz-legend">
                        <span className="qz-key qz-key-close">Prior close</span>
                        <span className="qz-key qz-key-prior">Prior day high / low</span>
                        {day.pre ? <span className="qz-key qz-key-pre">Pre-market high / low</span> : null}
                        {vwap ? <span className="qz-key qz-key-vwap">VWAP</span> : null}
                      </p>
                    ) : null}
                    <div className="qz-now">
                      <strong>{clock(Math.min(cursor, total))}</strong>
                      <span>
                        {day.symbol} ${priceNow.toFixed(2)} · day {signedPct(priceNow / day.before[day.before.length - 1][3] - 1)} vs prior close
                        {vwap ? ` · VWAP ${money(vwap[Math.min(cursor, total) - 1])}` : ""}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
              <div className="qz-side">
                {day && !reveal && !done ? (
                  <div className="qz-ask">
                    <p className="qz-q">Where will {day.symbol} be?</p>
                    <p className="qz-note">
                      Flat = within ±${(priceNow * FLAT).toFixed(2)} of ${priceNow.toFixed(2)}.
                    </p>
                    {HORIZONS.map((horizon) => {
                      const available = open.includes(horizon);
                      return (
                        <div key={horizon} className={keyRow === horizon ? "qz-row qz-row-key" : "qz-row"}>
                          <p className="qz-row-label">
                            <span className={`qz-tag qz-tag-${horizon}`}>{horizon}m</span> <b>{horizon} min ahead</b> · at{" "}
                            {available ? clock(cursor + horizon) : "after the close"}
                          </p>
                          <div className="qz-picks" role="group" aria-label={`${horizon} minutes ahead`}>
                            {CALLS.map(({ call, label, cls }) => (
                              <button
                                key={call}
                                type="button"
                                className={`qz-pick ${cls}`}
                                aria-pressed={picks[horizon] === call}
                                disabled={!available}
                                onClick={() => choose(horizon, call)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <button type="button" className="qz-next" disabled={chosen.length === 0} onClick={lockIn}>
                      {chosen.length === 0
                        ? "Reveal my calls (pick one first)"
                        : `Reveal my ${chosen.length} call${chosen.length === 1 ? "" : "s"} (to ${clock(cursor + furthest)})`}
                    </button>
                    <button type="button" className="text-btn qz-skip" onClick={skip}>
                      Skip ahead {SKIP} min (no call)
                    </button>
                    <p className="qz-keys">Keys: 1 2 3 pick a row · ↑ higher · F flat · ↓ lower · Enter reveal · S skip</p>
                  </div>
                ) : null}
                {day && (reveal || done) ? (
                  <div
                    className={`qz-result ${
                      !reveal || reveal.skipped ? "" : rightNow === reveal.results.length ? "qz-right" : rightNow === 0 ? "qz-wrong" : ""
                    }`}
                  >
                    {reveal ? (
                      <>
                        <p className="qz-q">{reveal.skipped ? `Skipped to ${clock(reveal.to)}` : `${rightNow} of ${reveal.results.length} right`}</p>
                        {reveal.clue ? <p className="qz-clue">{reveal.clue}</p> : null}
                        {reveal.results.map((result) => (
                          <div key={result.horizon} className="qz-call">
                            <p className={result.right ? "qz-line qz-line-right" : "qz-line qz-line-wrong"}>
                              <span className={`qz-tag qz-tag-${result.horizon}`}>{result.horizon}m</span> {result.right ? "✓" : "✗"}{" "}
                              <b>{result.horizon} min</b> ({clock(result.to)}): you said {CALL_WORD[result.call]}, it was {CALL_WORD[result.actual]}{" "}
                              {signedCents(result.change)} ({signedPct(result.pct)})
                            </p>
                            <p className="qz-why">Why: it {result.why.join(", then ")}.</p>
                          </div>
                        ))}
                      </>
                    ) : null}
                    {done ? (
                      <div className="qz-done">
                        <h3>{prettyDate(day.date)}</h3>
                        <p className="qz-note">
                          {day.kinds.join(" · ")} on the daily chart. You were {score.answered ? pct(score.correct / score.answered) : "—"} right ({score.correct}{" "}
                          of {score.answered}).
                        </p>
                      </div>
                    ) : null}
                    <button type="button" className="qz-next" onClick={goOn}>
                      {done ? "Next day" : deal === "drill" ? "Next moment like this" : "Next"}
                    </button>
                    <p className="qz-keys">Key: Enter or Space for {done ? "the next day" : "the next call"}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ReportCard({
  stats,
  onDrill,
  onReplay,
  onReset,
}: {
  stats: Stats | null;
  onDrill: (drill: Drill) => void;
  onReplay: (date: string) => void;
  onReset: () => void;
}) {
  const calls = stats?.calls ?? [];
  if (!stats || calls.length === 0) {
    return (
      <section className="qz-report">
        <h3>Report card</h3>
        <p className="qz-note">Make some calls first. Every call is saved with its setup, and this page shows where you go wrong and why.</p>
      </section>
    );
  }
  const overall = calls.filter((record) => record.right).length / calls.length;
  const weak = weakSpots(calls).slice(0, 3);
  const all = buckets(calls);
  const matrix = (["up", "flat", "down"] as Call[]).map((call) => {
    const mine = calls.filter((record) => record.call === call);
    return { call, total: mine.length, byActual: (["up", "flat", "down"] as Call[]).map((actual) => mine.filter((record) => record.actual === actual).length) };
  });
  const missedDays = [...new Map(stats.days.filter((entry) => entry.answered >= 3).map((entry) => [entry.date, entry])).values()]
    .sort((a, b) => a.correct / a.answered - b.correct / b.answered)
    .slice(0, 6);

  return (
    <section className="qz-report">
      <h3>Report card</h3>
      <p className="qz-note">
        {calls.length} calls, {pct(overall)} right. Guessing at random gets about 33%. A setup needs {MIN_SAMPLE} calls before it’s judged.
      </p>

      <h4>Where you go wrong</h4>
      {weak.length === 0 ? <p className="qz-note">No weak spots yet: nothing with {MIN_SAMPLE}+ calls is below your overall accuracy.</p> : null}
      {weak.map((bucket) => {
        const misses = calls.filter((record) => String(record.setup[bucket.dim]) === bucket.value && !record.right);
        const counts = new Map<string, number>();
        for (const record of misses) counts.set(`${record.call}>${record.actual}`, (counts.get(`${record.call}>${record.actual}`) ?? 0) + 1);
        const [top, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
        const [said, was] = top.split(">") as [Call, Call];
        return (
          <div key={`${bucket.dim}:${bucket.value}`} className="qz-weak">
            <p className="qz-line">
              <b>{spotName(bucket.dim, bucket.value)}</b>: {pct(bucket.tally.correct / bucket.tally.answered)} right ({bucket.tally.correct} of{" "}
              {bucket.tally.answered}).
            </p>
            {top ? (
              <p className="qz-why">
                Most common miss: you said {CALL_WORD[said]} and it went {CALL_WORD[was]} ({topCount} of {misses.length} misses). {lesson(bucket, said, was)}
              </p>
            ) : null}
            <button type="button" className="text-btn" onClick={() => onDrill({ dim: bucket.dim, value: bucket.value })}>
              Drill this
            </button>
          </div>
        );
      })}

      <h4>Your calls vs what happened</h4>
      <table className="qz-table">
        <thead>
          <tr>
            <th>You said</th>
            <th>Went higher</th>
            <th>Stayed flat</th>
            <th>Went lower</th>
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row.call}>
              <td>
                {CALL_WORD[row.call]} ({row.total})
              </td>
              {row.byActual.map((count, i) => (
                <td key={i} className={(["up", "flat", "down"] as Call[])[i] === row.call ? "qz-cell-right" : undefined}>
                  {count}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <h4>By setup</h4>
      <div className="qz-dims">
        {DIMS.map(({ dim, label, values }) => {
          const rows = all.filter((bucket) => bucket.dim === dim && bucket.value !== "none").sort((a, b) => b.tally.answered - a.tally.answered);
          if (!rows.length) return null;
          return (
            <div key={dim} className="qz-dim">
              <p className="qz-dim-title">{label}</p>
              <ul>
                {rows.map((bucket) => {
                  const rate = bucket.tally.correct / bucket.tally.answered;
                  const judged = bucket.tally.answered >= MIN_SAMPLE;
                  return (
                    <li key={bucket.value} className={judged && rate < overall ? "qz-low" : judged && rate > overall ? "qz-high" : undefined}>
                      <span>{values[bucket.value] ?? bucket.value}</span>
                      <span>
                        {pct(rate)} of {bucket.tally.answered}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {missedDays.length ? (
        <>
          <h4>Days you missed most</h4>
          <ul className="qz-days">
            {missedDays.map((entry) => (
              <li key={entry.date}>
                <span>
                  {prettyDate(entry.date)} · {entry.kinds.join(", ")} · {pct(entry.correct / entry.answered)} ({entry.correct} of {entry.answered})
                </span>
                <button type="button" className="text-btn" onClick={() => onReplay(entry.date)}>
                  Replay
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <button type="button" className="text-btn" onClick={onReset}>
        Reset report card and accuracy
      </button>
    </section>
  );
}

/** A plain-language hint for the most common miss in a setup. */
function lesson(bucket: Bucket, said: Call, was: Call): string {
  if (said === "flat") return "You expected it to stall here, but it kept moving. Look for a level it can run to before calling Flat.";
  if (was === "flat") return "It stalled instead. Near a level or in a tight range, Flat is often the better call.";
  if (bucket.dim === "trend" && ((bucket.value === "falling" && said === "up") || (bucket.value === "rising" && said === "down")))
    return "You called a turn against the last 15 minutes, and the move kept going. Wait for a level to hold before fading a trend.";
  if (bucket.dim === "extreme" && bucket.value === "high" && said === "up") return "At the day’s high, breakouts here often failed. Wait for a close above it.";
  if (bucket.dim === "extreme" && bucket.value === "low" && said === "down") return "At the day’s low, breakdowns here often bounced. Wait for a close below it.";
  if (bucket.dim === "vwap") return "Price often snaps back toward VWAP when it gets stretched away from it.";
  return "Replay these moments and look at which level price was near when you called.";
}

const W = 1000;

function Candles({ bars, x, y, width }: { bars: Ohlc[]; x: (i: number) => number; y: (price: number) => number; width: number }) {
  return (
    <>
      {bars.map((bar, i) => {
        const [o, h, l, c] = bar;
        const up = c >= o;
        const top = y(Math.max(o, c));
        const bottom = y(Math.min(o, c));
        const cls = up ? "qz-c-up" : "qz-c-down";
        return (
          <g key={i} className={cls}>
            <line x1={x(i)} x2={x(i)} y1={y(h)} y2={y(l)} strokeWidth={Math.max(1, width / 5)} />
            <rect x={x(i) - width / 2} y={top} width={width} height={Math.max(1, bottom - top)} />
          </g>
        );
      })}
    </>
  );
}

function IntradayChart({
  day,
  cursor,
  timeframe,
  ahead,
  reveal,
  vwap,
  levels,
}: {
  day: QuizDay;
  cursor: number;
  timeframe: Timeframe;
  ahead: number;
  reveal: Reveal | null;
  vwap: number[] | null;
  levels: Level[];
}) {
  const H = 420;
  const top = 16;
  const bottom = 44;
  const right = 96;
  const total = day.bars.length;
  const shownCount = Math.min(cursor, total);
  const shown = day.bars.slice(0, shownCount);

  const view = useMemo(() => {
    if (timeframe === "5m") return { bars: aggregate(shown, 5), slots: Math.ceil(SESSION / 5), firstMinute: 0, per: 5 };
    // 1-minute: the last 90 minutes plus room for the furthest call (30 minutes).
    const window = 90;
    const first = Math.max(0, shown.length - window);
    return { bars: shown.slice(first), slots: window + 30, firstMinute: first, per: 1 };
  }, [shown, timeframe]);

  const prices = view.bars.flatMap((bar) => [bar[1], bar[2]]);
  const lowSeen = Math.min(...prices);
  const highSeen = Math.max(...prices);
  const span = highSeen - lowSeen || highSeen * 0.01;
  // Show a level only when it's reasonably near; far away it would squash the candles.
  const near = (price: number) => price >= lowSeen - span * 1.2 && price <= highSeen + span * 1.2;
  const shownLevels = levels.filter((level) => near(level.price));
  const vwapPoints = vwap ? vwap.slice(view.firstMinute, shownCount) : [];
  const vwapNear = vwapPoints.filter(near);
  let min = Math.min(lowSeen, ...shownLevels.map((level) => level.price), ...vwapNear);
  let max = Math.max(highSeen, ...shownLevels.map((level) => level.price), ...vwapNear);
  const pad = (max - min || max * 0.01) * 0.08;
  min -= pad;
  max += pad;
  const plotW = W - right;
  const step = plotW / view.slots;
  const x = (i: number) => step * (i + 0.5);
  const y = (price: number) => top + ((max - price) / (max - min)) * (H - top - bottom);
  const clampY = (price: number) => Math.min(H - bottom, Math.max(top, y(price)));
  const width = Math.max(1.5, Math.min(14, step * 0.6));
  const nowX = step * view.bars.length;
  const aheadW = Math.min(plotW - nowX, (ahead / view.per) * step);
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) * (max - min)) / 4);
  const timeMarks: number[] = [];
  for (let minute = 0; minute <= SESSION; minute += timeframe === "5m" ? 60 : 30) {
    const slot = (minute - view.firstMinute) / view.per;
    if (slot >= 0 && slot <= view.slots) timeMarks.push(minute);
  }
  const xAt = (minute: number) => ((minute - view.firstMinute) / view.per) * step;
  // Level labels sit on the left, nudged apart so they don't overlap.
  const labelled = [...shownLevels].sort((a, b) => y(a.price) - y(b.price));
  let lastLabel = -Infinity;
  const labelY = labelled.map((level) => {
    const at = Math.max(y(level.price) - 6, lastLabel + 22);
    lastLabel = at;
    return at;
  });
  const vwapPath = vwapPoints.map((value, i) => `${i ? "L" : "M"}${xAt(view.firstMinute + i + 0.5).toFixed(1)} ${clampY(value).toFixed(1)}`).join(" ");

  return (
    <figure className="qz-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${day.symbol} ${timeframe === "5m" ? "5-minute" : "1-minute"} chart up to ${clock(shownCount)}`}>
        {!reveal && cursor < total && ahead > 0 ? <rect className="qz-ahead" x={nowX} y={top} width={Math.max(0, aheadW)} height={H - top - bottom} /> : null}
        {!reveal && cursor < total
          ? HORIZONS.filter((horizon) => cursor + horizon <= total).map((horizon, i) => (
              <g key={horizon}>
                <line className={`qz-mark qz-mark-${horizon}`} x1={xAt(cursor + horizon)} x2={xAt(cursor + horizon)} y1={top} y2={H - bottom} />
                <text className={`qz-marklabel qz-mark-${horizon}`} x={xAt(cursor + horizon) + 4} y={top + 20 + i * 24}>
                  {horizon}m
                </text>
              </g>
            ))
          : null}
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="qz-grid" x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} />
            <text className="qz-tick" x={plotW + 8} y={y(tick) + 5}>
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {timeMarks.map((minute) => (
          <text key={minute} className="qz-tick" x={Math.max(0, xAt(minute))} y={H - 8} textAnchor={xAt(minute) < 40 ? "start" : "middle"}>
            {clock(minute)}
          </text>
        ))}
        {labelled.map((level) => (
          <line key={level.key} className={`qz-level ${level.cls}`} x1={0} x2={plotW} y1={y(level.price)} y2={y(level.price)} />
        ))}
        {vwapPath ? <path className="qz-vwap" d={vwapPath} /> : null}
        <Candles bars={view.bars} x={x} y={y} width={width} />
        {labelled.map((level, i) => (
          <text key={level.key} className={`qz-level-label ${level.cls}`} x={6} y={labelY[i]}>
            {level.label} {level.price.toFixed(2)}
          </text>
        ))}
        {reveal
          ? reveal.results.map((result, i) => (
              <g key={result.horizon}>
                <line
                  className={`qz-move qz-move-${result.horizon}`}
                  x1={xAt(reveal.from)}
                  x2={xAt(result.to)}
                  y1={y(day.bars[reveal.from - 1][3])}
                  y2={y(day.bars[result.to - 1][3])}
                />
                <circle className={`qz-dot-${result.horizon}`} cx={xAt(result.to)} cy={y(day.bars[result.to - 1][3])} r={7} />
                <text className={`qz-taglabel qz-dot-${result.horizon}`} x={xAt(result.to) + 9} y={y(day.bars[result.to - 1][3]) + 6 + (i - 1) * 22}>
                  {result.horizon}m {result.right ? "✓" : "✗"}
                </text>
              </g>
            ))
          : null}
        <line className="qz-nowline" x1={nowX} x2={nowX} y1={top} y2={H - bottom} />
      </svg>
    </figure>
  );
}

function DailyContext({ day, done }: { day: QuizDay; done: boolean }) {
  const H = 150;
  const bars = done ? [...day.before, day.day, ...day.after] : day.before;
  const slots = day.before.length + 1 + day.after.length;
  const prices = bars.flatMap((bar) => [bar[1], bar[2]]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const step = W / slots;
  const x = (i: number) => step * (i + 0.5);
  const y = (price: number) => 8 + ((max - price) / (max - min || 1)) * (H - 16);
  const dayX = x(day.before.length);
  return (
    <figure className="qz-daily">
      <figcaption>Daily chart{done ? ": the quiz day is outlined, then the days after it" : " into this day (dates hidden)"}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={done ? "Daily candles before, on and after the quiz day" : "Daily candles leading into the quiz day"}>
        <rect className={done ? "qz-dayslot-done" : "qz-dayslot"} x={dayX - step / 2} y={2} width={step} height={H - 4} />
        <Candles bars={bars} x={x} y={y} width={Math.max(2, step * 0.6)} />
      </svg>
    </figure>
  );
}
