export type Ohlc = [number, number, number, number];

export type PracticeDay = {
  date: string;
  start: number;
  tqqq: Ohlc[];
  sqqq: Ohlc[];
};

export type PracticeMarket = {
  source: string;
  fetchedAt: string;
  tickers: ["TQQQ", "SQQQ"];
  session: string;
  days: PracticeDay[];
};

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }> };
    }>;
  };
};

const SESSION_OPEN = 9 * 60 + 30;
const SESSION_CLOSE = 16 * 60;

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

async function fetchChart(ticker: string, interval: string, range: string): Promise<YahooChart> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}&includePrePost=false`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Yahoo ${ticker} ${interval} returned ${response.status}`);
  return (await response.json()) as YahooChart;
}

function sessionBars(chart: YahooChart): Map<string, { start: number; bars: Ohlc[] }> {
  const result = chart.chart?.result?.[0];
  const times = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const byDay = new Map<string, { start: number; bars: Ohlc[] }>();
  for (let i = 0; i < times.length; i += 1) {
    const open = quote?.open?.[i];
    const high = quote?.high?.[i];
    const low = quote?.low?.[i];
    const close = quote?.close?.[i];
    if (open == null || high == null || low == null || close == null) continue;
    const when = etParts(times[i]);
    if (when.minute < SESSION_OPEN || when.minute >= SESSION_CLOSE) continue;
    const day = byDay.get(when.date) ?? { start: times[i], bars: [] };
    if (when.minute === SESSION_OPEN) day.start = times[i];
    const top = Math.max(high, open, close);
    const bottom = Math.min(low, open, close);
    day.bars.push([roundPx(open), roundPx(top), roundPx(bottom), roundPx(close)]);
    byDay.set(when.date, day);
  }
  return byDay;
}

/** Keep every saved session. A newer fetch replaces the same date and adds days the old file does not have. */
export function mergePracticeDays(older: PracticeDay[], newer: PracticeDay[]): PracticeDay[] {
  const byDate = new Map<string, PracticeDay>();
  for (const day of older) if (day?.date) byDate.set(day.date, day);
  for (const day of newer) if (day?.date) byDate.set(day.date, day);
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export async function fetchPracticeMarket(now = new Date()): Promise<PracticeMarket> {
  const [tqqq, sqqq] = await Promise.all([
    fetchChart("TQQQ", "5m", "60d"),
    fetchChart("SQQQ", "5m", "60d"),
  ]);
  await Promise.all([fetchChart("TQQQ", "1d", "6mo"), fetchChart("SQQQ", "1d", "6mo")]);
  const left = sessionBars(tqqq);
  const right = sessionBars(sqqq);
  const days: PracticeDay[] = [];
  for (const [date, tqqqDay] of left) {
    const sqqqDay = right.get(date);
    if (!sqqqDay || tqqqDay.bars.length !== 78 || sqqqDay.bars.length !== 78) continue;
    days.push({ date, start: tqqqDay.start, tqqq: tqqqDay.bars, sqqq: sqqqDay.bars });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 5) throw new Error("Not enough complete TQQQ/SQQQ sessions");
  return {
    source: "Yahoo Finance chart API v8 (5-minute bars, regular hours)",
    fetchedAt: now.toISOString(),
    tickers: ["TQQQ", "SQQQ"],
    session: "09:30-16:00 America/New_York",
    days,
  };
}
