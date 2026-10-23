import { useMemo, useState } from "react";
import { ItemCard } from "@/components/ItemCard";
import { daysBetween, formatMove, formatPretty, formatPrice, formatShort, parseISODate } from "@/lib/format";
import type { NewsItem } from "@/lib/types";

type PricePoint = { id: string; date: string; price: number; title: string };
type MovePoint = { id: string; date: string; move: number; title: string; sole: boolean };

const WIDTH = 720;
const HEIGHT = 210;
const MARGIN = { left: 52, right: 16, top: 16, bottom: 28 };

function domain(times: number[]): [number, number] {
  let min = Math.min(...times);
  let max = Math.max(...times);
  if (max - min < 86_400_000 * 2) {
    min -= 86_400_000 * 3;
    max += 86_400_000 * 3;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

function xOf(time: number, range: [number, number]): number {
  const [min, max] = range;
  const span = max - min || 1;
  return MARGIN.left + ((time - min) / span) * (WIDTH - MARGIN.left - MARGIN.right);
}

function ticks(range: [number, number], dates: string[]): string[] {
  const unique = [...new Set(dates)].sort();
  if (unique.length <= 6) return unique;
  const [min, max] = range;
  return [0, 0.5, 1].map((t) => {
    const time = min + (max - min) * t;
    const date = new Date(time);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  });
}

export function TickerView({
  items,
  filtered,
  ticker,
  onTicker,
  onOpen,
}: {
  items: NewsItem[];
  filtered: NewsItem[];
  ticker: string;
  onTicker: (ticker: string) => void;
  onOpen: (id: string) => void;
}) {
  const [includeLinked, setIncludeLinked] = useState(true);
  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const symbol of item.tickers) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const primary = useMemo(
    () => filtered.filter((item) => item.tickers.includes(ticker)).slice().sort((a, b) => a.date.localeCompare(b.date)),
    [filtered, ticker],
  );
  const primaryIds = useMemo(() => new Set(primary.map((item) => item.id)), [primary]);
  const linked = useMemo(() => {
    if (!includeLinked) return [];
    return filtered
      .filter(
        (item) =>
          !primaryIds.has(item.id) &&
          (item.related_ids.some((id) => primaryIds.has(id)) || primary.some((entry) => entry.related_ids.includes(item.id))),
      )
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered, includeLinked, primary, primaryIds]);

  const prices: PricePoint[] = primary
    .filter((item) => item.price_mentioned?.ticker === ticker)
    .map((item) => ({
      id: item.id,
      date: item.date,
      price: item.price_mentioned!.price,
      title: item.title,
    }));
  const moves: MovePoint[] = primary
    .filter((item) => item.move_pct != null && item.date_precision === "day")
    .map((item) => ({
      id: item.id,
      date: item.date,
      move: item.move_pct!,
      title: item.title,
      sole: item.tickers.length === 1,
    }));

  const company = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.tickers.includes(ticker)) continue;
      const weight = item.tickers.length === 1 ? 3 : 1;
      for (const name of item.companies) counts.set(name, (counts.get(name) ?? 0) + weight);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }, [items, ticker]);

  const timeline = useMemo(() => {
    const rows = [
      ...primary.map((item) => ({ item, linked: false })),
      ...linked.map((item) => ({ item, linked: true })),
    ];
    rows.sort((a, b) => a.item.date.localeCompare(b.item.date) || Number(a.linked) - Number(b.linked));
    return rows;
  }, [linked, primary]);

  return (
    <div className="ticker">
      <div className="ticker-head">
        <div>
          <h2>
            {ticker}
            {company ? <span> {company}</span> : null}
          </h2>
          <p>
            {primary.length} item{primary.length === 1 ? "" : "s"}
            {includeLinked ? ` · ${linked.length} linked` : ""} under the current filters.
          </p>
        </div>
        <label className="field">
          <span>Ticker</span>
          <select value={options.some(([symbol]) => symbol === ticker) ? ticker : ""} onChange={(event) => onTicker(event.target.value)}>
            {options.every(([symbol]) => symbol !== ticker) ? <option value="">Pick a ticker</option> : null}
            {options.map(([symbol, count]) => (
              <option key={symbol} value={symbol}>
                {symbol} · {count}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={includeLinked} onChange={(event) => setIncludeLinked(event.target.checked)} />
          Show linked reactions
        </label>
      </div>
      <PriceChart ticker={ticker} points={prices} onOpen={onOpen} />
      <MoveChart ticker={ticker} points={moves} onOpen={onOpen} />
      {timeline.length === 0 ? <p className="empty">No {ticker} news matches these filters.</p> : null}
      <div className="t-cards">
        {timeline.map(({ item, linked: isLinked }) => (
          <ItemCard
            key={item.id}
            item={item}
            onOpen={onOpen}
            showSummary
            showDate
            note={isLinked ? linkNote(item, primary) : null}
          />
        ))}
      </div>
    </div>
  );
}

function linkNote(item: NewsItem, primary: NewsItem[]): string {
  const links = primary.filter((entry) => entry.related_ids.includes(item.id) || item.related_ids.includes(entry.id));
  if (links.length === 0) return "Linked to this ticker";
  const closest = links.slice().sort((a, b) => Math.abs(daysBetween(item.date, a.date)) - Math.abs(daysBetween(item.date, b.date)))[0];
  const days = daysBetween(closest.date, item.date);
  if (days === 0) return `Linked · same day as ${closest.title}`;
  if (days > 0) return `Linked · ${days}d after ${closest.title}`;
  return `Linked · ${-days}d before ${closest.title}`;
}

function PriceChart({ ticker, points, onOpen }: { ticker: string; points: PricePoint[]; onOpen: (id: string) => void }) {
  const label = points.length
    ? `Stated ${ticker} prices: ${points.map((point) => `${formatShort(point.date)} ${formatPrice(point.price)}`).join(", ")}`
    : `No stated ${ticker} price in the current filters`;
  if (points.length === 0) {
    return (
      <figure className="chart">
        <figcaption>Stated price</figcaption>
        <p className="empty">No price_mentioned for {ticker} in the current filters.</p>
      </figure>
    );
  }
  const times = points.map((point) => parseISODate(point.date).getTime());
  const range = domain(times);
  const values = points.map((point) => point.price);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  } else {
    const pad = (max - min) * 0.12;
    min -= pad;
    max += pad;
  }
  const yOf = (price: number) => MARGIN.top + ((max - price) / (max - min)) * (HEIGHT - MARGIN.top - MARGIN.bottom);
  const ordered = points.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const line = ordered.map((point) => `${xOf(parseISODate(point.date).getTime(), range)},${yOf(point.price)}`).join(" ");
  const dataMax = Math.max(...values);
  const dataMin = Math.min(...values);

  return (
    <figure className="chart">
      <figcaption>Stated price · {ticker}</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label={label}>
        <line className="axis" x1={MARGIN.left} y1={MARGIN.top} x2={MARGIN.left} y2={HEIGHT - MARGIN.bottom} />
        <line className="axis" x1={MARGIN.left} y1={HEIGHT - MARGIN.bottom} x2={WIDTH - MARGIN.right} y2={HEIGHT - MARGIN.bottom} />
        <text className="tick" x={MARGIN.left - 8} y={yOf(dataMax) + 4} textAnchor="end">
          {formatPrice(dataMax)}
        </text>
        {dataMin !== dataMax ? (
          <text className="tick" x={MARGIN.left - 8} y={yOf(dataMin) + 4} textAnchor="end">
            {formatPrice(dataMin)}
          </text>
        ) : null}
        {ticks(range, points.map((point) => point.date)).map((iso) => (
          <text key={iso} className="tick" x={xOf(parseISODate(iso).getTime(), range)} y={HEIGHT - 8} textAnchor="middle">
            {formatShort(iso)}
          </text>
        ))}
        {ordered.length > 1 ? <polyline className="series" points={line} /> : null}
        {ordered.map((point) => (
          <g key={point.id}>
            <circle
              className="point"
              cx={xOf(parseISODate(point.date).getTime(), range)}
              cy={yOf(point.price)}
              r={11}
              tabIndex={0}
              role="button"
              aria-label={`${formatPretty(point.date)} ${formatPrice(point.price)}. ${point.title}`}
              onClick={() => onOpen(point.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(point.id);
                }
              }}
            >
              <title>
                {formatPretty(point.date)} {formatPrice(point.price)} — {point.title}
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <p className="chart-note">{label}. The line connects stated prices only.</p>
    </figure>
  );
}

function MoveChart({ ticker, points, onOpen }: { ticker: string; points: MovePoint[]; onOpen: (id: string) => void }) {
  if (points.length === 0) {
    return (
      <figure className="chart">
        <figcaption>Stated move</figcaption>
        <p className="empty">No move_pct on a dated {ticker} item in the current filters.</p>
      </figure>
    );
  }
  const times = points.map((point) => parseISODate(point.date).getTime());
  const range = domain(times);
  const maxAbs = Math.max(1, ...points.map((point) => Math.abs(point.move)));
  const yOf = (move: number) => {
    const inner = HEIGHT - MARGIN.top - MARGIN.bottom;
    return MARGIN.top + ((maxAbs - move) / (maxAbs * 2)) * inner;
  };
  const zero = yOf(0);
  const groups = new Map<string, MovePoint[]>();
  for (const point of points) {
    const list = groups.get(point.date) ?? [];
    list.push(point);
    groups.set(point.date, list);
  }

  return (
    <figure className="chart">
      <figcaption>Stated move</figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-label={`Stated percent moves on ${ticker} items`}>
        <line className="axis" x1={MARGIN.left} y1={zero} x2={WIDTH - MARGIN.right} y2={zero} />
        <text className="tick" x={MARGIN.left - 8} y={yOf(maxAbs)} textAnchor="end">
          {formatMove(maxAbs)}
        </text>
        <text className="tick" x={MARGIN.left - 8} y={yOf(-maxAbs)} textAnchor="end">
          {formatMove(-maxAbs)}
        </text>
        <text className="tick" x={MARGIN.left - 8} y={zero} textAnchor="end">
          0
        </text>
        {ticks(range, points.map((point) => point.date)).map((iso) => (
          <text key={iso} className="tick" x={xOf(parseISODate(iso).getTime(), range)} y={HEIGHT - 8} textAnchor="middle">
            {formatShort(iso)}
          </text>
        ))}
        {[...groups.entries()].flatMap(([date, group]) =>
          group.map((point, index) => {
            const spread = (index - (group.length - 1) / 2) * 14;
            const x = xOf(parseISODate(date).getTime(), range) + spread;
            const y = yOf(point.move);
            return (
              <g key={point.id} className={point.move > 0 ? "up" : "down"}>
                <line x1={x} y1={zero} x2={x} y2={y} />
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  className={point.sole ? "solid" : "hollow"}
                  tabIndex={0}
                  role="button"
                  aria-label={`${formatPretty(point.date)} ${formatMove(point.move)}. ${point.title}`}
                  onClick={() => onOpen(point.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(point.id);
                    }
                  }}
                >
                  <title>
                    {formatMove(point.move)} — {point.title}
                    {point.sole ? "" : " (item names more than this ticker)"}
                  </title>
                </circle>
              </g>
            );
          }),
        )}
      </svg>
      <p className="chart-note">
        Filled markers are items that name only {ticker}. Open markers name several tickers, so the percent may describe the
        group or the market.
      </p>
    </figure>
  );
}
