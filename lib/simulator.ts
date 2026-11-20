/** Trading-day growth model. 252 trading days per year, 21 per month. */

export const TRADING_DAYS_PER_YEAR = 252;
export const TRADING_DAYS_PER_MONTH = 21;
export const STORAGE_KEY = "snc-simulator:v1";
export const MILLION = 1_000_000;

export type Scenario = {
  id: string;
  name: string;
  startingCapital: number;
  dailyReturnPct: number;
  drawdownPct: number;
  drawdownsPerMonth: number;
  /** Whole days each month with a 0% return. Missing values load as 4. */
  noTradeDaysPerMonth: number;
  monthlyDeposit: number;
  years: number;
};

export type MonthPoint = {
  month: number;
  balance: number;
};

export type YearSlice = {
  year: number;
  /** Time-weighted return for that year. Deposits are not counted as gain. */
  rate: number | null;
  ending: number;
};

export type Simulation = {
  points: MonthPoint[];
  ending: number;
  totalPutIn: number;
  drawdownDays: number;
  tradeDays: number;
  tradingDays: number;
  /** Compound monthly rate when the deposit is $0. Null otherwise, or when it is undefined. */
  avgNetMonthly: number | null;
  /** Compound annual return. Deposits are left out of the gain. */
  avgAnnual: number | null;
  yearSlices: YearSlice[];
  /** Trading day the balance first reaches $1M. 0 if it starts there. Null if it never does. */
  millionDay: number | null;
  years: number;
};

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: "ira-only",
    name: "IRA only",
    startingCapital: 31_000,
    dailyReturnPct: 0.25,
    drawdownPct: 2,
    drawdownsPerMonth: 1,
    noTradeDaysPerMonth: 4,
    monthlyDeposit: 0,
    years: 3,
  },
  {
    id: "ira-plus-25k",
    name: "IRA + $25K",
    startingCapital: 56_000,
    dailyReturnPct: 0.25,
    drawdownPct: 2,
    drawdownsPerMonth: 1,
    noTradeDaysPerMonth: 4,
    monthlyDeposit: 0,
    years: 3,
  },
];

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createScenario(source: Scenario | undefined, index: number): Scenario {
  return {
    id: newId(),
    name: `Scenario ${index}`,
    startingCapital: source?.startingCapital ?? 31_000,
    dailyReturnPct: source?.dailyReturnPct ?? 0.25,
    drawdownPct: source?.drawdownPct ?? 2,
    drawdownsPerMonth: source?.drawdownsPerMonth ?? 1,
    noTradeDaysPerMonth: source?.noTradeDaysPerMonth ?? 4,
    monthlyDeposit: source?.monthlyDeposit ?? 0,
    years: source?.years ?? 3,
  };
}

export function duplicateScenario(scenario: Scenario): Scenario {
  const name = scenario.name.trim();
  return { ...scenario, id: newId(), name: name ? `${name} copy` : "Copy" };
}

/**
 * Drawdown hits land on the trading day nearest to each multiple of
 * 21 / drawdownsPerMonth. A day can host more than one hit when that
 * interval is shorter than one trading day. On a hit, the day's gain is
 * replaced by the drawdown (it is not applied as well).
 */
export function drawdownHitsByDay(totalDays: number, drawdownsPerMonth: number): Map<number, number> {
  const hits = new Map<number, number>();
  if (!(drawdownsPerMonth > 0) || !Number.isFinite(drawdownsPerMonth) || !(totalDays > 0)) return hits;
  const interval = TRADING_DAYS_PER_MONTH / drawdownsPerMonth;
  if (!(interval > 0) || !Number.isFinite(interval)) return hits;
  const limit = totalDays + 0.5;
  for (let k = 1; k < 1_000_000; k += 1) {
    const target = k * interval;
    if (target > limit) break;
    const day = Math.round(target);
    if (day >= 1 && day <= totalDays) hits.set(day, (hits.get(day) ?? 0) + 1);
  }
  return hits;
}

export function clampNoTradeDays(value: number): number {
  if (!Number.isFinite(value)) return 4;
  return Math.min(TRADING_DAYS_PER_MONTH, Math.max(0, Math.round(value)));
}

