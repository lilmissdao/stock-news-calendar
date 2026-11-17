import type { DatePrecision, DealStatus, NewsItem, Status, TrackerSection } from "./types";

/**
 * Enterprise AI tracker.
 *
 * Daily updates go in `data/enterprise-ai.json`, then `npm run briefs`.
 * The script checks the file and writes a count into `data/briefs.json`.
 * The calendar reads the same file at build time. Field meanings are in the README.
 */

export const DEAL_TYPES = [
  "partnership",
  "contract",
  "reseller",
  "infrastructure",
  "datacenter",
  "sovereign",
  "customer_win",
  "pricing",
  "product_launch",
  "ipo",
  "earnings",
  "capacity",
  "financing",
  "power",
] as const;

export type DealType = (typeof DEAL_TYPES)[number];

const SECTIONS = new Set<TrackerSection>(["deal", "neocloud", "datacenter"]);
const DEAL_STATUSES = new Set<DealStatus>(["done", "in_the_works", "rumored"]);
const PRECISIONS = new Set<DatePrecision>(["day", "month", "quarter", "unknown"]);
const DEAL_TYPE_SET = new Set<string>(DEAL_TYPES);

export const SECTION_LABELS: Record<TrackerSection, string> = {
  deal: "Deals",
  neocloud: "Neoclouds",
  datacenter: "Data centers",
};

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  done: "Done",
  in_the_works: "In the works",
  rumored: "Rumored",
};

export const DEAL_TYPE_LABELS: Record<string, string> = {
  partnership: "Partnership",
  contract: "Contract",
  reseller: "Reseller",
  infrastructure: "Infrastructure",
  datacenter: "Data center",
  sovereign: "Sovereign AI",
  customer_win: "Customer win",
  pricing: "Pricing",
  product_launch: "Product launch",
  ipo: "IPO",
  earnings: "Earnings",
  capacity: "Capacity",
  financing: "Financing",
  power: "Power",
};

export type TrackerFact = { label: string; value: string };

export type TrackerNextEvent = {
  date: string;
  date_precision: DatePrecision;
  label: string;
  item_id: string;
  unconfirmed: boolean;
};

export type TrackerCompany = {
  id: string;
  name: string;
  ticker: string;
  sections: TrackerSection[];
  card_in: TrackerSection[];
  watch: boolean;
  order: number;
  blurb: string;
  facts: TrackerFact[];
  next_event: TrackerNextEvent | null;
  links: string[];
  location: string;
  size: string;
  cost: string;
  power: string;
  partners: string;
  project_status: string;
};

