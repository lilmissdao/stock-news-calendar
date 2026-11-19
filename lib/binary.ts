import { daysBetween } from "./format";
import type { DatePrecision, NewsItem } from "./types";

/**
 * Binary Bets tracker.
 *
 * Updates go in `data/binary-bets.json`, then `npm run briefs`.
 * The script checks the file and writes a count into `data/briefs.json`.
 * The calendar reads the same file at build time. Field meanings are in the README.
 */

export const CATALYST_TYPES = ["pdufa", "phase3", "adcom"] as const;
export type CatalystType = (typeof CATALYST_TYPES)[number];
export type BinaryTiming = "confirmed" | "expected";
export type BinaryStatus = "upcoming" | "resolved";
export type OutcomeResult = "success" | "miss";

const TYPES = new Set<string>(CATALYST_TYPES);
const TIMINGS = new Set<BinaryTiming>(["confirmed", "expected"]);
const STATUSES = new Set<BinaryStatus>(["upcoming", "resolved"]);
const RESULTS = new Set<OutcomeResult>(["success", "miss"]);
const PRECISIONS = new Set<DatePrecision>(["day", "month", "quarter", "unknown"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const CATALYST_LABELS: Record<CatalystType, string> = {
  pdufa: "PDUFA",
  phase3: "Phase 3 readout",
  adcom: "Advisory committee",
};

export const TIMING_LABELS: Record<BinaryTiming, string> = {
  confirmed: "Confirmed",
  expected: "Expected",
};

export const BINARY_STATUS_LABELS: Record<BinaryStatus, string> = {
  upcoming: "Upcoming",
  resolved: "Resolved",
};

export const OUTCOME_LABELS: Record<OutcomeResult, string> = {
  success: "Success",
  miss: "Miss",
};

export type SourcedFact = {
  label: string;
  value: string;
  source: string;
  source_label: string;
  reported: boolean;
};

export type BinaryCash = {
  on_hand: string;
  as_of: string;
  scope: string;
  runway: string;
  quarters: string;
  quarters_note: string;
  source: string;
  source_label: string;
  reported: boolean;
};

export type BinaryOutcome = {
  result: OutcomeResult;
  move: string;
  source: string;
  source_label: string;
  reported: boolean;
};

export type EventCounter = {
  current: number;
  target: number;
  as_of: string;
  source: string;
  source_label: string;
};

export type GuidanceEntry = {
  date: string;
  wording: string;
  source: string;
  source_label: string;
  missed: boolean;
};

export type ShortInterest = {
  pct_float: number;
  days_to_cover: number | null;
  as_of: string;
  source: string;
  source_label: string;
};

export type AnalystMove = {
  date: string;
  firm: string;
  action: string;
  target: string;
  source: string;
  source_label: string;
};

export type Dilution = {
  summary: string;
  source: string;
  source_label: string;
};

export const BURN_BASES = [
  "net cash used in operating activities, YTD / quarters",
  "net loss / quarters",
] as const;
export type BurnBasis = (typeof BURN_BASES)[number];

export type QuarterlyBurn = {
  amount_usd: number;
  basis: BurnBasis;
  period: string;
  source: string;
  source_label: string;
};

export type RunwayTone = "red" | "amber" | "green";

export type CashRunway = {
  computed: boolean;
  line: string;
  tone: RunwayTone | null;
  company: string;
  spendMore: boolean;
};

export type BinaryItem = {
  id: string;
  ticker: string;
  company: string;
  drug: string;
  indication: string;
  catalyst_type: CatalystType;
  date: string;
  date_precision: DatePrecision;
  date_window: string;
  timing: BinaryTiming;
  status: BinaryStatus;
  market_cap: string;
  cash: BinaryCash | null;
  success_means: string;
  miss_means: string;
  why_it_matters: string;
  outcome: BinaryOutcome | null;
  event_counter: EventCounter | null;
  guidance_history: GuidanceEntry[];
  short_interest: ShortInterest | null;
  analyst_moves: AnalystMove[];
  prior_phase_data: string;
  dilution: Dilution | null;
  quarterly_burn: QuarterlyBurn | null;
  facts: SourcedFact[];
  title: string;
  summary: string;
  key_number: string;
  related_ids: string[];
};

export type BinaryFile = {
  items: BinaryItem[];
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function asStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a list of strings`);
  }
  return value as string[];
}

function httpsUrl(value: string, label: string): string {
  const url = value.trim();
  if (!url.startsWith("https://")) throw new Error(`${label} must be an https link`);
  return url;
}

function asFact(value: unknown, label: string): SourcedFact {
  const record = asRecord(value, label);
  const reported = record.reported;
  if (typeof reported !== "boolean") throw new Error(`${label}.reported must be true or false`);
  return {
    label: asString(record.label, `${label}.label`).trim(),
    value: asString(record.value, `${label}.value`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
    reported,
  };
}

function asCash(value: unknown, label: string): BinaryCash | null {
  if (value === null) return null;
  const record = asRecord(value, label);
  const asOf = asString(record.as_of, `${label}.as_of`);
  if (!DATE.test(asOf)) throw new Error(`${label}.as_of is not YYYY-MM-DD`);
  if (typeof record.reported !== "boolean") throw new Error(`${label}.reported must be true or false`);
  const cash: BinaryCash = {
    on_hand: asString(record.on_hand, `${label}.on_hand`).trim(),
    as_of: asOf,
    scope: asString(record.scope, `${label}.scope`).trim(),
    runway: asString(record.runway, `${label}.runway`).trim(),
    quarters: asString(record.quarters, `${label}.quarters`).trim(),
    quarters_note: asString(record.quarters_note, `${label}.quarters_note`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
    reported: record.reported === true,
  };
  if (!cash.on_hand || !cash.scope || !cash.source_label) throw new Error(`${label} is incomplete`);
  if (cash.quarters && !cash.quarters_note) throw new Error(`${label}.quarters needs quarters_note`);
  return cash;
}

function asOutcome(value: unknown, label: string): BinaryOutcome | null {
  if (value === null) return null;
  const record = asRecord(value, label);
  const result = asString(record.result, `${label}.result`);
  if (!RESULTS.has(result as OutcomeResult)) throw new Error(`${label}.result is invalid`);
  if (typeof record.reported !== "boolean") throw new Error(`${label}.reported must be true or false`);
  const outcome: BinaryOutcome = {
    result: result as OutcomeResult,
    move: asString(record.move, `${label}.move`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
    reported: record.reported === true,
  };
  if (!outcome.move || !outcome.source_label) throw new Error(`${label} needs a move and a source label`);
  return outcome;
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function asDate(value: unknown, label: string): string {
  const date = asString(value, label);
  if (!DATE.test(date)) throw new Error(`${label} is not YYYY-MM-DD`);
  return date;
}

function asEventCounter(value: unknown, label: string): EventCounter | null {
  if (value == null) return null;
  const record = asRecord(value, label);
  const current = asNumber(record.current, `${label}.current`);
  const target = asNumber(record.target, `${label}.target`);
  if (current < 0) throw new Error(`${label}.current cannot be negative`);
  if (target <= 0) throw new Error(`${label}.target must be greater than zero`);
  const counter: EventCounter = {
    current,
    target,
    as_of: asDate(record.as_of, `${label}.as_of`),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
  };
  if (!counter.source_label) throw new Error(`${label} needs a source label`);
  return counter;
}

function asGuidance(value: unknown, label: string): GuidanceEntry {
  const record = asRecord(value, label);
  if (typeof record.missed !== "boolean") throw new Error(`${label}.missed must be true or false`);
  const entry: GuidanceEntry = {
    date: asDate(record.date, `${label}.date`),
    wording: asString(record.wording, `${label}.wording`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
    missed: record.missed === true,
  };
  if (!entry.wording || !entry.source_label) throw new Error(`${label} needs wording and a source label`);
  return entry;
}

function asGuidanceHistory(value: unknown, label: string): GuidanceEntry[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value.map((entry, index) => asGuidance(entry, `${label}[${index}]`));
}

function asShortInterest(value: unknown, label: string): ShortInterest | null {
  if (value == null) return null;
  const record = asRecord(value, label);
  const days = record.days_to_cover;
  if (days != null && (typeof days !== "number" || !Number.isFinite(days) || days < 0)) {
    throw new Error(`${label}.days_to_cover must be a number or null`);
  }
  const interest: ShortInterest = {
    pct_float: asNumber(record.pct_float, `${label}.pct_float`),
    days_to_cover: days == null ? null : days,
    as_of: asDate(record.as_of, `${label}.as_of`),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
  };
  if (interest.pct_float < 0) throw new Error(`${label}.pct_float cannot be negative`);
  if (!interest.source_label) throw new Error(`${label} needs a source label`);
  return interest;
}

function asAnalystMove(value: unknown, label: string): AnalystMove {
  const record = asRecord(value, label);
  const move: AnalystMove = {
    date: asDate(record.date, `${label}.date`),
    firm: asString(record.firm, `${label}.firm`).trim(),
    action: asString(record.action, `${label}.action`).trim(),
    target: asString(record.target, `${label}.target`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
  };
  if (!move.firm || !move.action || !move.target || !move.source_label) {
    throw new Error(`${label} needs a firm, action, target, and source label`);
  }
  return move;
}

function asAnalystMoves(value: unknown, label: string): AnalystMove[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value.map((entry, index) => asAnalystMove(entry, `${label}[${index}]`));
}

function asDilution(value: unknown, label: string): Dilution | null {
  if (value == null) return null;
  const record = asRecord(value, label);
  const dilution: Dilution = {
    summary: asString(record.summary, `${label}.summary`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
  };
  if (!dilution.summary || !dilution.source_label) throw new Error(`${label} needs a summary and a source label`);
  return dilution;
}

function asQuarterlyBurn(value: unknown, label: string): QuarterlyBurn | null {
  if (value == null) return null;
  const record = asRecord(value, label);
  const basis = asString(record.basis, `${label}.basis`);
  if (!BURN_BASES.includes(basis as BurnBasis)) throw new Error(`${label}.basis is invalid`);
  const amount = asNumber(record.amount_usd, `${label}.amount_usd`);
  if (amount <= 0) throw new Error(`${label}.amount_usd must be greater than zero`);
  const burn: QuarterlyBurn = {
    amount_usd: amount,
    basis: basis as BurnBasis,
    period: asString(record.period, `${label}.period`).trim(),
    source: httpsUrl(asString(record.source, `${label}.source`), `${label}.source`),
    source_label: asString(record.source_label, `${label}.source_label`).trim(),
  };
  if (!burn.period || !burn.source_label) throw new Error(`${label} needs a period and a source label`);
  return burn;
}

function parseCashUsd(onHand: string): number | null {
  const match = onHand.replace(/,/g, "").match(/\$(\d+(?:\.\d+)?)\s*(billion|million)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return match[2].toLowerCase().startsWith("b") ? amount * 1_000_000_000 : amount * 1_000_000;
}

function statedRunwayMonths(cash: BinaryCash): number | null {
  const text = cash.runway.toLowerCase();
  const match = text.match(
    /into\s+(late\s+)?(?:the\s+(first|second|third|fourth)\s+quarter\s+of\s+)?(\d{4})\b/,
  );
  if (!match || !DATE.test(cash.as_of)) return null;
  const year = Number(match[3]);
  const quarter = match[2];
  const month = quarter === "first" ? 3 : quarter === "second" ? 6 : quarter === "third" ? 9 : 12;
  const [asYear, asMonth] = cash.as_of.split("-").map(Number);
  return (year - asYear) * 12 + (month - asMonth);
}

export function cashRunway(item: BinaryItem): CashRunway {
  const company = item.cash?.runway.trim() ?? "";
  const usd = item.cash ? parseCashUsd(item.cash.on_hand) : null;
  if (!item.cash || usd == null) {
    const why = item.cash && /€|eur/i.test(item.cash.on_hand)
      ? "Cash is reported in euros, so a dollar runway was not computed."
      : "No dollar cash figure was read, so runway was not computed.";
    return { computed: false, line: `Runway: not computed. ${why}`, tone: null, company, spendMore: false };
  }
  if (!item.quarterly_burn) {
    return {
      computed: false,
      line: "Runway: not computed. No quarterly burn was read from a filing.",
      tone: null,
      company,
      spendMore: false,
    };
  }
  const months = Math.round(usd / (item.quarterly_burn.amount_usd / 3));
  const quarters = Math.round(months / 3);
  const years = quarters / 4;
  const yearText = Number.isInteger(years) ? `${years} yr${years === 1 ? "" : "s"}` : `${years.toFixed(1)} yrs`;
  const tone: RunwayTone = quarters < 4 ? "red" : quarters <= 8 ? "amber" : "green";
  const stated = statedRunwayMonths(item.cash);
  return {
    computed: true,
    line: `Runway: ~${quarters} quarter${quarters === 1 ? "" : "s"} (~${yearText}) at current burn`,
    tone,
    company,
    spendMore: stated != null && months >= stated + 12,
  };
}

const SOON_GUIDANCE = [
  /\bthis quarter\b/i,
  /\bcurrent quarter\b/i,
  /\bthis month\b/i,
  /\bthis week\b/i,
  /\bnext week\b/i,
  /\bcoming weeks\b/i,
  /\bcoming days\b/i,
  /\bwithin (?:a |the )?(?:month|weeks|days)\b/i,
  /\bimminent(?:ly)?\b/i,
  /\bany day\b/i,
  /\bshortly\b/i,
];

const QUARTER_WORDS = ["first", "second", "third", "fourth"];
const MONTH_WORDS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function latestGuidance(item: BinaryItem): GuidanceEntry | null {
  if (item.guidance_history.length === 0) return null;
  const ordered = [...item.guidance_history].sort((a, b) => a.date.localeCompare(b.date) || a.wording.localeCompare(b.wording));
  return ordered[ordered.length - 1] ?? null;
}

/** Company wording that means this quarter or a shorter window, judged on `today`. */
export function guidanceIsSoon(wording: string, today: string): boolean {
  const text = wording.toLowerCase();
  if (/\bnext quarter\b/.test(text)) return false;
  if (SOON_GUIDANCE.some((pattern) => pattern.test(text))) return true;
  const [yearText, monthText] = today.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return false;
  const quarter = Math.floor((month - 1) / 3) + 1;
  const quarterWord = QUARTER_WORDS[quarter - 1];
  if (new RegExp(`\\bq${quarter}\\s*${year}\\b`).test(text)) return true;
  if (new RegExp(`\\b${quarterWord}\\s+quarter(?:\\s+of)?\\s+${year}\\b`).test(text)) return true;
  const start = (quarter - 1) * 3;
  for (let index = 0; index < 3; index += 1) {
    const name = MONTH_WORDS[start + index];
    if (text.includes(String(year)) && new RegExp(`\\b${name}\\b`).test(text)) return true;
  }
  return false;
}

export function isEarlyWarning(item: BinaryItem, today: string): boolean {
  if (item.status !== "upcoming") return false;
  const counter = item.event_counter;
  if (counter && counter.target > 0 && counter.current / counter.target >= 0.9) return true;
  const latest = latestGuidance(item);
  if (latest && guidanceIsSoon(latest.wording, today)) return true;
  const days = daysBetween(today, item.date);
  return days >= 0 && days <= 30;
}

export function guidanceWasMissed(item: BinaryItem): boolean {
  return item.guidance_history.some((entry) => entry.missed);
}

function cashLine(item: BinaryItem): string {
  const cash = item.cash;
  if (!cash) return cashRunway(item).line;
  const stated = cash.runway ? ` Company: ${cash.runway}.` : "";
  const quarters = cash.quarters ? ` Quarters stated: ${cash.quarters}.` : "";
  const computed = cashRunway(item);
  const flag = computed.spendMore ? " Company plans to spend more." : "";
  return `${cash.on_hand} as of ${cash.as_of} (${cash.scope}). ${computed.line}.${stated}${quarters}${flag}`.trim();
}

export function loadBinary(raw: unknown): BinaryFile {
  const root = asRecord(raw, "binary-bets.json");
  if (typeof root.note !== "string" || !root.note.trim()) {
    throw new Error("binary-bets.json needs a note describing the file");
  }
  if (!Array.isArray(root.items)) throw new Error("binary-bets.json needs an items array");

  const items: BinaryItem[] = root.items.map((entry, index) => {
    const record = asRecord(entry, `items[${index}]`);
    const id = asString(record.id, `items[${index}].id`).trim();
    if (!id.startsWith("bb-")) throw new Error(`${id || `items[${index}]`} id must start with bb-`);
    const date = asString(record.date, `${id}.date`);
    const precision = asString(record.date_precision, `${id}.date_precision`);
    const timing = asString(record.timing, `${id}.timing`);
    const status = asString(record.status, `${id}.status`);
    const catalystType = asString(record.catalyst_type, `${id}.catalyst_type`);
    if (!DATE.test(date)) throw new Error(`${id}.date is not YYYY-MM-DD`);
    if (!PRECISIONS.has(precision as DatePrecision)) throw new Error(`${id}.date_precision is invalid`);
    if (!TIMINGS.has(timing as BinaryTiming)) throw new Error(`${id}.timing is invalid`);
    if (!STATUSES.has(status as BinaryStatus)) throw new Error(`${id}.status is invalid`);
    if (!TYPES.has(catalystType)) throw new Error(`${id}.catalyst_type is invalid`);
    const datePrecision = precision as DatePrecision;
    const binaryTiming = timing as BinaryTiming;
    if (binaryTiming === "confirmed" && datePrecision !== "day") {
      throw new Error(`${id} is confirmed, so date_precision must be day`);
    }
    if (binaryTiming === "expected" && datePrecision !== "month" && datePrecision !== "quarter") {
      throw new Error(`${id} is expected, so date_precision must be month or quarter`);
    }
    const dateWindow = asString(record.date_window, `${id}.date_window`).trim();
    if (binaryTiming === "expected" && !dateWindow) throw new Error(`${id} needs a date_window`);
    if (binaryTiming === "confirmed" && dateWindow) throw new Error(`${id} is a confirmed day, so date_window stays empty`);
    const factsRaw = record.facts;
    if (!Array.isArray(factsRaw) || factsRaw.length === 0) throw new Error(`${id} needs at least one fact`);
    const facts = factsRaw.map((fact, factIndex) => asFact(fact, `${id}.facts[${factIndex}]`));
    for (const fact of facts) {
      if (!fact.label || !fact.value || !fact.source_label) throw new Error(`${id} has an empty fact`);
    }
    const dated = facts.some((fact) => /date|window/i.test(fact.label));
    if (!dated) throw new Error(`${id} needs a fact whose label names the date or window`);
    const cash = asCash(record.cash, `${id}.cash`);
    if (cash && !facts.some((fact) => /cash/i.test(fact.label))) {
      throw new Error(`${id} states cash, so a fact must source it`);
    }
    const marketCap = asString(record.market_cap, `${id}.market_cap`).trim();
    if (marketCap && !facts.some((fact) => /market cap/i.test(fact.label))) {
      throw new Error(`${id} states a market cap, so a fact must source it`);
    }
    const outcome = asOutcome(record.outcome, `${id}.outcome`);
    if ("early_warning" in record) {
      throw new Error(`${id}.early_warning is computed in code and cannot be set in the file`);
    }
    const eventCounter = asEventCounter(record.event_counter, `${id}.event_counter`);
    const guidanceHistory = asGuidanceHistory(record.guidance_history, `${id}.guidance_history`);
    const shortInterest = asShortInterest(record.short_interest, `${id}.short_interest`);
    const analystMoves = asAnalystMoves(record.analyst_moves, `${id}.analyst_moves`);
    const priorPhase = record.prior_phase_data == null ? "" : asString(record.prior_phase_data, `${id}.prior_phase_data`).trim();
    const dilution = asDilution(record.dilution, `${id}.dilution`);
    const quarterlyBurn = asQuarterlyBurn(record.quarterly_burn, `${id}.quarterly_burn`);
    const binaryStatus = status as BinaryStatus;
    if (binaryStatus === "resolved" && !outcome) throw new Error(`${id} is resolved and needs an outcome`);
    if (binaryStatus === "upcoming" && outcome) throw new Error(`${id} is still upcoming, so outcome stays null`);
    const summary = asString(record.summary, `${id}.summary`).trim();
    const why = asString(record.why_it_matters, `${id}.why_it_matters`).trim();
    const success = asString(record.success_means, `${id}.success_means`).trim();
    const miss = asString(record.miss_means, `${id}.miss_means`).trim();
    const title = asString(record.title, `${id}.title`).trim();
    const keyNumber = asString(record.key_number, `${id}.key_number`).trim();
    if (!title || !summary || !why || !success || !miss || !keyNumber) {
      throw new Error(`${id} needs a title, summary, key number, why it matters, and both outcomes`);
    }
    return {
      id,
      ticker: asString(record.ticker, `${id}.ticker`).trim(),
      company: asString(record.company, `${id}.company`).trim(),
      drug: asString(record.drug, `${id}.drug`).trim(),
      indication: asString(record.indication, `${id}.indication`).trim(),
      catalyst_type: catalystType as CatalystType,
      date,
      date_precision: datePrecision,
      date_window: dateWindow,
      timing: binaryTiming,
      status: binaryStatus,
      market_cap: marketCap,
      cash,
      success_means: success,
      miss_means: miss,
      why_it_matters: why,
      outcome,
      event_counter: eventCounter,
      guidance_history: guidanceHistory,
      short_interest: shortInterest,
      analyst_moves: analystMoves,
      prior_phase_data: priorPhase,
      dilution,
      quarterly_burn: quarterlyBurn,
      facts,
      title,
      summary,
      key_number: keyNumber,
      related_ids: asStringList(record.related_ids, `${id}.related_ids`),
    };
  });

  const ids = new Set<string>();
  for (const item of items) {
    if (!item.ticker || !item.company || !item.drug || !item.indication) {
      throw new Error(`${item.id} needs a ticker, company, drug, and indication`);
    }
    if (ids.has(item.id)) throw new Error(`Duplicate binary id ${item.id}`);
    ids.add(item.id);
  }
  for (const item of items) {
    for (const related of item.related_ids) {
      if (!ids.has(related)) throw new Error(`${item.id} related_ids missing ${related}`);
    }
  }
  return { items };
}

export function binaryToNews(item: BinaryItem, today: string): NewsItem {
  const primary = item.facts[0];
  const move = item.outcome?.move ?? "";
  return {
    id: item.id,
    date: item.date,
    date_precision: item.date_precision,
    status: item.status === "resolved" ? "happened" : "upcoming",
    title: item.title,
    summary: item.summary,
    tickers: [item.ticker],
    companies: [item.company],
    industry: "Pharma/Biotech",
    event_type: item.catalyst_type === "phase3" ? "trial" : "fda",
    key_number: item.key_number,
    price_mentioned: null,
    move_pct: null,
    source_digest_date: "2026-11-17",
    related_ids: item.related_ids,
    connection_notes: "",
    graph_node: null,
    graph_only: false,
    link_kinds: {},
    binary_bet: true,
    binary_timing: item.timing,
    binary_type: item.catalyst_type,
    drug: item.drug,
    indication: item.indication,
    success_means: item.success_means,
    miss_means: item.miss_means,
    cash_line: cashLine(item),
    outcome_line: move,
    why_it_matters: item.why_it_matters,
    early_warning: isEarlyWarning(item, today),
    source_url: primary?.source ?? "",
    source_label: primary?.source_label ?? "",
    unconfirmed: false,
  };
}

export function mergeBinary(news: NewsItem[], binary: BinaryFile, today: string): NewsItem[] {
  const ids = new Set(news.map((item) => item.id));
  const extra = binary.items.map((item) => {
    if (ids.has(item.id)) throw new Error(`Binary id collides with an existing item: ${item.id}`);
    ids.add(item.id);
    return binaryToNews(item, today);
  });
  return [...news, ...extra];
}

export function binaryDateLabel(item: BinaryItem): string {
  return item.date_window || item.date;
}
