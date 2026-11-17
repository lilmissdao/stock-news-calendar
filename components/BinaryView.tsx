"use client";

import { useMemo, useState } from "react";
import {
  BINARY_STATUS_LABELS,
  CATALYST_LABELS,
  OUTCOME_LABELS,
  TIMING_LABELS,
  type BinaryItem,
  type BinaryTiming,
  type CatalystType,
} from "@/lib/binary";
import { formatPretty } from "@/lib/format";
import type { NewsItem } from "@/lib/types";

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

function when(item: BinaryItem): string {
  if (item.date_window) return item.date_window;
  return formatPretty(item.date);
}

export function BinaryView({
  items,
  records,
  onOpen,
}: {
  items: NewsItem[];
  records: BinaryItem[];
  onOpen: (id: string) => void;
}) {
  const [typesOn, setTypesOn] = useState<CatalystType[]>([]);
  const [timingOn, setTimingOn] = useState<BinaryTiming[]>([]);
  const visible = useMemo(() => new Set(items.filter((item) => item.binary_bet).map((item) => item.id)), [items]);
  const rows = useMemo(() => {
    return records.filter((item) => {
      if (!visible.has(item.id)) return false;
      if (typesOn.length > 0 && !typesOn.includes(item.catalyst_type)) return false;
      if (timingOn.length > 0 && !timingOn.includes(item.timing)) return false;
      return true;
    });
  }, [records, visible, typesOn, timingOn]);
  const upcoming = rows
    .filter((item) => item.status === "upcoming")
    .sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));
  const resolved = rows
    .filter((item) => item.status === "resolved")
    .sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));

  return (
    <div className="eai binary-bets">
      <header className="eai-intro">
        <p className="kicker">Binary Bets</p>
        <h2>One catalyst, one stock</h2>
        <p>
          Small and mid-cap biotechs whose next major event is a Phase 3 readout, an FDA decision, or an advisory
          committee. Confirmed means a company filing or release names the day. Expected means the company named a month
          or a quarter, so the row is not pinned to a guessed day. A blank market cap means the sources used here did
          not state one. Cash and runway are copied from the latest quarter the company reported, not from a burn-rate
          model.
        </p>
      </header>
      <div className="eai-filters">
        <fieldset>
          <legend>Type</legend>
          <div className="chips">
            {(Object.keys(CATALYST_LABELS) as CatalystType[]).map((type) => (
              <button
                key={type}
                type="button"
                className="chip"
                aria-pressed={typesOn.includes(type)}
                onClick={() => setTypesOn((current) => toggle(current, type))}
              >
                {CATALYST_LABELS[type]}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Date status</legend>
          <div className="chips">
            {(Object.keys(TIMING_LABELS) as BinaryTiming[]).map((timing) => (
              <button
                key={timing}
                type="button"
                className="chip"
                aria-pressed={timingOn.includes(timing)}
                onClick={() => setTimingOn((current) => toggle(current, timing))}
              >
                {TIMING_LABELS[timing]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <section aria-labelledby="binary-upcoming">
        <h2 id="binary-upcoming">Upcoming</h2>
        <p className="tally">
          {upcoming.length} catalyst{upcoming.length === 1 ? "" : "s"}, earliest first.
        </p>
        {upcoming.length === 0 ? <p className="empty">Nothing upcoming matches these filters.</p> : null}
        <div className="binary-list">
          {upcoming.map((item) => (
            <BinaryCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      </section>
      <section aria-labelledby="binary-outcomes">
        <h2 id="binary-outcomes">Recent outcomes</h2>
        <p className="tally">
          {resolved.length} resolved catalyst{resolved.length === 1 ? "" : "s"}. The stock move is the one a source
          stated. Where premarket quotes disagreed, the card says so and does not pick a close.
        </p>
        {resolved.length === 0 ? <p className="empty">No resolved catalysts match these filters.</p> : null}
        <div className="binary-list">
          {resolved.map((item) => (
            <BinaryCard key={item.id} item={item} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BinaryCard({ item, onOpen }: { item: BinaryItem; onOpen: (id: string) => void }) {
  const reported = item.facts.some((fact) => fact.reported) || item.cash?.reported === true || item.outcome?.reported === true;
  return (
    <article className="binary-card">
      <header className="binary-head">
        <p className="kicker">{item.ticker}</p>
        <h3>{item.company}</h3>
        <p className="binary-drug">
          {item.drug}
          <span> · {item.indication}</span>
        </p>
        <p className="meta">
          <span className={`badge binary ${item.timing}`}>{TIMING_LABELS[item.timing]}</span>
          <span className="badge binary">{CATALYST_LABELS[item.catalyst_type]}</span>
          <span className={`badge ${item.status === "resolved" ? "happened" : "upcoming"}`}>
            {BINARY_STATUS_LABELS[item.status]}
          </span>
          {reported ? <span className="badge binary reported">Reported</span> : null}
          {item.outcome ? (
            <span className={`badge binary ${item.outcome.result}`}>{OUTCOME_LABELS[item.outcome.result]}</span>
          ) : null}
        </p>
      </header>
      <dl className="binary-facts">
        <dt>When</dt>
        <dd>
          {when(item)}
          {item.date_window ? <small> · anchored on {formatPretty(item.date)}, not a scheduled day</small> : null}
        </dd>
        <dt>Market cap</dt>
        <dd>{item.market_cap || "Not stated in the sources used"}</dd>
        <dt>Cash</dt>
        <dd>
          {item.cash ? (
            <>
              {item.cash.on_hand} as of {formatPretty(item.cash.as_of)}. {item.cash.scope}.
              {item.cash.reported ? " Reported." : ""}
            </>
          ) : (
            "Not stated in the sources used"
          )}
        </dd>
        <dt>Runway</dt>
        <dd>
          {item.cash?.runway || "Not stated"}
          {item.cash?.quarters ? ` Quarters: ${item.cash.quarters}.` : ""}
          {item.cash?.quarters_note ? <small>{item.cash.quarters_note}</small> : null}
        </dd>
        <dt>If it works</dt>
        <dd>{item.success_means}</dd>
        <dt>If it misses</dt>
        <dd>{item.miss_means}</dd>
        <dt>Why it matters</dt>
        <dd>{item.why_it_matters}</dd>
        {item.outcome ? (
          <>
            <dt>Stock move</dt>
            <dd>
              {item.outcome.move}{" "}
              <a href={item.outcome.source} target="_blank" rel="noreferrer">
                {item.outcome.source_label}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <ul className="binary-sources">
        {item.facts.map((fact) => (
          <li key={`${fact.label}-${fact.source}`}>
            <strong>{fact.label}.</strong> {fact.value}{" "}
            <a href={fact.source} target="_blank" rel="noreferrer">
              {fact.source_label}
            </a>
            {fact.reported ? " · Reported" : ""}
          </li>
        ))}
      </ul>
      <button type="button" className="text-btn" onClick={() => onOpen(item.id)}>
        Open this catalyst
      </button>
    </article>
  );
}
