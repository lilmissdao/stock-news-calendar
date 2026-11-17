export type DatePrecision = "day" | "month" | "quarter" | "unknown";
export type Status = "happened" | "upcoming" | "developing";
export type TrackerSection = "deal" | "neocloud" | "datacenter";
export type DealStatus = "done" | "in_the_works" | "rumored";
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
  enterprise_ai?: boolean;
  tracker_sections?: TrackerSection[];
  tracker_companies?: string[];
  deal_type?: string;
  deal_status?: DealStatus;
  why_it_matters?: string;
  source_url?: string;
  source_label?: string;
  unconfirmed?: boolean;
  binary_bet?: boolean;
  binary_timing?: "confirmed" | "expected";
  binary_type?: string;
  drug?: string;
  indication?: string;
  success_means?: string;
  miss_means?: string;
  cash_line?: string;
  outcome_line?: string;
  tags?: string[];
  early_warning?: boolean;
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
  enterpriseOnly: boolean;
  binaryOnly: boolean;
  earlyWarningOnly: boolean;
};

export type PharmaSection = "news" | "rivalries" | "binary";

export type ViewId = "calendar" | "list" | "ticker" | "stocks" | "connections" | "enterprise" | "pharma";

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
