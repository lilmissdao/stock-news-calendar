"use client";

import { BinaryView } from "@/components/BinaryView";
import { ConnectionsView } from "@/components/ConnectionsView";
import { ItemCard } from "@/components/ItemCard";
import type { BinaryItem } from "@/lib/binary";
import type { NewsItem, PharmaSection } from "@/lib/types";

const SECTIONS: { id: PharmaSection; href: string; label: string }[] = [
  { id: "news", href: "/pharma", label: "News" },
  { id: "rivalries", href: "/pharma/rivalries", label: "Drug rivalries" },
  { id: "binary", href: "/pharma/binary-bets", label: "Binary Bets" },
];

export function pharmaPath(section: PharmaSection): string {
  return SECTIONS.find((entry) => entry.id === section)?.href ?? "/pharma";
}

export function PharmaView({
  section,
  items,
  filtered,
  binaryItems,
  byId,
  selectedId,
  today,
  onOpen,
}: {
  section: PharmaSection;
  items: NewsItem[];
  filtered: NewsItem[];
  binaryItems: BinaryItem[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  today: string;
  onOpen: (id: string) => void;
}) {
  const news = filtered
    .filter((item) => item.industry === "Pharma/Biotech" && !item.graph_only && !item.binary_bet)
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  return (
    <div className="eai">
      <header className="eai-intro">
        <p className="kicker">Pharma/Biotech</p>
        <h2>News, rivalries, and binary bets</h2>
        <p>
          One area for the Pharma/Biotech file. News is the calendar rows in that industry, including rare-disease items.
          Drug rivalries draws each company that has a graph node. Binary Bets is the catalyst list, with the Early warning
          filter. Those catalysts also sit on the calendar under Pharma/Biotech and keep the Binary Bets badge.
        </p>
      </header>
      <nav className="eai-subnav" aria-label="Pharma/Biotech sections">
        {SECTIONS.map((entry) => (
          <a key={entry.id} href={entry.href} aria-current={entry.id === section ? "page" : undefined}>
            {entry.label}
          </a>
        ))}
      </nav>
      {section === "news" ? (
        <section aria-labelledby="pharma-news">
          <h2 id="pharma-news">News</h2>
          <p className="tally">
            {news.length} Pharma/Biotech item{news.length === 1 ? "" : "s"}
            {news.length === filtered.filter((item) => item.industry === "Pharma/Biotech").length ? "" : " after filters"}.
            Binary catalysts are on the Binary Bets section.
          </p>
          {news.length === 0 ? <p className="empty">No Pharma/Biotech news matches these filters.</p> : null}
          <div className="binary-list">
            {news.map((item) => (
              <ItemCard key={item.id} item={item} onOpen={onOpen} showDate showSummary />
            ))}
          </div>
        </section>
      ) : null}
      {section === "rivalries" ? (
        <ConnectionsView
          items={items}
          byId={byId}
          selectedId={selectedId}
          onOpen={onOpen}
          story="drug-rivalries"
        />
      ) : null}
      {section === "binary" ? <BinaryView items={filtered} records={binaryItems} today={today} onOpen={onOpen} /> : null}
    </div>
  );
}
