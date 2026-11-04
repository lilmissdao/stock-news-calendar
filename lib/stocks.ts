import raw from "../data/stocks.json" with { type: "json" };
import { indexById } from "@/lib/news";
import type { DatePrecision, NewsItem, Status, StockCaution, StockProfile, StoryEvent } from "@/lib/types";

const PRECISIONS = new Set<DatePrecision>(["day", "month", "quarter", "unknown"]);
const STATUSES = new Set<Status>(["happened", "upcoming", "developing"]);
const LEVELS = new Set(["high", "medium", "low"]);

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
}

function asEvent(value: unknown, index: number): StoryEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = asString(record.title).trim();
  if (!title) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(asString(record.date)) ? asString(record.date) : "1970-01-01";
  const precision = asString(record.date_precision);
  const status = asString(record.status);
  return {
    id: asString(record.id, `story-${index}`),
    date,
    date_precision: PRECISIONS.has(precision as DatePrecision) ? (precision as DatePrecision) : "unknown",
    status: STATUSES.has(status as Status) ? (status as Status) : "happened",
    title,
    summary: asString(record.summary).trim(),
    event_type: asString(record.event_type, "other"),
    key_number: asString(record.key_number).trim(),
    tickers: asStringList(record.tickers).map((ticker) => ticker.toUpperCase()),
    news_ids: asStringList(record.news_ids),
    unverified: record.unverified === true,
    source: asString(record.source).trim(),
  };
}

function asCaution(value: unknown, index: number): StockCaution | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const title = asString(record.title).trim();
  const reason = asString(record.reason).trim();
  if (!title || !reason) return null;
  const level = asString(record.level, "medium");
  return {
    id: asString(record.id, `caution-${index}`),
    title,
    reason,
    via: asString(record.via).trim(),
    level: LEVELS.has(level) ? (level as StockCaution["level"]) : "medium",
    tickers: asStringList(record.tickers).map((ticker) => ticker.toUpperCase()),
    news_ids: asStringList(record.news_ids),
  };
}

function asProfile(value: unknown, index: number): StockProfile | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const ticker = asString(record.ticker).trim().toUpperCase();
  const name = asString(record.name).trim();
  if (!ticker || !name) return null;
  const backfill = Array.isArray(record.backfill) ? record.backfill.flatMap((row, rowIndex) => {
    const event = asEvent(row, rowIndex);
    return event ? [event] : [];
  }) : [];
  const catalysts = Array.isArray(record.catalysts) ? record.catalysts.flatMap((row, rowIndex) => {
    const event = asEvent(row, rowIndex);
    return event ? [event] : [];
  }) : [];
  const cautions = Array.isArray(record.cautions) ? record.cautions.flatMap((row, rowIndex) => {
    const caution = asCaution(row, rowIndex);
    return caution ? [caution] : [];
  }) : [];
  return {
    ticker,
    name,
    industry: asString(record.industry, "Other"),
    group: asString(record.group, "Other"),
    order: typeof record.order === "number" && !Number.isNaN(record.order) ? record.order : index,
    blurb: asString(record.blurb).trim(),
    peers: asStringList(record.peers).map((peer) => peer.toUpperCase()),
    pin_ids: asStringList(record.pin_ids),
    skip_ids: asStringList(record.skip_ids),
    macro_ids: asStringList(record.macro_ids),
    backfill,
    catalysts,
    cautions,
  };
}

export function normalizeStocks(input: unknown): { groups: string[]; stocks: StockProfile[] } {
  const record = (input ?? {}) as { groups?: unknown; stocks?: unknown };
  const groups = asStringList(record.groups);
  const rows = Array.isArray(record.stocks) ? record.stocks : [];
  const stocks: StockProfile[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const profile = asProfile(row, index);
    if (!profile || seen.has(profile.ticker)) continue;
    seen.add(profile.ticker);
    stocks.push(profile);
  }
  stocks.sort((a, b) => a.order - b.order || a.ticker.localeCompare(b.ticker));
  return { groups, stocks };
}

const parsed = normalizeStocks(raw);

export const STOCK_GROUPS = parsed.groups;
export const STOCKS = parsed.stocks;
export const STOCK_BY_TICKER = new Map(STOCKS.map((stock) => [stock.ticker, stock]));

export type StoryBeat = {
  id: string;
  date: string;
  datePrecision: DatePrecision;
  status: Status;
  title: string;
  summary: string;
  eventType: string;
  keyNumber: string;
  unverified: boolean;
  source: string;
  newsId: string | null;
  tickers: string[];
};

export type StockStory = {
  profile: StockProfile;
  history: StoryBeat[];
  coming: StoryBeat[];
  connections: NewsItem[];
  linkedTickers: string[];
};

