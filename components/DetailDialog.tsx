import { useEffect, useRef } from "react";
import { formatMarketCap, formatMove, formatPretty, formatPrice, precisionLabel } from "@/lib/format";
import { itemBriefFor } from "@/lib/saved-briefs";
import { eventLabel, industryColor, LINK_LABELS, RELIANCE_LABELS, STATUS_LABELS } from "@/lib/taxonomy";
import type { NewsItem } from "@/lib/types";

export function DetailDialog({
  item,
  byId,
  visibleIds,
  onClose,
  onOpen,
  onTicker,
}: {
  item: NewsItem | null;
  byId: Map<string, NewsItem>;
  visibleIds: Set<string>;
  onClose: () => void;
  onOpen: (id: string) => void;
  onTicker: (ticker: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  const related = item
    ? item.related_ids.map((id) => ({ id, item: byId.get(id) })).sort((a, b) => {
        const ad = a.item?.date ?? "9999";
        const bd = b.item?.date ?? "9999";
        return ad.localeCompare(bd);
      })
    : [];
  const precision = item ? precisionLabel(item) : null;
  const brief = item ? itemBriefFor(item) : null;
  const rest = item ? (brief && item.summary.startsWith(brief) ? item.summary.slice(brief.length).trim() : item.summary) : "";

  return (
    <dialog
      ref={ref}
      className="detail"
      aria-labelledby="detail-title"
      onClose={onClose}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {item ? (
        <div className="detail-panel">
          <header className="detail-head">
            <p className="kicker" style={{ color: industryColor(item.industry) }}>
              {item.industry}
            </p>
            <h2 id="detail-title">{item.title}</h2>
            <button type="button" className="close" onClick={onClose}>
              Close
            </button>
          </header>
          <div className="detail-body">
            <p className="meta">
              <span>{formatPretty(item.date)}</span>
              <span className={`badge ${item.status}`}>{STATUS_LABELS[item.status]}</span>
              <span>{eventLabel(item.event_type)}</span>
              {precision ? <span>{precision}</span> : null}
            </p>
            {brief ? (
              <p className="item-brief">
                <span className="kicker">Short version</span>
                {brief}
              </p>
            ) : null}
            {rest ? <p className="summary">{rest}</p> : null}
            {item.key_number ? (
              <figure className="keynum">
                <figcaption>Key number</figcaption>
                <p>{item.key_number}</p>
              </figure>
            ) : null}
            <dl className="facts">
              {item.price_mentioned ? (
                <>
                  <dt>Stated price</dt>
                  <dd>
                    {item.price_mentioned.ticker} {formatPrice(item.price_mentioned.price)}
                  </dd>
                </>
              ) : null}
              {item.move_pct != null ? (
                <>
                  <dt>Stated move</dt>
                  <dd className={item.move_pct > 0 ? "up" : item.move_pct < 0 ? "down" : ""}>{formatMove(item.move_pct)}</dd>
                </>
              ) : null}
              {item.source_digest_date !== item.date ? (
                <>
                  <dt>Noted</dt>
                  <dd>{formatPretty(item.source_digest_date)}</dd>
                </>
              ) : null}
              {item.graph_node ? (
                <>
                  <dt>Drug</dt>
                  <dd>
                    {item.graph_node.drug}
                    {item.graph_node.unverified ? " · unverified" : ""}
                    {item.graph_node.generic ? " · generic threat" : ""}
                  </dd>
                  <dt>Reliance</dt>
                  <dd>{item.graph_node.reliance ? RELIANCE_LABELS[item.graph_node.reliance] : "Not stated"}</dd>
                  {item.graph_node.market_cap_b != null ? (
                    <>
                      <dt>Market cap</dt>
                      <dd>{formatMarketCap(item.graph_node.market_cap_b)}</dd>
                    </>
                  ) : null}
                </>
              ) : null}
            </dl>
            {item.tickers.length > 0 ? (
              <div className="ticker-row">
                {item.tickers.map((ticker) => (
                  <button key={ticker} type="button" className="chip" onClick={() => onTicker(ticker)}>
                    {ticker}
                  </button>
                ))}
              </div>
            ) : null}
            {item.companies.length > 0 ? <p className="companies">{item.companies.join(" · ")}</p> : null}
            {item.connection_notes ? (
              <section>
                <h3>Why it’s linked</h3>
                <p>{item.connection_notes}</p>
              </section>
            ) : null}
            <section>
              <h3>Related</h3>
              {related.length === 0 ? <p className="empty">No related items.</p> : null}
              <ul className="related">
                {related.map((entry) => (
                  <li key={entry.id}>
                    {entry.item ? (
                      <button type="button" onClick={() => onOpen(entry.item!.id)}>
                        <i style={{ background: industryColor(entry.item.industry) }} aria-hidden="true" />
                        <span>
                          <strong>{entry.item.title}</strong>
                          <small>
                            {formatPretty(entry.item.date)}
                            {visibleIds.has(entry.item.id) ? "" : " · hidden by filters"}
                            {item.link_kinds[entry.id] || entry.item.link_kinds[item.id]
                              ? ` · ${LINK_LABELS[(item.link_kinds[entry.id] ?? entry.item.link_kinds[item.id])!]}`
                              : ""}
                          </small>
                        </span>
                      </button>
                    ) : (
                      <span className="missing">Missing item {entry.id}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
