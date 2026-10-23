import { useMemo, useState } from "react";
import { ItemCard } from "@/components/ItemCard";
import { formatPretty } from "@/lib/format";
import type { NewsItem } from "@/lib/types";

export function ListView({ items, onOpen }: { items: NewsItem[]; onOpen: (id: string) => void }) {
  const [newest, setNewest] = useState(false);
  const groups = useMemo(() => {
    const sorted = items.slice().sort((a, b) => {
      if (a.date !== b.date) return newest ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date);
      const rank = (item: NewsItem) => (item.date_precision === "day" ? 0 : 1);
      return rank(a) - rank(b);
    });
    const map = new Map<string, NewsItem[]>();
    for (const item of sorted) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return [...map.entries()];
  }, [items, newest]);

  if (items.length === 0) return <p className="empty">No items match these filters.</p>;

  return (
    <div className="timeline">
      <div className="timeline-head">
        <h2>Timeline</h2>
        <button type="button" className="text-btn" onClick={() => setNewest((value) => !value)} aria-pressed={newest}>
          {newest ? "Newest first" : "Oldest first"}
        </button>
      </div>
      {groups.map(([date, group]) => (
        <section key={date} className="t-day">
          <h3>{formatPretty(date)}</h3>
          <div className="t-cards">
            {group.map((item) => (
              <ItemCard key={item.id} item={item} onOpen={onOpen} showSummary />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
