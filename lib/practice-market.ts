export type Ohlc = [number, number, number, number];

export type PracticeDay = {
  date: string;
  start: number;
  /** Thirty real 1-minute bars, 9:30 through 9:59 ET. */
  tqqq: Ohlc[];
  sqqq: Ohlc[];
  /** Real daily bar for the 1D chart. */
  daily?: { tqqq: Ohlc; sqqq: Ohlc };
};

export type PracticeMarket = {
  source: string;
  fetchedAt: string;
  tickers: ["TQQQ", "SQQQ"];
  session: string;
  days: PracticeDay[];
};

export type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
    }>;
  };
};

const MORNING_OPEN = 9 * 60 + 30;
const MORNING_BARS = 30;
const CHUNK_SECONDS = 7 * 24 * 60 * 60;
const LOOKBACK_SECONDS = 32 * 24 * 60 * 60;
export const MORNING_MINUTES = MORNING_BARS;

function roundPx(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function etParts(unix: number): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(unix * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minute: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

async function fetchChart(url: string, ticker: string): Promise<YahooChart | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (response.status === 422) return null;
    if (response.ok) return (await response.json()) as YahooChart;
    if (response.status !== 429 && response.status < 500) throw new Error(`Yahoo ${ticker} returned ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(`Yahoo ${ticker} did not respond`);
}

function quoteBar(chart: YahooChart, index: number): Ohlc | null {
  const quote = chart.chart?.result?.[0]?.indicators?.quote?.[0];
  const open = quote?.open?.[index];
  const high = quote?.high?.[index];
  const low = quote?.low?.[index];
  const close = quote?.close?.[index];
  if (open == null || high == null || low == null || close == null) return null;
  return [roundPx(open), roundPx(Math.max(high, open, close)), roundPx(Math.min(low, open, close)), roundPx(close)];
}

export type TimedBar = { t: number; ohlc: Ohlc };

/** 9:30–9:59 bars inside the requested window. A timestamp outside that window is ignored. */
export function morningBars(chart: YahooChart, period1 = 0, period2 = Number.POSITIVE_INFINITY): TimedBar[] {
  const times = chart.chart?.result?.[0]?.timestamp ?? [];
  const bars: TimedBar[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const time = times[i];
    if (time < period1 || time >= period2) continue;
    const when = etParts(time);
    if (when.minute < MORNING_OPEN || when.minute >= MORNING_OPEN + MORNING_BARS) continue;
    const ohlc = quoteBar(chart, i);
    if (ohlc) bars.push({ t: time, ohlc });
  }
  return bars;
}

export function dailyBars(chart: YahooChart): Array<{ date: string; ohlc: Ohlc }> {
  const times = chart.chart?.result?.[0]?.timestamp ?? [];
  const bars: Array<{ date: string; ohlc: Ohlc }> = [];
  for (let i = 0; i < times.length; i += 1) {
    const ohlc = quoteBar(chart, i);
    if (ohlc) bars.push({ date: etParts(times[i]).date, ohlc });
  }
  return bars;
}

function byMinute(bars: TimedBar[]): Map<string, { start: number; minutes: Map<number, Ohlc> }> {
  const days = new Map<string, { start: number; minutes: Map<number, Ohlc> }>();
  for (const bar of bars) {
    const when = etParts(bar.t);
    const day = days.get(when.date) ?? { start: 0, minutes: new Map<number, Ohlc>() };
    day.minutes.set(when.minute, bar.ohlc);
    if (when.minute === MORNING_OPEN) day.start = bar.t;
    days.set(when.date, day);
  }
  return days;
}

/** Days that have all 30 morning minutes for both tickers, plus a real daily bar for each. */
export function assemblePracticeDays(
  tqqqBars: TimedBar[],
  sqqqBars: TimedBar[],
  tqqqDaily: Array<{ date: string; ohlc: Ohlc }>,
  sqqqDaily: Array<{ date: string; ohlc: Ohlc }>,
): PracticeDay[] {
  const left = byMinute(tqqqBars);
  const right = byMinute(sqqqBars);
  const tqqqDay = new Map(tqqqDaily.map((bar) => [bar.date, bar.ohlc]));
  const sqqqDay = new Map(sqqqDaily.map((bar) => [bar.date, bar.ohlc]));
  const days: PracticeDay[] = [];
  for (const [date, tqqq] of left) {
    const sqqq = right.get(date);
    const dailyT = tqqqDay.get(date);
    const dailyS = sqqqDay.get(date);
    if (!sqqq || tqqq.start <= 0 || sqqq.start <= 0 || !dailyT || !dailyS) continue;
    const tqqqMinutes: Ohlc[] = [];
    const sqqqMinutes: Ohlc[] = [];
    let complete = true;
    for (let offset = 0; offset < MORNING_BARS; offset += 1) {
      const minute = MORNING_OPEN + offset;
      const tBar = tqqq.minutes.get(minute);
      const sBar = sqqq.minutes.get(minute);
      if (!tBar || !sBar) {
        complete = false;
        break;
      }
      tqqqMinutes.push(tBar);
      sqqqMinutes.push(sBar);
    }
    if (!complete) continue;
    days.push({ date, start: tqqq.start, tqqq: tqqqMinutes, sqqq: sqqqMinutes, daily: { tqqq: dailyT, sqqq: dailyS } });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

export function isPlayableDay(day: PracticeDay): boolean {
  return day.tqqq?.length === MORNING_BARS && day.sqqq?.length === MORNING_BARS && !!day.daily?.tqqq && !!day.daily?.sqqq;
}

async function fetchMorning(ticker: string, nowSec: number): Promise<TimedBar[]> {
  const bars: TimedBar[] = [];
  const earliest = nowSec - LOOKBACK_SECONDS;
  for (let end = nowSec; end > earliest; end -= CHUNK_SECONDS) {
    const start = Math.max(earliest, end - CHUNK_SECONDS);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&period1=${start}&period2=${end}&includePrePost=false`;
    const chart = await fetchChart(url, ticker);
    if (!chart) break;
    bars.push(...morningBars(chart, start, end));
  }
  return bars;
}

/** Keep every saved session. A newer fetch replaces the same date and adds days the old file does not have. */
export function mergePracticeDays(older: PracticeDay[], newer: PracticeDay[]): PracticeDay[] {
  const byDate = new Map<string, PracticeDay>();
  for (const day of older) if (day?.date) byDate.set(day.date, day);
  for (const day of newer) if (day?.date) byDate.set(day.date, day);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchPracticeMarket(now = new Date()): Promise<PracticeMarket> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const [tqqqBars, sqqqBars, tqqqDailyChart, sqqqDailyChart] = await Promise.all([
    fetchMorning("TQQQ", nowSec),
    fetchMorning("SQQQ", nowSec),
    fetchChart("https://query1.finance.yahoo.com/v8/finance/chart/TQQQ?interval=1d&range=3mo&includePrePost=false", "TQQQ"),
    fetchChart("https://query1.finance.yahoo.com/v8/finance/chart/SQQQ?interval=1d&range=3mo&includePrePost=false", "SQQQ"),
  ]);
  if (!tqqqDailyChart || !sqqqDailyChart) throw new Error("Yahoo did not return daily bars");
  const days = assemblePracticeDays(tqqqBars, sqqqBars, dailyBars(tqqqDailyChart), dailyBars(sqqqDailyChart));
  if (days.length < 5) throw new Error("Not enough complete TQQQ/SQQQ mornings");
  return {
    source: "Yahoo Finance chart API v8 (1-minute bars, 9:30–10:00 ET)",
    fetchedAt: now.toISOString(),
    tickers: ["TQQQ", "SQQQ"],
    session: "09:30-10:00 America/New_York",
    days,
  };
}
