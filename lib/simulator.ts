/** Trading-day growth model. 252 trading days per year, 21 per month. */

export const TRADING_DAYS_PER_YEAR = 252;
export const TRADING_DAYS_PER_MONTH = 21;
export const STORAGE_KEY = "snc-simulator:v1";
export const MILLION = 1_000_000;
/** Default most you can put into one trade before your own orders widen the spread and move the price. */
export const DEFAULT_MAX_TRADE = 7_000_000;
/** SEC Section 31 fee rate per dollar of sell value. */
const SEC_FEE_RATE = 0.0000206;
/** Robinhood options regulatory/OCC fee per contract, charged on the buy and the sell. */
const OPTION_FEE_PER_CONTRACT_PER_SIDE = 0.04;

export type TradeWith = "shares" | "options";

export type Scenario = {
  id: string;
  name: string;
  startingCapital: number;
  dailyReturnPct: number;
  drawdownPct: number;
  drawdownsPerMonth: number;
  years: number;
  tradeWith: TradeWith;
  sharePrice: number;
  optionPrice: number;
  shareSpread: number;
  optionSpread: number;
  /**
   * Most money put into a single day's trade. Above this, size moves the market, so the rest of the balance
   * sits in cash and growth turns from compounding to a steady gain of about maxTrade × daily return per day.
   * 0 means no cap.
   */
  maxTrade: number;
};

export type MonthPoint = {
  month: number;
  balance: number;
};

export type YearSlice = {
  year: number;
  rate: number | null;
  ending: number;
};

export type Simulation = {
  points: MonthPoint[];
  ending: number;
  drawdownDays: number;
  tradeDays: number;
  tradingDays: number;
  /** Compound monthly rate, (ending / start) ^ (1 / months) - 1. */
  avgNetMonthly: number | null;
  /** Compound annual return, (ending / start) ^ (1 / years) - 1. */
  avgAnnual: number | null;
  yearSlices: YearSlice[];
  feesPaid: number;
  /** Day-1 round-trip cost divided by the starting balance. */
  breakEven: number | null;
  dayOneShares: number;
  dayOneContracts: number;
  /** Trading day the balance first reaches $1M. 0 if it starts there. Null if it never does. */
  millionDay: number | null;
  years: number;
  /** Trading day the balance first reaches the max trade size, so every trade after it is capped. Null if never. */
  capDay: number | null;
  /** Gross gain on a normal (non-drawdown) day once trading at the cap: maxTrade × daily return. Null with no cap. */
  cappedDailyGain: number | null;
};

