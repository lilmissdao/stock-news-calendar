import type { FilterState, NewsItem } from "./types";

export const EMPTY_FILTERS: FilterState = {
  industries: [],
  query: "",
  eventType: "",
  statuses: [],
  priceMin: "",
  priceMax: "",
  moveDir: "any",
  moveMin: "",
};

function parseBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function filtersActive(filters: FilterState): boolean {
  return (
    filters.industries.length > 0 ||
    filters.query.trim() !== "" ||
    filters.eventType !== "" ||
    filters.statuses.length > 0 ||
    filters.priceMin.trim() !== "" ||
    filters.priceMax.trim() !== "" ||
    filters.moveDir !== "any" ||
    filters.moveMin.trim() !== ""
  );
}

export function applyFilters(items: NewsItem[], filters: FilterState): NewsItem[] {
  const query = filters.query.trim().toLowerCase();
  const priceMin = parseBound(filters.priceMin);
  const priceMax = parseBound(filters.priceMax);
  const priceActive = priceMin !== null || priceMax !== null;
  const threshold = Math.abs(parseBound(filters.moveMin) ?? 0);
  const moveActive = filters.moveDir !== "any" || threshold > 0;

  return items.filter((item) => {
    if (filters.industries.length > 0 && !filters.industries.includes(item.industry)) return false;
    if (filters.eventType && item.event_type !== filters.eventType) return false;
    if (filters.statuses.length > 0 && !filters.statuses.includes(item.status)) return false;
    if (query) {
      const tickerHit = item.tickers.some((ticker) => ticker.toLowerCase().includes(query));
      const companyHit = item.companies.some((company) => company.toLowerCase().includes(query));
      const titleHit = item.title.toLowerCase().includes(query);
      if (!tickerHit && !companyHit && !titleHit) return false;
    }
    if (priceActive) {
      const price = item.price_mentioned?.price;
      if (price == null) return false;
      if (priceMin !== null && price < priceMin) return false;
      if (priceMax !== null && price > priceMax) return false;
    }
    if (moveActive) {
      if (item.move_pct == null) return false;
      const size = Math.abs(item.move_pct);
      if (size < threshold) return false;
      if (filters.moveDir === "up" && item.move_pct <= 0) return false;
      if (filters.moveDir === "down" && item.move_pct >= 0) return false;
    }
    return true;
  });
}
