"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CalendarView } from "@/components/CalendarView";
import { ConnectionsView } from "@/components/ConnectionsView";
import { DetailDialog } from "@/components/DetailDialog";
import { Filters } from "@/components/Filters";
import { ListView } from "@/components/ListView";
import { TickerView } from "@/components/TickerView";
import { UpcomingPanel } from "@/components/UpcomingPanel";
import { EMPTY_FILTERS, applyFilters, filtersActive } from "@/lib/filter";
import { parseISODate, toISODate } from "@/lib/format";
import { indexById } from "@/lib/news";
import type { FilterState, NewsItem, ViewId } from "@/lib/types";

const VIEWS: { id: ViewId; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List" },
  { id: "ticker", label: "Ticker" },
  { id: "connections", label: "Connections" },
];

export function App({ items }: { items: NewsItem[] }) {
  const [view, setView] = useState<ViewId>("calendar");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [month, setMonth] = useState({ year: 2026, month: 9 });
  const [selectedDay, setSelectedDay] = useState("2026-10-23");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ticker, setTicker] = useState("NVDA");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  const [today, setToday] = useState<string | null>(null);
  const themeReady = useRef(false);

  useLayoutEffect(() => {
    const stored = localStorage.getItem("snc-theme");
    const initial =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initial);
  }, []);

  useLayoutEffect(() => {
    if (!themeReady.current) {
      themeReady.current = true;
      return;
    }
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("snc-theme", theme);
  }, [theme]);

  useEffect(() => {
    setToday(toISODate(new Date()));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedId(null);
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (view !== "calendar" || selectedId) return;
      if (event.key === "ArrowLeft") {
        const date = new Date(month.year, month.month - 1, 1);
        setMonth({ year: date.getFullYear(), month: date.getMonth() });
      }
      if (event.key === "ArrowRight") {
        const date = new Date(month.year, month.month + 1, 1);
        setMonth({ year: date.getFullYear(), month: date.getMonth() });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [month, selectedId, view]);

  const filtered = useMemo(() => applyFilters(items, filters), [items, filters]);
  const byId = useMemo(() => indexById(items), [items]);
  const visibleIds = useMemo(() => new Set(filtered.map((item) => item.id)), [filtered]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  function openItem(id: string) {
    const item = byId.get(id);
    setSelectedId(id);
    if (!item) return;
    const date = parseISODate(item.date);
    setMonth({ year: date.getFullYear(), month: date.getMonth() });
    setSelectedDay(item.date);
  }

  function openTicker(symbol: string) {
    setTicker(symbol);
    setView("ticker");
    setSelectedId(null);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">For Dao</p>
          <h1>Stock News Calendar</h1>
        </div>
        <div className="top-actions">
          <div className="view-switch" role="tablist" aria-label="Views">
            {VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`tab-${entry.id}`}
                aria-selected={view === entry.id}
                aria-controls="view-panel"
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <button type="button" className="filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
            Filters{filtersActive(filters) ? " · on" : ""}
          </button>
          <button
            type="button"
            className="theme"
            aria-pressed={theme === "dark"}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>
      <p className="tally">
        {filtered.length} of {items.length} items
        {filtersActive(filters) ? " match the filters" : ""}. Figures are only the ones written in the news file.
      </p>
      <Filters
        items={items}
        value={filters}
        onChange={setFilters}
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
      />
      <div className="body">
        <main id="view-panel" role="tabpanel" aria-labelledby={`tab-${view}`}>
          {view === "calendar" ? (
            <CalendarView
              items={filtered}
              year={month.year}
              month={month.month}
              today={today}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              onMonth={(year, next) => setMonth({ year, month: next })}
              onOpen={openItem}
            />
          ) : null}
          {view === "list" ? <ListView items={filtered} onOpen={openItem} /> : null}
          {view === "ticker" ? (
            <TickerView items={items} filtered={filtered} ticker={ticker} onTicker={setTicker} onOpen={openItem} />
          ) : null}
          {view === "connections" ? (
            <ConnectionsView items={filtered} byId={byId} selectedId={selectedId} onOpen={openItem} />
          ) : null}
        </main>
        <UpcomingPanel
          items={filtered}
          today={today}
          open={upcomingOpen}
          onToggle={() => setUpcomingOpen((open) => !open)}
          onOpen={openItem}
        />
      </div>
      <DetailDialog
        item={selected}
        byId={byId}
        visibleIds={visibleIds}
        onClose={() => setSelectedId(null)}
        onOpen={openItem}
        onTicker={openTicker}
      />
    </div>
  );
}
