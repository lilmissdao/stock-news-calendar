import type { DatePrecision, GraphNode, LinkKind, NewsItem, PriceMention, Reliance, Status } from "./types";

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

const RELIANCE = new Set<Reliance>(["very_high", "high", "medium", "low"]);
const LINK_KINDS = new Set<LinkKind>(["rival", "generic_threat", "royalty", "unverified"]);

function asReliance(value: unknown): Reliance | null {
  return typeof value === "string" && RELIANCE.has(value as Reliance) ? (value as Reliance) : null;
}

function asGraphNode(value: unknown): GraphNode | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const cap = record.market_cap_b;
  return {
    label: asString(record.label),
    drug: asString(record.drug),
    reliance: asReliance(record.reliance),
    market_cap_b: typeof cap === "number" && !Number.isNaN(cap) ? cap : null,
    cluster: asString(record.cluster, "other"),
    order: typeof record.order === "number" && !Number.isNaN(record.order) ? record.order : 0,
    unverified: record.unverified === true,
    generic: record.generic === true,
  };
}

function asLinkKinds(value: unknown): Partial<Record<string, LinkKind>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Partial<Record<string, LinkKind>> = {};
  for (const [key, kind] of Object.entries(value as Record<string, unknown>)) {
    if (typeof kind === "string" && LINK_KINDS.has(kind as LinkKind)) out[key] = kind as LinkKind;
  }
  return out;
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
      graph_node: asGraphNode(record.graph_node),
      graph_only: record.graph_only === true,
      link_kinds: asLinkKinds(record.link_kinds),
    };
  });
}

export function indexById(items: NewsItem[]): Map<string, NewsItem> {
  return new Map(items.map((item) => [item.id, item]));
}
