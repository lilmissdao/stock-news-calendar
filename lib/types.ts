export type DatePrecision = "day" | "month" | "quarter" | "unknown";
export type Status = "happened" | "upcoming" | "developing";

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

export type ViewId = "calendar" | "list" | "ticker" | "connections";

export type Story = {
  id: string;
  title: string;
  blurb: string;
  columns: string[][];
};
