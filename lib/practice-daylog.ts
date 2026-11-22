import type { FillNote, Ticker } from "./practice-trade";

export const DAYLOG_KEY = "snc-practice-daylog:v1";
const MAX_ENTRIES = 500;

/**
 * One attempt at one practice day: a day played to 10:00, or a day cut short with Reset.
 * Each attempt is its own entry, so replaying a day after Reset adds a second entry for the same date.
 */
export type DayLogEntry = {
  id: string;
  /** Real time the entry was saved. */
  recordedAt: string;
  /** The simulated session's date, e.g. "2026-11-18". */
  date: string;
  outcome: "finished" | "reset";
  /** Market time the attempt stopped at, e.g. "9:42:15", or "10:00:00" for a finished day. */
  stoppedAt: string;
  startCash: number;
  /** Cash plus open shares at the last price when the attempt stopped. */
  endEquity: number;
  dollars: number;
  pct: number;
  fees: number;
  slippage: number;
  fills: FillNote[];
  /** Shares still held when a Reset stopped the day. */
  open: { ticker: Ticker; shares: number }[];
};

export type DayLog = { v: 1; entries: DayLogEntry[]; lastFinishedKey?: string };

export function emptyDayLog(): DayLog {
  return { v: 1, entries: [] };
}

export function parseDayLog(raw: string | null): DayLog {
  if (!raw) return emptyDayLog();
  try {
    const parsed = JSON.parse(raw) as DayLog;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.entries)) return emptyDayLog();
    const entries = parsed.entries.filter(
      (entry) => entry && typeof entry.id === "string" && typeof entry.date === "string" && Number.isFinite(entry.dollars),
    );
    return { v: 1, entries, lastFinishedKey: typeof parsed.lastFinishedKey === "string" ? parsed.lastFinishedKey : undefined };
  } catch {
    return emptyDayLog();
  }
}

export function addDayEntry(log: DayLog, entry: Omit<DayLogEntry, "id" | "recordedAt">, now = new Date()): DayLog {
  const full: DayLogEntry = { ...entry, id: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, recordedAt: now.toISOString() };
  return { ...log, entries: [...log.entries, full].slice(-MAX_ENTRIES) };
}

export function deleteDayEntry(log: DayLog, id: string): DayLog {
  return { ...log, entries: log.entries.filter((entry) => entry.id !== id) };
}

/** How many attempts at each simulated date, so entries can read "attempt 2". */
export function attemptNumbers(entries: DayLogEntry[]): Map<string, number> {
  const seen = new Map<string, number>();
  const numbers = new Map<string, number>();
  for (const entry of entries) {
    const next = (seen.get(entry.date) ?? 0) + 1;
    seen.set(entry.date, next);
    numbers.set(entry.id, next);
  }
  return numbers;
}
