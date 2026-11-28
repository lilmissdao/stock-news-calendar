/**
 * Builds the Direction Quiz days: from the past year of TQQQ daily bars it picks turning points (daily swing highs
 * and lows), big trend days, and unpredictable days (choppy days that swung both ways and closed near the open,
 * and inside days), then saves each one's full regular session (9:30–16:00 ET) of 1-minute bars plus the
 * daily bars around it to public/quiz/<date>.json, and the list to public/quiz/index.json.
 *
 * Auth: Alpaca's APCA-API-KEY-ID and APCA-API-SECRET-KEY headers, from APCA_API_KEY_ID / APCA_API_SECRET_KEY when set,
 * otherwise added by the cloud environment's network secrets. The free plan serves SIP data once it's 15 minutes old.
 * Existing day files are kept; run with --all to rebuild them.
 */
import { access, mkdir, writeFile } from "node:fs/promises";

const SYMBOL = "TQQQ";
const API = `https://data.alpaca.markets/v2/stocks/${SYMBOL}/bars`;
/** Sessions on each side a daily low (high) must beat to count as a swing low (high). */
const SWING = 5;
/** Daily candles shown before the quiz day, and after it once the day is over. */
const BEFORE = 40;
const AFTER = 10;

type Bar = { t: string; o: number; h: number; l: number; c: number; v?: number };
type Ohlc = [number, number, number, number];