export type TrackerFile = {
  companies: TrackerCompany[];
  items: NewsItem[];
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function asSections(value: unknown, label: string, allowEmpty = false): TrackerSection[] {
  const list = asStringList(value, label);
  if (!allowEmpty && list.length === 0) throw new Error(`${label} needs at least one section`);
  for (const entry of list) {
    if (!SECTIONS.has(entry as TrackerSection)) throw new Error(`${label} has unknown section ${entry}`);
  }
  return list as TrackerSection[];
}

function asFacts(value: unknown, label: string): TrackerFact[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  return value.map((entry, index) => {
    const record = asRecord(entry, `${label}[${index}]`);
    return {
      label: asString(record.label, `${label}[${index}].label`),
      value: asString(record.value, `${label}[${index}].value`),
    };
  });
}

function newsStatus(status: DealStatus, dealType: string, date: string, today: string): Status {
  if (status === "done") return "happened";
  if (status === "rumored") return "developing";
  if (date >= today && (dealType === "earnings" || dealType === "ipo")) return "upcoming";
  return "developing";
}

function eventType(dealType: string): string {
  if (dealType === "earnings" || dealType === "ipo") return dealType;
  return "deal";
}

export function sectionPath(section: TrackerSection): string {
  if (section === "neocloud") return "/enterprise-ai/neoclouds";
  if (section === "datacenter") return "/enterprise-ai/datacenters";
  return "/enterprise-ai";
}

export function loadTracker(raw: unknown, today: string): TrackerFile {
  const root = asRecord(raw, "enterprise-ai.json");
  if (typeof root.note !== "string" || !root.note.trim()) {
    throw new Error("enterprise-ai.json needs a note describing the file");
  }
  if (!Array.isArray(root.companies) || !Array.isArray(root.items)) {
    throw new Error("enterprise-ai.json needs companies and items arrays");
  }

  const companies: TrackerCompany[] = root.companies.map((entry, index) => {
    const record = asRecord(entry, `companies[${index}]`);
    const id = asString(record.id, `companies[${index}].id`);
    const sections = asSections(record.sections, `${id}.sections`);
    const next = record.next_event;
    let nextEvent: TrackerNextEvent | null = null;
    if (next !== null) {
      const event = asRecord(next, `${id}.next_event`);
      const date = asString(event.date, `${id}.next_event.date`);
      const precision = asString(event.date_precision, `${id}.next_event.date_precision`);
      if (!DATE.test(date)) throw new Error(`${id}.next_event.date is not YYYY-MM-DD`);
      if (!PRECISIONS.has(precision as DatePrecision)) throw new Error(`${id}.next_event.date_precision is invalid`);
      nextEvent = {
        date,
        date_precision: precision as DatePrecision,
        label: asString(event.label, `${id}.next_event.label`),
        item_id: asString(event.item_id, `${id}.next_event.item_id`),
        unconfirmed: event.unconfirmed === true,
      };
    }
    return {
      id,
      name: asString(record.name, `${id}.name`),
      ticker: asString(record.ticker, `${id}.ticker`),
      sections,
      card_in: asSections(record.card_in ?? [], `${id}.card_in`, true).filter((section) => sections.includes(section)),
      watch: record.watch === true,
      order: typeof record.order === "number" ? record.order : index,
      blurb: asString(record.blurb, `${id}.blurb`),
      facts: asFacts(record.facts ?? [], `${id}.facts`),
      next_event: nextEvent,
      links: asStringList(record.links ?? [], `${id}.links`),
      location: asString(record.location ?? "", `${id}.location`),
      size: asString(record.size ?? "", `${id}.size`),
      cost: asString(record.cost ?? "", `${id}.cost`),
      power: asString(record.power ?? "", `${id}.power`),
      partners: asString(record.partners ?? "", `${id}.partners`),
      project_status: asString(record.project_status ?? "", `${id}.project_status`),
    };
  });

  const companyIds = new Set<string>();
  for (const company of companies) {
    if (companyIds.has(company.id)) throw new Error(`Duplicate company id ${company.id}`);
    companyIds.add(company.id);
  }

  const items: NewsItem[] = root.items.map((entry, index) => {
    const record = asRecord(entry, `items[${index}]`);
    const id = asString(record.id, `items[${index}].id`);
    const date = asString(record.date, `${id}.date`);
    const precision = asString(record.date_precision, `${id}.date_precision`);
    const status = asString(record.status, `${id}.status`);
    const dealType = asString(record.deal_type, `${id}.deal_type`);
    const sections = asSections(record.sections, `${id}.sections`);
    const companyList = asStringList(record.company_ids, `${id}.company_ids`);
    if (!DATE.test(date)) throw new Error(`${id}.date is not YYYY-MM-DD`);
    if (!PRECISIONS.has(precision as DatePrecision)) throw new Error(`${id}.date_precision is invalid`);
    if (!DEAL_STATUSES.has(status as DealStatus)) throw new Error(`${id}.status is invalid`);
    if (!DEAL_TYPE_SET.has(dealType)) throw new Error(`${id}.deal_type is invalid`);
    if (companyList.length === 0) throw new Error(`${id} needs a company`);
    for (const companyId of companyList) {
      if (!companyIds.has(companyId)) throw new Error(`${id} names unknown company ${companyId}`);
    }
    if (typeof record.unconfirmed !== "boolean") throw new Error(`${id}.unconfirmed must be true or false`);
    const summary = asString(record.summary, `${id}.summary`).trim();
    const why = asString(record.why_it_matters, `${id}.why_it_matters`).trim();
    if (!summary) throw new Error(`${id} needs a summary`);
    if (!why) throw new Error(`${id} needs why_it_matters`);
    const dealStatus = status as DealStatus;
    return {
      id,
      date,
      date_precision: precision as DatePrecision,
      status: newsStatus(dealStatus, dealType, date, today),
      title: asString(record.title, `${id}.title`).trim(),
      summary,
      tickers: asStringList(record.tickers, `${id}.tickers`),
      companies: asStringList(record.companies, `${id}.companies`),
      industry: "Enterprise AI",
      event_type: eventType(dealType),
      key_number: asString(record.key_number, `${id}.key_number`),
      price_mentioned: null,
      move_pct: null,
      source_digest_date: "2026-11-16",
      related_ids: asStringList(record.related_ids, `${id}.related_ids`),
      connection_notes: why,
      graph_node: null,
      graph_only: false,
      link_kinds: {},
      enterprise_ai: true,
      tracker_sections: sections,
      tracker_companies: companyList,
      deal_type: dealType,
      deal_status: dealStatus,
      why_it_matters: why,
      source_url: asString(record.source, `${id}.source`),
      source_label: asString(record.source_label, `${id}.source_label`),
      unconfirmed: record.unconfirmed === true,
    };
  });

  const itemIds = new Set<string>();
  for (const item of items) {
    if (!item.title) throw new Error(`${item.id} needs a title`);
    if (itemIds.has(item.id)) throw new Error(`Duplicate item id ${item.id}`);
    itemIds.add(item.id);
  }
  for (const item of items) {
    for (const related of item.related_ids) {
      if (!itemIds.has(related)) throw new Error(`${item.id} related_ids missing ${related}`);
    }
  }
  for (const company of companies) {
    if (company.next_event && !itemIds.has(company.next_event.item_id)) {
      throw new Error(`${company.id} next_event item is missing`);
    }
  }

  return { companies, items };
}

export function mergeTracker(news: NewsItem[], tracker: TrackerFile): NewsItem[] {
  const ids = new Set(news.map((item) => item.id));
  const extra = tracker.items.filter((item) => {
    if (ids.has(item.id)) throw new Error(`Tracker id collides with news.json: ${item.id}`);
    return true;
  });
  return [...news, ...extra];
}