export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    id: "ira-only",
    name: "IRA only",
    startingCapital: 31_000,
    dailyReturnPct: 0.25,
    drawdownPct: 2,
    drawdownsPerMonth: 1,
    years: 3,
    tradeWith: "shares",
    sharePrice: 50,
    optionPrice: 2,
    shareSpread: 0.01,
    optionSpread: 0.05,
    maxTrade: DEFAULT_MAX_TRADE,
  },
  {
    id: "ira-plus-25k",
    name: "IRA + $25K",
    startingCapital: 56_000,
    dailyReturnPct: 0.25,
    drawdownPct: 2,
    drawdownsPerMonth: 1,
    years: 3,
    tradeWith: "shares",
    sharePrice: 50,
    optionPrice: 2,
    shareSpread: 0.01,
    optionSpread: 0.05,
    maxTrade: DEFAULT_MAX_TRADE,
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
    years: source?.years ?? 3,
    tradeWith: source?.tradeWith === "options" ? "options" : "shares",
    sharePrice: source?.sharePrice ?? 50,
    optionPrice: source?.optionPrice ?? 2,
    shareSpread: source?.shareSpread ?? 0.01,
    optionSpread: source?.optionSpread ?? 0.05,
    maxTrade: source?.maxTrade ?? DEFAULT_MAX_TRADE,
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
  const hits = drawdownHitsByDay(tradingDays, perMonth);
  const cap = Math.max(0, finite(input.maxTrade, 0));
  // Trade as much as allowed (the whole balance up to the cap) every day; anything above the cap waits in cash.
  const sized = (balance: number) => (cap > 0 ? Math.min(balance, cap) : balance);
  const opening = roundTrip(sized(start), 1, input);

  let balance = start;
  const points: MonthPoint[] = [{ month: 0, balance }];
  let millionDay: number | null = start >= MILLION ? 0 : null;
  let capDay: number | null = cap > 0 && start >= cap ? 0 : null;
  let drawdownDays = 0;
  let tradeDays = 0;
  let feesPaid = 0;

  for (let day = 1; day <= tradingDays; day += 1) {
    const count = hits.get(day) ?? 0;
    const multiplier = count > 0 ? (1 - drawdown) ** count : 1 + daily;
    if (count > 0) drawdownDays += 1;
    else tradeDays += 1;
    const stake = sized(balance);
    const traded = roundTrip(stake, multiplier, input);
    balance = balance - stake + traded.balance;
    feesPaid += traded.cost;
    if (day % TRADING_DAYS_PER_MONTH === 0) points.push({ month: day / TRADING_DAYS_PER_MONTH, balance });
    if (millionDay === null && balance >= MILLION) millionDay = day;
    if (capDay === null && cap > 0 && balance >= cap) capDay = day;
  }

  const avgNetMonthly = compoundRate(start, balance, months);
  const avgAnnual = compoundRate(start, balance, years);
  const yearSlices: YearSlice[] = [];
  for (let year = 1; year <= years; year += 1) {
    const opened = points[(year - 1) * 12]?.balance ?? start;
    const ending = points[year * 12]?.balance ?? balance;
    yearSlices.push({ year, rate: compoundRate(opened, ending, 1), ending });
  }

  return {
    points,
    ending: balance,
    drawdownDays,
    tradeDays,
    tradingDays,
    avgNetMonthly,
    avgAnnual,
    yearSlices,
    feesPaid,
    breakEven: start > 0 ? opening.cost / start : null,
    dayOneShares: opening.shares,
    dayOneContracts: opening.contracts,
    millionDay,
    years,
    capDay,
    cappedDailyGain: cap > 0 ? cap * daily : null,
  };
}

type RoundTrip = { balance: number; cost: number; shares: number; contracts: number };

/** One buy-then-sell of as much of the balance as the price allows. Multiplier is the gross move. */
function roundTrip(balance: number, multiplier: number, scenario: Scenario): RoundTrip {
  if (!(balance > 0) || !Number.isFinite(multiplier) || multiplier < 0) {
    return { balance: Math.max(0, balance), cost: 0, shares: 0, contracts: 0 };
  }
  if (scenario.tradeWith === "options") {
    const premium = finite(scenario.optionPrice, 0);
    const unit = premium * 100;
    const contracts = unit > 0 ? Math.floor(balance / unit) : 0;
    if (contracts <= 0) return { balance, cost: 0, shares: 0, contracts: 0 };
    const spent = contracts * unit;
    const sellValue = spent * multiplier;
    const spreadCost = contracts * 100 * Math.max(0, finite(scenario.optionSpread, 0));
    const regulatory = contracts * OPTION_FEE_PER_CONTRACT_PER_SIDE * 2;
    const cost = nearestCent(spreadCost + regulatory) + secFee(sellValue);
    return { balance: settled(balance - spent, sellValue, cost), cost, shares: 0, contracts };
  }
  const price = finite(scenario.sharePrice, 0);
  const shares = price > 0 ? Math.floor(balance / price) : 0;
  if (shares <= 0) return { balance, cost: 0, shares: 0, contracts: 0 };
  const spent = shares * price;
  const sellValue = spent * multiplier;
  const spreadCost = shares * Math.max(0, finite(scenario.shareSpread, 0));
  const cost = nearestCent(spreadCost) + secFee(sellValue);
  return { balance: settled(balance - spent, sellValue, cost), cost, shares, contracts: 0 };
}

