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

function cashLine(cash: BinaryCash | null): string {
  if (!cash) return "";
  const runway = cash.runway ? ` Runway: ${cash.runway}.` : "";
  const quarters = cash.quarters ? ` Quarters: ${cash.quarters}.` : "";
  return `${cash.on_hand} as of ${cash.as_of} (${cash.scope}).${runway}${quarters}`.trim();
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

export function binaryToNews(item: BinaryItem): NewsItem {
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
    industry: "Binary Bets",
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
    cash_line: cashLine(item.cash),
    outcome_line: move,
    why_it_matters: item.why_it_matters,
    source_url: primary?.source ?? "",
    source_label: primary?.source_label ?? "",
    unconfirmed: false,
  };
}

export function mergeBinary(news: NewsItem[], binary: BinaryFile): NewsItem[] {
  const ids = new Set(news.map((item) => item.id));
  const extra = binary.items.map((item) => {
    if (ids.has(item.id)) throw new Error(`Binary id collides with an existing item: ${item.id}`);
    ids.add(item.id);
    return binaryToNews(item);
  });
  return [...news, ...extra];
}

export function binaryDateLabel(item: BinaryItem): string {
  return item.date_window || item.date;
}
