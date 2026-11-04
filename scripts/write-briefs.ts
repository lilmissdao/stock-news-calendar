import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import news from "../data/news.json";
import { dayBrief, itemBrief, stockBrief } from "../lib/brief";
import { todayInNewYork } from "../lib/format";
import { normalizeNews } from "../lib/news";
import { STOCKS, assembleStock } from "../lib/stocks";
import type { NewsItem } from "../lib/types";

const root = dirname(fileURLToPath(import.meta.url));
const items = normalizeNews(news);
const asOf = todayInNewYork();
const days: Record<string, { ids: string[]; lead: string; bullets: string[] }> = {};
const byDate = new Map<string, NewsItem[]>();

for (const item of items) {
  if (item.graph_only || item.date_precision !== "day") continue;
  const list = byDate.get(item.date) ?? [];
  list.push(item);
  byDate.set(item.date, list);
}

for (const date of [...byDate.keys()].sort()) {
  const group = byDate.get(date) ?? [];
  const brief = dayBrief(group);
  if (!brief) continue;
  for (const bullet of brief.bullets) {
    const named = group.some((item) => bullet.includes(item.title));
    if (!named) throw new Error(`Day ${date} bullet does not cite an item title: ${bullet}`);
  }
  days[date] = {
    ids: group.map((item) => item.id).sort(),
    lead: brief.lead,
    bullets: brief.bullets,
  };
}

const stocks: Record<
  string,
  { historyIds: string[]; comingIds: string[]; cautionIds: string[]; lead: string; bullets: string[] }
> = {};
for (const profile of STOCKS) {
  const story = assembleStock(profile, items, asOf);
  const brief = stockBrief({
    ticker: profile.ticker,
    history: story.history,
    coming: story.coming,
    cautions: profile.cautions,
  });
  if (!brief) continue;
  for (const bullet of brief.bullets) {
    const named =
      story.history.some((beat) => bullet.includes(beat.title)) ||
      story.coming.some((beat) => bullet.includes(beat.title)) ||
      profile.cautions.some((caution) => bullet.includes(caution.title));
    if (!named) throw new Error(`${profile.ticker} bullet does not cite a source title: ${bullet}`);
  }
  stocks[profile.ticker] = {
    historyIds: story.history.map((beat) => beat.id).sort(),
    comingIds: story.coming.map((beat) => beat.id).sort(),
    cautionIds: profile.cautions.map((caution) => caution.id).sort(),
    lead: brief.lead,
    bullets: brief.bullets,
  };
}

const briefs: Record<string, string> = {};
for (const item of items) {
  if (item.graph_only) continue;
  const brief = itemBrief(item);
  if (!brief) continue;
  const blob = `${item.title}\n${item.summary}\n${item.key_number}`;
  if (!blob.includes(brief)) throw new Error(`Item brief is not in the source text: ${item.id}`);
  briefs[item.id] = brief;
}

const payload = {
  note: "Built from data/news.json and data/stocks.json. Each line repeats a title, key number, price, move, or caution already in those files.",
  asOf,
  days,
  stocks,
  items: briefs,
};

const path = join(root, "../data/briefs.json");
writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `Wrote ${path} as of ${asOf}: ${Object.keys(days).length} days, ${Object.keys(stocks).length} stocks, ${Object.keys(briefs).length} long items.`,
);
