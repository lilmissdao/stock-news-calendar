export type DatePrecision = "day" | "month" | "quarter" | "unknown";
export type Status = "happened" | "upcoming" | "developing";
export type Reliance = "very_high" | "high" | "medium" | "low";
export type LinkKind = "rival" | "generic_threat" | "royalty" | "unverified";

export type GraphNode = {
  label: string;
  drug: string;
  reliance: Reliance | null;
  market_cap_b: number | null;
  cluster: string;
  order: number;
  unverified: boolean;
  generic: boolean;
};

export type PriceMention = {
  ticker: string;
  price: number;
};

export type NewsItem = {
  id: string;
  date: string;
  date_precision: DatePrecision;
  status: Status;
  title: string;
  summary: string;
  tickers: string[];
  companies: string[];
  industry: string;
  event_type: string;
  key_number: string;
  price_mentioned: PriceMention | null;
  move_pct: number | null;
  source_digest_date: string;
  related_ids: string[];
  connection_notes: string;
  graph_node: GraphNode | null;
  graph_only: boolean;
  link_kinds: Partial<Record<string, LinkKind>>;
};

export type MoveDir = "any" | "up" | "down";

export type FilterState = {
  industries: string[];
  query: string;
  eventType: string;
  statuses: Status[];
  priceMin: string;
  priceMax: string;
  moveDir: MoveDir;
  moveMin: string;
};

export type ViewId = "calendar" | "list" | "ticker" | "stocks" | "connections";

export type CautionLevel = "high" | "medium" | "low";

export type StoryEvent = {
  id: string;
  date: string;
  date_precision: DatePrecision;
  status: Status;
  title: string;
  summary: string;
  event_type: string;
  key_number: string;
  tickers: string[];
  news_ids: string[];
  unverified: boolean;
  source: string;
};

export type StockCaution = {
  id: string;
  title: string;
  reason: string;
  via: string;
  level: CautionLevel;
  tickers: string[];
  news_ids: string[];
};

export type StockProfile = {
  ticker: string;
  name: string;
  industry: string;
  group: string;
  order: number;
  blurb: string;
  peers: string[];
  pin_ids: string[];
  skip_ids: string[];
  macro_ids: string[];
  backfill: StoryEvent[];
  catalysts: StoryEvent[];
  cautions: StockCaution[];
};

export type Story = {
  id: string;
  title: string;
  blurb: string;
  columns: string[][];
};
