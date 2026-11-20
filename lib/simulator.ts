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
  monthlyDeposit: number;
  years: number;
};

export type MonthPoint = {
  month: number;
  balance: number;
};

export type Simulation = {
  points: MonthPoint[];
  ending: number;
  totalPutIn: number;
  drawdownDays: number;
  tradingDays: number;
  /** Compound monthly rate when the deposit is $0. Null otherwise, or when it is undefined. */
  avgNetMonthly: number | null;
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
  const deposit = Math.max(0, finite(input.monthlyDeposit, 0));
  const hits = drawdownHitsByDay(tradingDays, perMonth);

  let balance = start;
  const points: MonthPoint[] = [{ month: 0, balance }];
  let millionDay: number | null = start >= MILLION ? 0 : null;
  let drawdownDays = 0;

  for (let day = 1; day <= tradingDays; day += 1) {
    const count = hits.get(day) ?? 0;
    if (count > 0) {
      drawdownDays += 1;
      balance *= (1 - drawdown) ** count;
    } else {
      balance *= 1 + daily;
    }
    if (day % TRADING_DAYS_PER_MONTH === 0) balance += deposit;
    if (millionDay === null && balance >= MILLION) millionDay = day;
    if (day % TRADING_DAYS_PER_MONTH === 0) points.push({ month: day / TRADING_DAYS_PER_MONTH, balance });
  }

  const totalPutIn = start + deposit * months;
  let avgNetMonthly: number | null = null;
  if (deposit === 0 && start > 0 && Number.isFinite(balance)) {
    if (balance > 0) avgNetMonthly = (balance / start) ** (1 / months) - 1;
    else if (balance === 0) avgNetMonthly = -1;
  }

  return { points, ending: balance, totalPutIn, drawdownDays, tradingDays, avgNetMonthly, millionDay, years };
}

export function formatWholeDollars(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return "—";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

/** Axis and tooltip money. Whole dollars, with cents only when the range is under $10. */
export function formatAxisMoney(value: number, span: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return "—";
  if (span < 10) {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatWholeDollars(value);
}

export function formatMonthLabel(month: number): string {
  if (month <= 0) return "Start";
  const years = Math.floor(month / 12);
  const remainder = month % 12;
  if (remainder === 0) return years === 1 ? "1 yr" : `${years} yr`;
  if (years === 0) return month === 1 ? "1 mo" : `${month} mo`;
  return `${month} mo`;
}

export function chartLabelMonths(totalMonths: number): number[] {
  if (totalMonths <= 0) return [0];
  const slots = Math.min(6, totalMonths + 1);
  const labels: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < slots; i += 1) {
    const month = Math.round((i * totalMonths) / (slots - 1));
    if (seen.has(month)) continue;
    seen.add(month);
    labels.push(month);
  }
  return labels;
}

export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(2)}%`;
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