/** Even day-of-month slots, same rounding drawdowns use: nearest to k * 21 / count. */
function evenMonthSlots(count: number): number[] {
  if (count <= 0) return [];
  const interval = TRADING_DAYS_PER_MONTH / count;
  const slots: number[] = [];
  const seen = new Set<number>();
  const limit = TRADING_DAYS_PER_MONTH + 0.5;
  for (let k = 1; slots.length < count && k < 1_000_000; k += 1) {
    const target = k * interval;
    if (target > limit) break;
    const day = Math.round(target);
    if (day >= 1 && day <= TRADING_DAYS_PER_MONTH && !seen.has(day)) {
      seen.add(day);
      slots.push(day);
    }
  }
  return slots;
}

function nearestOpenDay(target: number, open: Set<number>): number | null {
  if (open.has(target)) return target;
  for (let distance = 1; distance <= TRADING_DAYS_PER_MONTH; distance += 1) {
    const earlier = target - distance;
    const later = target + distance;
    if (open.has(earlier)) return earlier;
    if (open.has(later)) return later;
  }
  return null;
}

/**
 * No-trade days are spread through each month like drawdowns, then moved off
 * any drawdown day. The count is capped so drawdown days plus no-trade days
 * never exceed the 21 trading days in that month.
 */
export function noTradeDaysByDay(totalDays: number, drawdowns: Map<number, number>, requested: number): Set<number> {
  const chosen = new Set<number>();
  const count = clampNoTradeDays(requested);
  if (count === 0 || totalDays <= 0) return chosen;
  const months = Math.ceil(totalDays / TRADING_DAYS_PER_MONTH);
  for (let month = 0; month < months; month += 1) {
    const start = month * TRADING_DAYS_PER_MONTH;
    const open = new Set<number>();
    for (let offset = 1; offset <= TRADING_DAYS_PER_MONTH; offset += 1) {
      const day = start + offset;
      if (day > totalDays) break;
      if ((drawdowns.get(day) ?? 0) === 0) open.add(offset);
    }
    const place = Math.min(count, open.size);
    for (const slot of evenMonthSlots(place)) {
      const offset = nearestOpenDay(slot, open);
      if (offset === null) continue;
      open.delete(offset);
      chosen.add(start + offset);
    }
  }
  return chosen;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function simulate(input: Scenario): Simulation {
  const years = Math.min(10, Math.max(1, Math.round(finite(input.years, 3))));
  const tradingDays = years * TRADING_DAYS_PER_YEAR;
  const months = years * 12;
  const start = Math.max(0, finite(input.startingCapital, 0));
  const daily = finite(input.dailyReturnPct, 0) / 100;
  const drawdown = finite(input.drawdownPct, 0) / 100;
  const perMonth = Math.max(0, finite(input.drawdownsPerMonth, 0));
  const noTradeRequested = input.noTradeDaysPerMonth == null ? 4 : clampNoTradeDays(input.noTradeDaysPerMonth);
  const deposit = Math.max(0, finite(input.monthlyDeposit, 0));
  const hits = drawdownHitsByDay(tradingDays, perMonth);
  const flatDays = noTradeDaysByDay(tradingDays, hits, noTradeRequested);

  let balance = start;
  let monthOpen = start;
  const points: MonthPoint[] = [{ month: 0, balance }];
  const monthFactors: number[] = [];
  const yearEndings: number[] = [];
  let millionDay: number | null = start >= MILLION ? 0 : null;
  let drawdownDays = 0;
  let tradeDays = 0;

  for (let day = 1; day <= tradingDays; day += 1) {
    const count = hits.get(day) ?? 0;
    if (count > 0) {
      drawdownDays += 1;
      balance *= (1 - drawdown) ** count;
    } else if (flatDays.has(day)) {
      // 0% day: no gain and no loss.
    } else {
      tradeDays += 1;
      balance *= 1 + daily;
    }
    if (day % TRADING_DAYS_PER_MONTH === 0) {
      monthFactors.push(monthGrowth(monthOpen, balance));
      balance += deposit;
      if (monthFactors.length % 12 === 0) yearEndings.push(balance);
      monthOpen = balance;
      points.push({ month: day / TRADING_DAYS_PER_MONTH, balance });
    }
    if (millionDay === null && balance >= MILLION) millionDay = day;
  }

  const totalPutIn = start + deposit * months;
  let avgNetMonthly: number | null = null;
  if (deposit === 0 && start > 0 && Number.isFinite(balance)) {
    if (balance > 0) avgNetMonthly = (balance / start) ** (1 / months) - 1;
    else if (balance === 0) avgNetMonthly = -1;
  }
  const avgAnnual = annualizedReturn(monthFactors, years);
  const yearSlices = yearEndings.map((ending, index) => ({
    year: index + 1,
    rate: periodReturn(monthFactors.slice(index * 12, index * 12 + 12)),
    ending,
  }));

  return {
    points,
    ending: balance,
    totalPutIn,
    drawdownDays,
    tradeDays,
    tradingDays,
    avgNetMonthly,
    avgAnnual,
    yearSlices,
    millionDay,
    years,
  };
}

/** Growth of capital already in the account. A deposit is not part of the gain. */
function monthGrowth(opened: number, beforeDeposit: number): number {
  if (!(opened > 0) || !Number.isFinite(beforeDeposit)) return beforeDeposit === 0 && opened <= 0 ? 1 : Number.NaN;
  if (beforeDeposit < 0) return Number.NaN;
  return beforeDeposit / opened;
}

function periodReturn(factors: number[]): number | null {
  if (factors.length === 0) return null;
  let product = 1;
  for (const factor of factors) {
    if (!Number.isFinite(factor) || factor < 0) return null;
    product *= factor;
  }
  if (!Number.isFinite(product)) return null;
  return product - 1;
}

function annualizedReturn(factors: number[], years: number): number | null {
  const total = periodReturn(factors);
  if (total === null || years <= 0) return null;
  const rate = (1 + total) ** (1 / years) - 1;
  return Number.isFinite(rate) ? rate : null;
}

export function formatWholeDollars(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return "—";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

function compactUnit(value: number): string {
  const digits = value >= 100 ? 0 : 1;
  return value.toFixed(digits).replace(/\.0$/, "");
}

/** Axis ticks. Commas under $1M, compact units above that ($1.2M). Cents only for a tiny range. */
export function formatAxisMoney(value: number, span: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (span < 10 && abs < 1000) {
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (abs >= 1_000_000_000) return `${sign}$${compactUnit(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${compactUnit(abs / 1_000_000)}M`;
  return formatWholeDollars(value);
}

export function formatMonthLabel(month: number): string {
  if (month <= 0) return "Start";
  const years = Math.floor(month / 12);
  const remainder = month % 12;
  if (remainder === 0) return `${years} yr`;
  if (remainder === 6) return years === 0 ? "6 mo" : `${years}.5 yr`;
  if (years === 0) return `${remainder} mo`;
  return `${years} yr ${remainder} mo`;
}

/** Clean x-axis ticks. One year is quarterly; 2–3 years are every 6 months; 4+ years are yearly. */
export function explicitChartMonths(totalMonths: number): number[] {
  if (totalMonths <= 0) return [0];
  const step = totalMonths <= 12 ? 3 : totalMonths <= 36 ? 6 : 12;
  const months = [0];
  for (let month = step; month < totalMonths; month += step) months.push(month);
  if (months[months.length - 1] !== totalMonths) months.push(totalMonths);
  return months;
}

const X_LABEL_CHAR_PX = 8.6;
const X_LABEL_GAP_PX = 14;

function xLabelWidth(month: number): number {
  return formatMonthLabel(month).length * X_LABEL_CHAR_PX;
}

function dropEveryOtherTick(months: number[]): number[] {
  if (months.length <= 2) return months;
  const last = months[months.length - 1];
  const kept = months.filter((_, index) => index % 2 === 0);
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

/** First label is left-aligned, the last is right-aligned, and the rest are centered. */
function xLabelsFit(months: number[], totalMonths: number, plotWidth: number): boolean {
  if (months.length <= 1 || !(plotWidth > 0)) return true;
  const boxes = months.map((month, index) => {
    const x = (month / totalMonths) * plotWidth;
    const width = xLabelWidth(month);
    if (index === 0) return [x, x + width] as const;
    if (index === months.length - 1) return [x - width, x] as const;
    return [x - width / 2, x + width / 2] as const;
  });
  for (let index = 0; index < boxes.length - 1; index += 1) {
    if (boxes[index][1] + X_LABEL_GAP_PX > boxes[index + 1][0]) return false;
  }
  return true;
}

export function chartLabelMonths(totalMonths: number, plotWidth = Number.POSITIVE_INFINITY): number[] {
  let labels = explicitChartMonths(totalMonths);
  for (let guard = 0; labels.length > 2 && !xLabelsFit(labels, totalMonths, plotWidth) && guard < 6; guard += 1) {
    const next = dropEveryOtherTick(labels);
    if (next.length >= labels.length) break;
    labels = next;
  }
  return labels;
}

export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(2)}%`;
}

export function formatSignedPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  const text = `${Math.abs(rate * 100).toFixed(2)}%`;
  if (rate > 0) return `+${text}`;
  if (rate < 0) return `-${text}`;
  return text;
}

export function formatTimeToMillion(day: number | null, years: number, startingCapital: number): string {
  if (startingCapital >= MILLION) return "Already there";
  if (day === null) return `Not within ${years} ${years === 1 ? "year" : "years"}`;
  const wholeYears = Math.floor(day / TRADING_DAYS_PER_YEAR);
  const remainder = day % TRADING_DAYS_PER_YEAR;
  const months = Math.floor(remainder / TRADING_DAYS_PER_MONTH);
  const days = remainder % TRADING_DAYS_PER_MONTH;
  const parts: string[] = [];
  if (wholeYears > 0) parts.push(`${wholeYears} ${wholeYears === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  if (days > 0) parts.push(`${days} trading ${days === 1 ? "day" : "days"}`);
  return parts.join(", ") || "1 trading day";
}

function clampYears(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) return null;
  return Math.min(10, Math.max(1, Math.round(number)));
}

function readNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function sanitizeScenario(value: unknown, used: Set<string>): Scenario | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const years = clampYears(row.years);
  const startingCapital = readNumber(row.startingCapital);
  const dailyReturnPct = readNumber(row.dailyReturnPct);
  const drawdownPct = readNumber(row.drawdownPct);
  const drawdownsPerMonth = readNumber(row.drawdownsPerMonth);
  const monthlyDeposit = readNumber(row.monthlyDeposit);
  if (
    years === null ||
    startingCapital === null ||
    dailyReturnPct === null ||
    drawdownPct === null ||
    drawdownsPerMonth === null ||
    monthlyDeposit === null
  ) {
    return null;
  }
  let id = typeof row.id === "string" ? row.id.trim().slice(0, 80) : "";
  if (!id || used.has(id)) id = newId();
  used.add(id);
  const name = typeof row.name === "string" ? row.name.slice(0, 80) : "";
  return {
    id,
    name,
    startingCapital: Math.max(0, startingCapital),
    dailyReturnPct,
    drawdownPct: Math.max(0, drawdownPct),
    drawdownsPerMonth: Math.max(0, drawdownsPerMonth),
    noTradeDaysPerMonth: clampNoTradeDays(readNumber(row.noTradeDaysPerMonth) ?? 4),
    monthlyDeposit: Math.max(0, monthlyDeposit),
    years,
  };
}

export function sanitizeScenarios(value: unknown): Scenario[] | null {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { scenarios?: unknown }).scenarios)
      ? (value as { scenarios: unknown[] }).scenarios
      : null;
  if (!rows || rows.length === 0) return null;
  const used = new Set<string>();
  const scenarios: Scenario[] = [];
  for (const row of rows) {
    const scenario = sanitizeScenario(row, used);
    if (scenario) scenarios.push(scenario);
  }
  return scenarios.length > 0 ? scenarios : null;
}

export function encodeScenarios(scenarios: Scenario[]): string {
  const json = JSON.stringify({ v: 1, scenarios });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeScenarios(token: string): Scenario[] | null {
  try {
    const pad = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = pad + "=".repeat((4 - (pad.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return sanitizeScenarios(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export function loadScenarios(): Scenario[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeScenarios(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveScenarios(scenarios: Scenario[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, scenarios }));
    return true;
  } catch {
    return false;
  }
}

export function sharePath(scenarios: Scenario[]): string {
  return `/simulator?s=${encodeScenarios(scenarios)}`;
}
