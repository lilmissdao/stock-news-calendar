"use client";

import { useMemo, useState } from "react";
import {
  BINARY_STATUS_LABELS,
  CATALYST_LABELS,
  OUTCOME_LABELS,
  TIMING_LABELS,
  cashRunway,
  guidanceWasMissed,
  isEarlyWarning,
  type AnalystMove,
  type BinaryItem,
  type BinaryTiming,
  type CatalystType,
  type EventCounter,
  type GuidanceEntry,
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
  today,
  onOpen,
}: {
  items: NewsItem[];
  records: BinaryItem[];
  today: string;
  onOpen: (id: string) => void;
}) {
  const [typesOn, setTypesOn] = useState<CatalystType[]>([]);
  const [timingOn, setTimingOn] = useState<BinaryTiming[]>([]);
  const [warnOnly, setWarnOnly] = useState(false);
  const visible = useMemo(() => new Set(items.filter((item) => item.binary_bet).map((item) => item.id)), [items]);
  const rows = useMemo(() => {
    return records.filter((item) => {
      if (!visible.has(item.id)) return false;
      if (typesOn.length > 0 && !typesOn.includes(item.catalyst_type)) return false;
      if (timingOn.length > 0 && !timingOn.includes(item.timing)) return false;
      if (warnOnly && !isEarlyWarning(item, today)) return false;
      return true;
    });
  }, [records, visible, typesOn, timingOn, warnOnly, today]);
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
        <fieldset>
          <legend>Signal</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={warnOnly} onClick={() => setWarnOnly((on) => !on)}>
              Early warning
            </button>
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
            <BinaryCard key={item.id} item={item} today={today} onOpen={onOpen} />
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
            <BinaryCard key={item.id} item={item} today={today} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BinaryCard({ item, today, onOpen }: { item: BinaryItem; today: string; onOpen: (id: string) => void }) {
  const reported = item.facts.some((fact) => fact.reported) || item.cash?.reported === true || item.outcome?.reported === true;
  const warning = isEarlyWarning(item, today);
  const missed = guidanceWasMissed(item);
  const guidance = [...item.guidance_history].sort((a, b) => a.date.localeCompare(b.date));
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
          {warning ? <span className="badge warn">Early warning</span> : null}
          {missed ? <span className="badge warn">Guidance missed</span> : null}
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
          <RunwayLine item={item} />
        </dd>
        <dt>If it works</dt>
        <dd>{item.success_means}</dd>
        <dt>If it misses</dt>
        <dd>{item.miss_means}</dd>
        <dt>Why it matters</dt>
        <dd>{item.why_it_matters}</dd>
        {item.event_counter ? (
          <>
            <dt>Events</dt>
            <dd>
              <EventMeter counter={item.event_counter} />
            </dd>
          </>
        ) : null}
        {guidance.length > 0 ? (
          <>
            <dt>Guidance</dt>
            <dd>
              <GuidanceList entries={guidance} />
            </dd>
          </>
        ) : null}
        {item.short_interest ? (
          <>
            <dt>Short interest</dt>
            <dd>
              {item.short_interest.pct_float}% of float
              {item.short_interest.days_to_cover != null ? `, ${item.short_interest.days_to_cover} days to cover` : ""} as of{" "}
              {formatPretty(item.short_interest.as_of)}.{" "}
              <a href={item.short_interest.source} target="_blank" rel="noreferrer">
                {item.short_interest.source_label}
              </a>
            </dd>
          </>
        ) : null}
        {item.analyst_moves.length > 0 ? (
          <>
            <dt>Analysts</dt>
            <dd>
              <AnalystList moves={item.analyst_moves} />
            </dd>
          </>
        ) : null}
        {item.prior_phase_data ? (
          <>
            <dt>Earlier phase</dt>
            <dd>{item.prior_phase_data}</dd>
          </>
        ) : null}
        {item.dilution ? (
          <>
            <dt>Dilution</dt>
            <dd>
              {item.dilution.summary}{" "}
              <a href={item.dilution.source} target="_blank" rel="noreferrer">
                {item.dilution.source_label}
              </a>
            </dd>
          </>
        ) : null}
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

function RunwayLine({ item }: { item: BinaryItem }) {
  const runway = cashRunway(item);
  return (
    <>
      <span className={runway.tone ? `runway ${runway.tone}` : "runway"}>{runway.line}</span>
      {runway.company ? <small>Company: {runway.company}</small> : null}
      {runway.spendMore ? <span className="badge warn">Company plans to spend more</span> : null}
      {item.quarterly_burn ? (
        <small>
          {item.quarterly_burn.basis === "net loss / quarters" ? "Net loss" : "Operating cash used"},{" "}
          {item.quarterly_burn.period}, about ${Math.round(item.quarterly_burn.amount_usd / 1_000_000)} million a quarter.{" "}
          <a href={item.quarterly_burn.source} target="_blank" rel="noreferrer">
            {item.quarterly_burn.source_label}
          </a>
        </small>
      ) : null}
      {item.cash?.quarters ? <small>Company quarter count: {item.cash.quarters}.</small> : null}
      {item.cash?.quarters_note ? <small>{item.cash.quarters_note}</small> : null}
    </>
  );
}

function EventMeter({ counter }: { counter: EventCounter }) {
  const pct = Math.max(0, Math.min(100, (counter.current / counter.target) * 100));
  return (
    <>
      <div
        className="event-meter"
        role="progressbar"
        aria-valuenow={counter.current}
        aria-valuemin={0}
        aria-valuemax={counter.target}
        aria-label={`${counter.current} of ${counter.target} events`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <small>
        {counter.current} of {counter.target} as of {formatPretty(counter.as_of)}.{" "}
        <a href={counter.source} target="_blank" rel="noreferrer">
          {counter.source_label}
        </a>
      </small>
    </>
  );
}

function GuidanceList({ entries }: { entries: GuidanceEntry[] }) {
  return (
    <ol className="guidance-list">
      {entries.map((entry) => (
        <li key={`${entry.date}-${entry.wording}`}>
          {formatPretty(entry.date)}: {entry.wording}
          {entry.missed ? <span className="badge warn">Missed</span> : null}{" "}
          <a href={entry.source} target="_blank" rel="noreferrer">
            {entry.source_label}
          </a>
        </li>
      ))}
    </ol>
  );
}

function AnalystList({ moves }: { moves: AnalystMove[] }) {
  const ordered = [...moves].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ol className="guidance-list">
      {ordered.map((move) => (
        <li key={`${move.date}-${move.firm}-${move.target}`}>
          {formatPretty(move.date)}: {move.firm} {move.action}, target {move.target}.{" "}
          <a href={move.source} target="_blank" rel="noreferrer">
            {move.source_label}
          </a>
        </li>
      ))}
    </ol>
  );
}
