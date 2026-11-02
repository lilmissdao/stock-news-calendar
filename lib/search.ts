import names from "@/data/ticker-names.json";
import { STOCK_BY_TICKER, STOCKS } from "@/lib/stocks";
import type { NewsItem } from "@/lib/types";

const NAME_MAP = names as Record<string, string>;

export type Suggestion = {
  ticker: string;
  name: string;
  story: boolean;
};

function addTicker(set: Set<string>, ticker: string) {
  const symbol = ticker.trim().toUpperCase();
  if (symbol) set.add(symbol);
}

export function tickerCatalog(items: NewsItem[]): Suggestion[] {
  const tickers = new Set<string>(Object.keys(NAME_MAP));
  for (const item of items) for (const ticker of item.tickers) addTicker(tickers, ticker);
  for (const stock of STOCKS) {
    addTicker(tickers, stock.ticker);
    for (const peer of stock.peers) addTicker(tickers, peer);
    for (const caution of stock.cautions) for (const ticker of caution.tickers) addTicker(tickers, ticker);
    for (const event of [...stock.backfill, ...stock.catalysts]) {
      for (const ticker of event.tickers) addTicker(tickers, ticker);
    }
  }
  return [...tickers]
    .map((ticker) => ({
      ticker,
      name: STOCK_BY_TICKER.get(ticker)?.name || NAME_MAP[ticker] || ticker,
      story: STOCK_BY_TICKER.has(ticker),
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function rank(query: string, hit: Suggestion): number | null {
  const ticker = hit.ticker.toLowerCase();
  const name = hit.name.toLowerCase();
  if (ticker === query) return 0;
  if (ticker.startsWith(query)) return 1;
  if (name.startsWith(query)) return 2;
  const words = name.split(/[^a-z0-9&]+/i).filter(Boolean);
  if (words.some((word) => word.startsWith(query))) return 3;
  if (ticker.includes(query)) return 4;
  if (name.includes(query)) return 5;
  return null;
}

export function suggest(catalog: Suggestion[], raw: string, limit = 8): Suggestion[] {
  const query = raw.trim().toLowerCase();
  if (!query) return [];
  const ranked: { hit: Suggestion; rank: number }[] = [];
  for (const hit of catalog) {
    const score = rank(query, hit);
    if (score == null) continue;
    ranked.push({ hit, rank: score });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.hit.ticker.localeCompare(b.hit.ticker) || a.hit.name.localeCompare(b.hit.name));
  return ranked.slice(0, limit).map((entry) => entry.hit);
}
