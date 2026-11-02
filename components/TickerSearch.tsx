"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { suggest, tickerCatalog, type Suggestion } from "@/lib/search";
import type { NewsItem } from "@/lib/types";

export function TickerSearch({ items, onPick }: { items: NewsItem[]; onPick: (ticker: string) => void }) {
  const catalog = useMemo(() => tickerCatalog(items), [items]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const hits = useMemo(() => suggest(catalog, query), [catalog, query]);
  const shown = open && query.trim().length > 0;
  const activeIndex = hits.length === 0 ? 0 : Math.min(active, hits.length - 1);

  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  function choose(hit: Suggestion) {
    onPick(hit.ticker);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (hits.length === 0) return;
      setActive((index) => (Math.min(index, hits.length - 1) + 1) % hits.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (hits.length === 0) return;
      setActive((index) => (Math.min(index, hits.length - 1) - 1 + hits.length) % hits.length);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[activeIndex];
      if (hit) choose(hit);
    }
  }

  return (
    <div className="ticker-search" ref={box}>
      <label className="sr" htmlFor="ticker-search">
        Search ticker or company
      </label>
      <input
        id="ticker-search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && hits[activeIndex] ? `${listId}-${hits[activeIndex].ticker}` : undefined}
        placeholder="Ticker or company"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {shown ? (
        <ul id={listId} className="suggest" role="listbox" aria-label="Matching stocks">
          {hits.length === 0 ? <li className="suggest-empty">No match</li> : null}
          {hits.map((hit, index) => (
            <li key={hit.ticker} role="presentation">
              <button
                type="button"
                role="option"
                id={`${listId}-${hit.ticker}`}
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(hit)}
              >
                <span className="suggest-ticker">{hit.ticker}</span>
                <span className="suggest-name">{hit.name}</span>
                <span className="suggest-hint">{hit.story ? "Story" : "Chart"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
