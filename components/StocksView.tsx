import { useMemo } from "react";
import { formatPretty, precisionLabel } from "@/lib/format";
import { assembleStock, cautionCounts, STOCK_BY_TICKER, STOCK_GROUPS, STOCKS, type StoryBeat } from "@/lib/stocks";
import { eventLabel, industryColor, STATUS_LABELS } from "@/lib/taxonomy";
import type { NewsItem, StockCaution, StockProfile } from "@/lib/types";

const LEVEL_LABEL = { high: "High", medium: "Medium", low: "Watch" } as const;

export function StocksView({
  items,
  stock,
  today,
  onStock,
  onOpen,
  onChart,
}: {
  items: NewsItem[];
  stock: string;
  today: string | null;
  onStock: (ticker: string) => void;
  onOpen: (id: string) => void;
  onChart: (ticker: string) => void;
}) {
  const profile = STOCK_BY_TICKER.get(stock) ?? STOCKS[0];
  const story = useMemo(() => (profile ? assembleStock(profile, items, today) : null), [items, profile, today]);
  const groups = useMemo(() => groupStocks(STOCKS, STOCK_GROUPS), []);

  if (!profile || !story) return <p className="empty">No stock stories in the file yet.</p>;

  const counts = cautionCounts(profile.cautions);

  return (
    <div className="stocks">
      <div className="stock-picker">
        <label className="field">
          <span>Stock</span>
          <select value={profile.ticker} onChange={(event) => onStock(event.target.value)}>
            {groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.stocks.map((entry) => (
                  <option key={entry.ticker} value={entry.ticker}>
                    {entry.ticker} · {entry.name} · {entry.cautions.length} caution{entry.cautions.length === 1 ? "" : "s"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="stock-groups" role="group" aria-label="Stocks">
          {groups.map((group) => (
            <div key={group.label} className="stock-group">
              <span>{group.label}</span>
              <div className="stock-scroller">
                {group.stocks.map((entry) => (
                  <button
                    key={entry.ticker}
                    type="button"
                    className="chip stock-chip"
                    aria-pressed={entry.ticker === profile.ticker}
                    onClick={() => onStock(entry.ticker)}
                  >
                    {entry.ticker}
                    <small>{entry.cautions.length}</small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <header className="story-hero">
        <div>
          <p className="kicker" style={{ color: industryColor(profile.industry) }}>
            {profile.industry}
          </p>
          <h2>
            {profile.ticker} <span>{profile.name}</span>
          </h2>
          <p>{profile.blurb}</p>
        </div>
        <div className="story-meter">
          <p>
            {counts.total === 0
              ? "No outside caution is on file."
              : counts.total === 1
                ? "1 outside caution is on file."
                : `${counts.total} outside cautions are piling up.`}
          </p>
          {counts.total > 0 ? (
            <div
              className="meter"
              role="img"
              aria-label={`${counts.total} cautions: ${counts.high} high, ${counts.medium} medium, ${counts.low} watch`}
            >
              {profile.cautions.map((caution) => (
                <i key={caution.id} className={`on ${caution.level}`} />
              ))}
            </div>
          ) : null}
          {counts.total > 0 ? (
            <p className="chart-note">
              {counts.high} high · {counts.medium} medium · {counts.low} watch. One bar per caution.
            </p>
          ) : null}
          <button type="button" className="text-btn" onClick={() => onChart(profile.ticker)}>
            Price chart
          </button>
        </div>
      </header>

      <div className="story-grid">
        <section className="story-col">
          <h3>What happened</h3>
          <p className="chart-note">Newest first. Older rows are researched. Later rows are from the news file.</p>
          {story.history.length === 0 ? <p className="empty">No dated history in the file yet.</p> : null}
          <ol className="beats">
            {story.history.map((beat) => (
              <li key={beat.id}>
                <Beat beat={beat} today={today} onOpen={onOpen} />
              </li>
            ))}
          </ol>
        </section>
        <section className="story-col">
          <h3>What’s coming</h3>
          <p className="chart-note">Next dates, plus CPI, jobs, and policy dates that hit this name.</p>
          {story.coming.length === 0 ? <p className="empty">No dated catalyst on file.</p> : null}
          <ol className="beats">
            {story.coming.map((beat) => (
              <li key={beat.id}>
                <Beat beat={beat} today={today} onOpen={onOpen} />
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="story-block">
        <h3>Cautions piling up</h3>
        <p className="chart-note">Outside risks that reach this stock through another company, a policy, or a rival.</p>
        {profile.cautions.length === 0 ? <p className="empty">No outside caution on file.</p> : null}
        <div className="cautions">
          {profile.cautions.map((caution) => (
            <Caution key={caution.id} caution={caution} items={items} onOpen={onOpen} onStock={onStock} />
          ))}
        </div>
      </section>

      <section className="story-block">
        <h3>Connections</h3>
        <p className="chart-note">Other stocks in this story, then calendar items you can open.</p>
        {story.linkedTickers.length === 0 ? <p className="empty">No linked stocks yet.</p> : null}
        <div className="ticker-row">
          {story.linkedTickers.map((ticker) => (
            <button key={ticker} type="button" className="chip" onClick={() => onStock(ticker)}>
              {ticker}
              {STOCK_BY_TICKER.has(ticker) ? "" : " · chart"}
            </button>
          ))}
        </div>
        {story.connections.length === 0 ? <p className="empty">No extra calendar link.</p> : null}
        <ul className="related">
          {story.connections.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item.id)}>
                <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {formatPretty(item.date)} · {item.tickers.slice(0, 4).join(" ") || item.industry}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Beat({ beat, today, onOpen }: { beat: StoryBeat; today: string | null; onOpen: (id: string) => void }) {
  const precision = precisionLabel({
    date: beat.date,
    date_precision: beat.datePrecision,
  } as NewsItem);
  const open = beat.newsId && beat.datePrecision ? () => onOpen(beat.newsId as string) : null;
  const stillOpen = beat.status === "developing" && today != null && beat.date < today;
  const body = (
    <>
      <span className="beat-date">{precision ?? formatPretty(beat.date)}</span>
      <span className="card-title">{beat.title}</span>
      <span className="meta">
        <span className={`badge ${beat.status}`}>{stillOpen ? "Still open" : STATUS_LABELS[beat.status]}</span>
        <span>{eventLabel(beat.eventType)}</span>
        {beat.unverified ? <span className="badge developing">Unverified</span> : null}
      </span>
      {beat.summary ? <span className="card-summary">{beat.summary}</span> : null}
      {beat.keyNumber ? <span className="beat-key">{beat.keyNumber}</span> : null}
      {beat.source ? <span className="follow">{beat.source}</span> : null}
      {beat.tickers.length > 0 ? <span className="tickers">{beat.tickers.join("  ")}</span> : null}
    </>
  );
  if (!open) {
    return <article className="beat">{body}</article>;
  }
  return (
    <button type="button" className="beat beat-hit" onClick={open}>
      {body}
    </button>
  );
}

function Caution({
  caution,
  items,
  onOpen,
  onStock,
}: {
  caution: StockCaution;
  items: NewsItem[];
  onOpen: (id: string) => void;
  onStock: (ticker: string) => void;
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const links = caution.news_ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
  return (
    <article className={`caution level-${caution.level}`}>
      <p className="meta">
        <span className={`badge ${caution.level === "high" ? "upcoming" : caution.level === "low" ? "developing" : ""}`}>
          {LEVEL_LABEL[caution.level]}
        </span>
        {caution.via ? <span>Through {caution.via}</span> : null}
      </p>
      <h4>{caution.title}</h4>
      <p>{caution.reason}</p>
      {caution.tickers.length > 0 ? (
        <div className="ticker-row">
          {caution.tickers.map((ticker) => (
            <button key={ticker} type="button" className="chip" onClick={() => onStock(ticker)}>
              {ticker}
            </button>
          ))}
        </div>
      ) : null}
      {links.length > 0 ? (
        <ul className="related">
          {links.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onOpen(item.id)}>
                <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{formatPretty(item.date)}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function groupStocks(stocks: StockProfile[], groupOrder: string[]) {
  const buckets = new Map<string, StockProfile[]>();
  for (const stock of stocks) {
    const list = buckets.get(stock.group) ?? [];
    list.push(stock);
    buckets.set(stock.group, list);
  }
  const labels = [...groupOrder, ...[...buckets.keys()].filter((label) => !groupOrder.includes(label))];
  return labels
    .filter((label) => (buckets.get(label)?.length ?? 0) > 0)
    .map((label) => ({ label, stocks: buckets.get(label) ?? [] }));
}
