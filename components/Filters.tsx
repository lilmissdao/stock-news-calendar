import { EMPTY_FILTERS, filtersActive } from "@/lib/filter";
import { eventLabel, industryColor, sortEventTypes, STATUS_LABELS } from "@/lib/taxonomy";
import type { FilterState, MoveDir, NewsItem, Status } from "@/lib/types";

const STATUSES: Status[] = ["happened", "developing", "upcoming"];

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

export function Filters({
  items,
  value,
  onChange,
  open,
  onClose,
}: {
  items: NewsItem[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  open: boolean;
  onClose: () => void;
}) {
  const industries = [...new Set(items.map((item) => item.industry))].sort((a, b) => a.localeCompare(b));
  const events = sortEventTypes([...new Set(items.map((item) => item.event_type))]);
  const active = filtersActive(value);

  return (
    <section className={open ? "filters open" : "filters"} aria-label="Filters">
      <div className="filters-head">
        <h2>Filters</h2>
        <div className="filters-actions">
          {active ? (
            <button type="button" className="text-btn" onClick={() => onChange(EMPTY_FILTERS)}>
              Clear
            </button>
          ) : null}
          <button type="button" className="text-btn mobile-only" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <label className="field grow">
        <span>Ticker, company, or headline</span>
        <input
          type="search"
          value={value.query}
          placeholder="NVDA, CoreWeave, oil…"
          onChange={(event) => onChange({ ...value, query: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Event type</span>
        <select value={value.eventType} onChange={(event) => onChange({ ...value, eventType: event.target.value })}>
          <option value="">All types</option>
          {events.map((eventType) => (
            <option key={eventType} value={eventType}>
              {eventLabel(eventType)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>Status</legend>
        <div className="chips">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className="chip"
              aria-pressed={value.statuses.includes(status)}
              onClick={() => onChange({ ...value, statuses: toggle(value.statuses, status) })}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field wide">
        <legend>Industry</legend>
        <div className="chips">
          {industries.map((industry) => (
            <button
              key={industry}
              type="button"
              className="chip"
              aria-pressed={value.industries.includes(industry)}
              onClick={() => onChange({ ...value, industries: toggle(value.industries, industry) })}
            >
              <i className="dot" style={{ background: industryColor(industry) }} aria-hidden="true" />
              {industry}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Stated price</legend>
        <div className="range">
          <label>
            <span className="sr">Minimum price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Min $"
              value={value.priceMin}
              onChange={(event) => onChange({ ...value, priceMin: event.target.value })}
            />
          </label>
          <label>
            <span className="sr">Maximum price</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="Max $"
              value={value.priceMax}
              onChange={(event) => onChange({ ...value, priceMax: event.target.value })}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Stated move</legend>
        <div className="seg" role="group" aria-label="Move direction">
          {(["any", "up", "down"] as MoveDir[]).map((dir) => (
            <button
              key={dir}
              type="button"
              aria-pressed={value.moveDir === dir}
              onClick={() => onChange({ ...value, moveDir: dir })}
            >
              {dir === "any" ? "Any" : dir === "up" ? "Up" : "Down"}
            </button>
          ))}
        </div>
        <label className="threshold">
          <span>At least</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            placeholder="0"
            value={value.moveMin}
            onChange={(event) => onChange({ ...value, moveMin: event.target.value })}
          />
          <span>%</span>
        </label>
      </fieldset>
    </section>
  );
}
