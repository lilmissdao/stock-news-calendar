import { formatMove, formatPretty, formatPrice, precisionLabel } from "@/lib/format";
import { eventLabel, industryColor, STATUS_LABELS } from "@/lib/taxonomy";
import type { NewsItem } from "@/lib/types";

export function ItemCard({
  item,
  onOpen,
  showSummary = false,
  showDate = false,
  note,
}: {
  item: NewsItem;
  onOpen: (id: string) => void;
  showSummary?: boolean;
  showDate?: boolean;
  note?: string | null;
}) {
  const precision = precisionLabel(item);
  const price = item.price_mentioned;

  return (
    <article className="card" id={`news-${item.id}`}>
      <button type="button" className="card-hit" onClick={() => onOpen(item.id)}>
        <span className="swatch" style={{ background: industryColor(item.industry) }} aria-hidden="true" />
        <span className="card-body">
          <span className="card-title">{item.title}</span>
          <span className="meta">
            {showDate ? <span>{formatPretty(item.date)}</span> : null}
            <span className={`badge ${item.status}`}>{STATUS_LABELS[item.status]}</span>
            <span>{item.industry}</span>
            <span>{eventLabel(item.event_type)}</span>
            {precision ? <span>{precision}</span> : null}
          </span>
          {showSummary ? <span className="card-summary">{item.summary}</span> : null}
          <span className="stats">
            {item.move_pct != null ? (
              <span className={item.move_pct > 0 ? "up" : item.move_pct < 0 ? "down" : ""}>
                {formatMove(item.move_pct)}
              </span>
            ) : null}
            {price ? (
              <span>
                {price.ticker} {formatPrice(price.price)}
              </span>
            ) : null}
            {item.tickers.length > 0 ? <span className="tickers">{item.tickers.join("  ")}</span> : null}
          </span>
          {note ? <span className="follow">{note}</span> : null}
        </span>
      </button>
    </article>
  );
}