const STORY_AS_OF = "2026-11-02";

function fromNews(item: NewsItem): StoryBeat {
  return {
    id: item.id,
    date: item.date,
    datePrecision: item.date_precision,
    status: item.status,
    title: item.title,
    summary: item.summary,
    eventType: item.event_type,
    keyNumber: item.key_number,
    unverified: false,
    source: "",
    newsId: item.id,
    tickers: item.tickers,
  };
}

function fromEvent(event: StoryEvent): StoryBeat {
  return {
    id: event.id,
    date: event.date,
    datePrecision: event.date_precision,
    status: event.status,
    title: event.title,
    summary: event.summary,
    eventType: event.event_type,
    keyNumber: event.key_number,
    unverified: event.unverified,
    source: event.source,
    newsId: event.news_ids[0] ?? null,
    tickers: event.tickers,
  };
}

function place(status: Status, date: string, asOf: string, forceComing = false): "history" | "coming" {
  if (forceComing) return "coming";
  if (status === "happened") return "history";
  if (status === "developing" && date < asOf) return "history";
  return "coming";
}

function byDateDesc(a: StoryBeat, b: StoryBeat): number {
  return b.date.localeCompare(a.date) || a.title.localeCompare(b.title);
}

function byDateAsc(a: StoryBeat, b: StoryBeat): number {
  return a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
}

export function assembleStock(profile: StockProfile, items: NewsItem[], today: string | null): StockStory {
  const asOf = today ?? STORY_AS_OF;
  const byId = indexById(items);
  const pins = new Set(profile.pin_ids);
  const skips = new Set(profile.skip_ids);
  const seen = new Set<string>();
  const history: StoryBeat[] = [];
  const coming: StoryBeat[] = [];

  function push(beat: StoryBeat, bucket: "history" | "coming") {
    if (seen.has(beat.id)) return;
    seen.add(beat.id);
    if (bucket === "history") history.push(beat);
    else coming.push(beat);
  }

  for (const item of items) {
    if (item.graph_only) continue;
    const pinned = pins.has(item.id);
    const listed = item.tickers.includes(profile.ticker);
    if (!listed && !pinned) continue;
    if (skips.has(item.id) && !pinned) continue;
    const owns = item.tickers[0] === profile.ticker;
    if (!owns && !pinned) continue;
    push(fromNews(item), place(item.status, item.date, asOf));
  }

  for (const event of profile.backfill) {
    push(fromEvent(event), place(event.status, event.date, asOf));
  }
  for (const event of profile.catalysts) {
    push(fromEvent(event), "coming");
  }
  for (const id of profile.macro_ids) {
    const item = byId.get(id);
    if (!item || item.graph_only || item.status === "happened") continue;
    push(fromNews(item), place(item.status, item.date, asOf));
  }

  history.sort(byDateDesc);
  coming.sort(byDateAsc);

  const shown = new Set([...history, ...coming].map((beat) => beat.newsId).filter((id): id is string => Boolean(id)));
  const cautionIds = profile.cautions.flatMap((caution) => caution.news_ids);
  const relatedIds = [...history, ...coming].flatMap((beat) => {
    if (!beat.newsId) return [];
    return byId.get(beat.newsId)?.related_ids ?? [];
  });
  const connectionIds = [...cautionIds, ...relatedIds].filter((id) => !shown.has(id) && byId.has(id));
  const uniqueConnections: NewsItem[] = [];
  const used = new Set<string>();
  for (const id of connectionIds) {
    if (used.has(id)) continue;
    used.add(id);
    const item = byId.get(id);
    if (item && !item.graph_only) uniqueConnections.push(item);
  }
  uniqueConnections.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const linked = new Set<string>();
  for (const peer of profile.peers) linked.add(peer);
  for (const caution of profile.cautions) for (const ticker of caution.tickers) linked.add(ticker);
  for (const beat of [...history, ...coming]) for (const ticker of beat.tickers) linked.add(ticker);
  linked.delete(profile.ticker);
  const linkedTickers = [...linked].sort((a, b) => {
    const aStory = STOCK_BY_TICKER.has(a) ? 0 : 1;
    const bStory = STOCK_BY_TICKER.has(b) ? 0 : 1;
    return aStory - bStory || a.localeCompare(b);
  });

  return {
    profile,
    history,
    coming,
    connections: uniqueConnections.slice(0, 8),
    linkedTickers,
  };
}

export function cautionCounts(cautions: StockCaution[]): { high: number; medium: number; low: number; total: number } {
  const counts = { high: 0, medium: 0, low: 0, total: cautions.length };
  for (const caution of cautions) counts[caution.level] += 1;
  return counts;
}
