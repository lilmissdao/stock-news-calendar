import raw from "@/data/briefs.json";
import { dayBrief, itemBrief, sameIds, stockBrief, type Brief } from "@/lib/brief";
import type { StockStory } from "@/lib/stocks";
import type { NewsItem, StockProfile } from "@/lib/types";

type StoredDay = Brief & { ids: string[] };
type StoredStock = Brief & { historyIds: string[]; comingIds: string[]; cautionIds: string[] };

type BriefFile = {
  days: Record<string, StoredDay>;
  stocks: Record<string, StoredStock>;
  items: Record<string, string>;
};

const file = raw as BriefFile;

function sourceContains(item: NewsItem, brief: string): boolean {
  return `${item.title}\n${item.summary}\n${item.key_number}`.includes(brief);
}

export function itemBriefFor(item: NewsItem): string | null {
  const stored = file.items[item.id];
  if (stored && sourceContains(item, stored)) return stored;
  return itemBrief(item);
}

export function dayBriefFor(date: string, items: NewsItem[]): Brief | null {
  const visible = items.filter((item) => !item.graph_only && item.title.trim());
  if (visible.length === 0) return null;
  const ids = visible.map((item) => item.id);
  const stored = file.days[date];
  if (stored && sameIds(stored.ids, ids)) return { lead: stored.lead, bullets: stored.bullets };
  return dayBrief(visible);
}

export function stockBriefFor(profile: StockProfile, story: StockStory): Brief | null {
  const historyIds = story.history.map((beat) => beat.id);
  const comingIds = story.coming.map((beat) => beat.id);
  const cautionIds = profile.cautions.map((caution) => caution.id);
  const stored = file.stocks[profile.ticker];
  if (
    stored &&
    sameIds(stored.historyIds, historyIds) &&
    sameIds(stored.comingIds, comingIds) &&
    sameIds(stored.cautionIds, cautionIds)
  ) {
    return { lead: stored.lead, bullets: stored.bullets };
  }
  return stockBrief({
    ticker: profile.ticker,
    history: story.history,
    coming: story.coming,
    cautions: profile.cautions,
  });
}