function settled(leftover: number, sellValue: number, cost: number): number {
  const next = leftover + sellValue - cost;
  if (Number.isFinite(next)) return Math.max(0, next);
  if (next === Infinity) return Infinity;
  return Number.isFinite(leftover) ? Math.max(0, leftover) : 0;
}

function secFee(sellValue: number): number {
  if (!(sellValue > 500) || !Number.isFinite(sellValue)) return 0;
  const raw = sellValue * SEC_FEE_RATE;
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (raw >= 1e16) return raw;
  return Math.ceil(raw * 100 - 1e-8) / 100;
}

function nearestCent(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  // Cents stop being representable, and rounding would overflow a finite double.
  if (Math.abs(amount) >= 1e16) return amount;
  return Math.round(amount * 100) / 100;
}

function compoundRate(opened: number, closed: number, periods: number): number | null {
  if (!(opened > 0) || !Number.isFinite(closed) || closed < 0 || !(periods > 0)) return null;
  if (closed === 0) return -1;
  const rate = (closed / opened) ** (1 / periods) - 1;
  return Number.isFinite(rate) ? rate : null;
}

export function formatWholeDollars(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US")}`;
}

function scaledMoney(abs: number, unit: number, suffix: string): string {
  const text = (abs / unit).toFixed(2).replace(/\.?0+$/, "");
  return `$${text}${suffix}`;
}

/** Cards, yearly rows, chart axes, and tooltips. Commas under $1M, then $1.23M, $4.56B, $7.89T, then $1.2e18. */
export function formatMoney(value: number): string {
  if (value === Infinity) return "$∞";
  if (value === -Infinity) return "-$∞";
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e15) {
    const exp = Math.floor(Math.log10(abs));
    const mantissa = abs / 10 ** exp;
    return `${sign}$${mantissa.toFixed(1)}e${exp}`;
  }
  if (abs >= 1e12) return `${sign}${scaledMoney(abs, 1e12, "T")}`;
  if (abs >= 1e9) return `${sign}${scaledMoney(abs, 1e9, "B")}`;
  if (abs >= 1e6) return `${sign}${scaledMoney(abs, 1e6, "M")}`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCents(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) return "—";
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatBreakEven(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  const digits = pct >= 0.01 ? 2 : pct >= 0.0001 ? 4 : 6;
  return `${pct.toFixed(digits)}%`;
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.max(0, Math.floor(value)).toLocaleString("en-US");
}

/** Axis ticks. Same money format as the cards, with cents only for a tiny range. */
export function formatAxisMoney(value: number, span: number): string {
  if (!Number.isFinite(value) || value === Infinity || value === -Infinity) return formatMoney(value);
  const abs = Math.abs(value);
  if (span < 10 && abs < 1000) {
    const sign = value < 0 ? "-" : "";
    return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatMoney(value);
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
  return formatTimeTo(day, years, startingCapital, MILLION);
}

/** How long until the balance first reaches `target`, as years, months and trading days. */
export function formatTimeTo(day: number | null, years: number, startingCapital: number, target: number): string {
  if (startingCapital >= target) return "Already there";
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

function readNonNegative(value: unknown, fallback: number): number {
  const number = readNumber(value);
  if (number === null || number < 0) return fallback;
  return number;
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
  if (
    years === null ||
    startingCapital === null ||
    dailyReturnPct === null ||
    drawdownPct === null ||
    drawdownsPerMonth === null
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
    years,
    tradeWith: row.tradeWith === "options" ? "options" : "shares",
    sharePrice: readNonNegative(row.sharePrice, 50),
    optionPrice: readNonNegative(row.optionPrice, 2),
    shareSpread: readNonNegative(row.shareSpread, 0.01),
    optionSpread: readNonNegative(row.optionSpread, 0.05),
    maxTrade: readNonNegative(row.maxTrade, DEFAULT_MAX_TRADE),
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
