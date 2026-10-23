import type { DatePrecision, NewsItem, PriceMention, Status } from "./types";

const PRECISIONS = new Set<DatePrecision>(["day", "month", "quarter", "unknown"]);
const STATUSES = new Set<Status>(["happened", "upcoming", "developing"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asPrice(value: unknown): PriceMention | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { ticker?: unknown; price?: unknown };
  if (typeof record.ticker !== "string" || typeof record.price !== "number" || Number.isNaN(record.price)) {
    return null;
  }
  return { ticker: record.ticker, price: record.price };
}

function asPrecision(value: unknown): DatePrecision {
  return typeof value === "string" && PRECISIONS.has(value as DatePrecision) ? (value as DatePrecision) : "unknown";
}

function asStatus(value: unknown): Status {
  return typeof value === "string" && STATUSES.has(value as Status) ? (value as Status) : "happened";
}

export function normalizeNews(raw: unknown): NewsItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row, index) => {
    const record = (row ?? {}) as Record<string, unknown>;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(asString(record.date)) ? asString(record.date) : "1970-01-01";
    return {
      id: asString(record.id, `item-${index}`),
      date,
      date_precision: asPrecision(record.date_precision),
      status: asStatus(record.status),
      title: asString(record.title, "Untitled"),
      summary: asString(record.summary),
      tickers: asStringList(record.tickers),
      companies: asStringList(record.companies),
      industry: asString(record.industry, "Other"),
      event_type: asString(record.event_type, "other"),
      key_number: asString(record.key_number),
      price_mentioned: asPrice(record.price_mentioned),
      move_pct: typeof record.move_pct === "number" && !Number.isNaN(record.move_pct) ? record.move_pct : null,
      source_digest_date: /^\d{4}-\d{2}-\d{2}$/.test(asString(record.source_digest_date))
        ? asString(record.source_digest_date)
        : date,
      related_ids: asStringList(record.related_ids),
      connection_notes: asString(record.connection_notes),
    };
  });
}

export function indexById(items: NewsItem[]): Map<string, NewsItem> {
  return new Map(items.map((item) => [item.id, item]));
}