function headers(): Record<string, string> {
  const id = process.env.APCA_API_KEY_ID;
  const secret = process.env.APCA_API_SECRET_KEY;
  return id && secret ? { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": secret } : {};
}

async function bars(timeframe: string, start: string, end: string): Promise<Bar[]> {
  const out: Bar[] = [];
  let token: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const params = new URLSearchParams({ timeframe, start, end, limit: "10000", adjustment: "split", feed: "sip", sort: "asc" });
    if (token) params.set("page_token", token);
    const response = await fetch(`${API}?${params}`, { headers: headers() });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      page -= 1;
      continue;
    }
    if (!response.ok) throw new Error(`Alpaca ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { bars?: Bar[] | null; next_page_token?: string | null };
    out.push(...(body.bars ?? []));
    token = body.next_page_token ?? null;
    if (!token) return out;
  }
  throw new Error("Too many pages");
}

const px = (value: number) => Math.round(value * 100) / 100;
const ohlc = (bar: Bar): Ohlc => [px(bar.o), px(bar.h), px(bar.l), px(bar.c)];

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ET calendar date and minutes after midnight for a bar's UTC time. */
function et(iso: string): { date: string; minute: number } {
  const parts = Object.fromEntries(etFormat.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour) % 24;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: hour * 60 + Number(parts.minute) };
}

async function exists(path: URL): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rebuild = process.argv.includes("--all");
  const now = Date.now();
  const end = new Date(now - 20 * 60 * 1000).toISOString();
  const start = new Date(now - 430 * 24 * 3600 * 1000).toISOString();
  const daily = (await bars("1Day", start, end)).map((bar) => ({ ...bar, date: et(bar.t).date }));
  const yearAgo = new Date(now - 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const today = et(new Date(now).toISOString()).date;

  // Big trend days: the top 10% of the year by the size of the day's body.
  const moves = daily.filter((bar) => bar.date >= yearAgo).map((bar) => Math.abs(bar.c - bar.o) / bar.o);
  const cut = [...moves].sort((a, b) => b - a)[Math.max(0, Math.floor(moves.length * 0.1) - 1)] ?? Infinity;
  // Choppy days: a full-sized range (at least the year's median) but a small body, so it went both ways.
  const ranges = daily.filter((bar) => bar.date >= yearAgo).map((bar) => (bar.h - bar.l) / bar.o);
  const medianRange = [...ranges].sort((a, b) => a - b)[Math.floor(ranges.length / 2)] ?? Infinity;

  const picks: { index: number; kinds: string[] }[] = [];
  daily.forEach((bar, index) => {
    if (bar.date < yearAgo || bar.date >= today || index < BEFORE) return;
    const kinds: string[] = [];
    const around = daily.slice(index - SWING, index + SWING + 1);
    if (index + SWING < daily.length) {
      if (around.every((other) => other === bar || other.l > bar.l)) kinds.push("Swing low");
      if (around.every((other) => other === bar || other.h < bar.h)) kinds.push("Swing high");
    }
    if (Math.abs(bar.c - bar.o) / bar.o >= cut) kinds.push(bar.c > bar.o ? "Big up day" : "Big down day");
    if (!kinds.length) {
      const range = bar.h - bar.l;
      const prior = daily[index - 1];
      if (range / bar.o >= medianRange && Math.abs(bar.c - bar.o) <= range * 0.25) kinds.push("Choppy day");
      else if (prior && bar.h < prior.h && bar.l > prior.l) kinds.push("Inside day");
    }
    if (kinds.length) picks.push({ index, kinds });
  });

  const dir = new URL("../public/quiz/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const index: { date: string; kinds: string[]; bars: number }[] = [];
  for (const pick of picks) {
    const day = daily[pick.index];
    const file = new URL(`${day.date}.json`, dir);
    if (!rebuild && (await exists(file))) {
      index.push({ date: day.date, kinds: pick.kinds, bars: -1 });
      continue;
    }
    const all = (await bars("1Min", `${day.date}T08:00:00Z`, `${day.date}T23:59:00Z`)).map((bar) => ({ bar, at: et(bar.t) }));
    const minutes = all.filter(({ at }) => at.date === day.date && at.minute >= 9 * 60 + 30 && at.minute < 16 * 60);
    // Pre-market: 4:00 to 9:29 ET.
    const early = all.filter(({ at }) => at.date === day.date && at.minute >= 4 * 60 && at.minute < 9 * 60 + 30);
    // Early-close days (around holidays) are shorter; skip a day missing most of its session.
    if (minutes.length < 200) {
      console.log(`${day.date}: only ${minutes.length} minutes, skipped`);
      continue;
    }
    const record = {
      date: day.date,
      symbol: SYMBOL,
      kinds: pick.kinds,
      start: Math.floor(Date.parse(minutes[0].bar.t) / 1000),
      /** One bar per minute from 9:30 ET; a minute with no trades repeats the last close. */
      bars: fillGaps(minutes.map(({ bar, at }) => ({ minute: at.minute - (9 * 60 + 30), value: ohlc(bar) }))),
      /** Shares traded each minute, lined up with `bars` (0 for a minute with no trades), for VWAP. */
      vol: volumes(minutes.map(({ bar, at }) => ({ minute: at.minute - (9 * 60 + 30), volume: bar.v ?? 0 }))),
      /** Pre-market high and low (4:00–9:29 ET), or null if nothing traded. */
      pre: early.length ? [px(Math.max(...early.map(({ bar }) => bar.h))), px(Math.min(...early.map(({ bar }) => bar.l)))] : null,
      before: daily.slice(pick.index - BEFORE, pick.index).map(ohlc),
      day: ohlc(day),
      after: daily.slice(pick.index + 1, pick.index + 1 + AFTER).map(ohlc),
      source: "Alpaca SIP 1-minute and daily bars, split-adjusted",
    };
    await writeFile(file, `${JSON.stringify(record)}\n`);
    index.push({ date: day.date, kinds: pick.kinds, bars: record.bars.length });
    console.log(`${day.date}: ${pick.kinds.join(", ")}, ${record.bars.length} minutes`);
  }
  await writeFile(new URL("index.json", dir), `${JSON.stringify({ symbol: SYMBOL, days: index.map(({ date, kinds }) => ({ date, kinds })) })}\n`);
  console.log(`${index.length} quiz days written to public/quiz/`);
}

function volumes(rows: { minute: number; volume: number }[]): number[] {
  const last = rows[rows.length - 1]?.minute ?? -1;
  const byMinute = new Map(rows.map((row) => [row.minute, row.volume]));
  return Array.from({ length: last + 1 }, (_, minute) => byMinute.get(minute) ?? 0);
}

function fillGaps(rows: { minute: number; value: Ohlc }[]): Ohlc[] {
  const last = rows[rows.length - 1]?.minute ?? -1;
  const byMinute = new Map(rows.map((row) => [row.minute, row.value]));
  const out: Ohlc[] = [];
  let prior: Ohlc | null = rows[0]?.value ?? null;
  for (let minute = 0; minute <= last; minute += 1) {
    const value = byMinute.get(minute);
    if (value) prior = value;
    else if (prior) prior = [prior[3], prior[3], prior[3], prior[3]];
    if (prior) out.push(prior);
  }
  return out;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
