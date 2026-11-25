/**
 * Real second-by-second prices for a practice morning (9:30:00–9:59:59 ET), recorded from Alpaca's trade feed.
 * Each day is a small file in public/practice-seconds/<date>.json, loaded only for the day being played.
 * When a day has a file, the game replays the real path inside each 1-minute candle instead of a simulated one.
 */

export const SECONDS_PER_SESSION = 30 * 60;
export const SECONDS_DIR = "practice-seconds";

/** The typical (median) eligible trade price in each second, 1800 per ticker. */
export type SessionSeconds = { date: string; source: string; tqqq: number[]; sqqq: number[] };

export type AlpacaTrade = { t: string; p: number; s: number; c?: string[]; x?: string };

/**
 * Sale conditions that don't set the last sale price on the consolidated tape (odd lots, out-of-sequence and
 * late reports, average-price and derivatively priced trades, official open/close reference prints, and so on).
 */
const IGNORED_CONDITIONS = new Set(["I", "W", "Z", "U", "T", "4", "7", "9", "B", "C", "G", "H", "M", "N", "P", "Q", "R", "V"]);

/**
 * Off-exchange trades reported through FINRA's trade reporting facility (exchange "D") often print late and tens
 * of cents away from where the market is trading, so they would make the replay jump and snap back.
 */
const IGNORED_EXCHANGES = new Set(["D"]);

export function setsLastPrice(trade: AlpacaTrade): boolean {
  return (
    Number.isFinite(trade.p) &&
    trade.p > 0 &&
    !IGNORED_EXCHANGES.has(trade.x ?? "") &&
    !(trade.c ?? []).some((code) => IGNORED_CONDITIONS.has(code))
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One price per second from a morning's trades: the median of the eligible trades in each second, so a single
 * stray print can't make the chart jump. A second with no trades keeps the previous price; seconds before the first
 * trade use `open`. `start` is 9:30:00 ET as unix seconds.
 */
export function perSecond(trades: AlpacaTrade[], start: number, open: number): number[] {
  const out = new Array<number>(SECONDS_PER_SESSION);
  const prices: number[][] = Array.from({ length: SECONDS_PER_SESSION }, () => []);
  for (const trade of trades) {
    if (!setsLastPrice(trade)) continue;
    const at = Date.parse(trade.t) / 1000;
    const second = Math.floor(at - start);
    if (second < 0 || second >= SECONDS_PER_SESSION) continue;
    prices[second].push(trade.p);
  }
  let price = open;
  for (let second = 0; second < SECONDS_PER_SESSION; second += 1) {
    if (prices[second].length) price = median(prices[second]);
    out[second] = Math.round(price * 10000) / 10000;
  }
  return out;
}

export function isSessionSeconds(value: unknown, date: string): value is SessionSeconds {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SessionSeconds>;
  const ok = (prices: unknown) => Array.isArray(prices) && prices.length === SECONDS_PER_SESSION && prices.every((p) => typeof p === "number" && p > 0);
  return row.date === date && ok(row.tqqq) && ok(row.sqqq);
}

const cache = new Map<string, SessionSeconds | null>();

/** Seconds already loaded for a date: the data, null if that day has none, undefined if not loaded yet. */
export function cachedSeconds(date: string): SessionSeconds | null | undefined {
  return cache.get(date);
}

export function rememberSeconds(date: string, value: SessionSeconds | null) {
  cache.set(date, value);
}

/** Load a day's seconds once. Resolves to null when the day has no recording (or it can't be fetched in time). */
export async function loadSeconds(date: string, timeoutMs = 5000): Promise<SessionSeconds | null> {
  const known = cache.get(date);
  if (known !== undefined) return known;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(`/${SECONDS_DIR}/${date}.json`, { signal: controller?.signal });
    const body = response.ok ? ((await response.json()) as unknown) : null;
    const value = isSessionSeconds(body, date) ? body : null;
    cache.set(date, value);
    return value;
  } catch {
    // Not cached, so a later visit can try again.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
