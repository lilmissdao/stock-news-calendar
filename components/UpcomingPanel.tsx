import { addDaysISO, formatPretty, formatShort, inNextDays } from "@/lib/format";
import { industryColor } from "@/lib/taxonomy";
import type { NewsItem } from "@/lib/types";

export function UpcomingPanel({
  items,
  today,
  open,
  onToggle,
  onOpen,
}: {
  items: NewsItem[];
  today: string | null;
  open: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const upcoming = today
    ? items
        .filter((item) => item.status === "upcoming" && inNextDays(item.date, today, 14))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
    : [];
  const windowLabel = today ? `${formatShort(today)} – ${formatShort(addDaysISO(today, 13))}` : "Next 14 days";

  return (
    <aside className={open ? "upcoming open" : "upcoming"}>
      <button type="button" className="upcoming-toggle" aria-expanded={open} onClick={onToggle}>
        <span>
          <strong>Upcoming</strong>
          <span className="meta">{windowLabel}</span>
        </span>
        <span className="count">{today ? upcoming.length : "…"}</span>
      </button>
      <div className="upcoming-body">
        <header className="upcoming-desk">
          <h2>Upcoming</h2>
          <p>{windowLabel}</p>
        </header>
        {!today ? <p className="empty">Checking the next 14 days.</p> : null}
        {today && upcoming.length === 0 ? <p className="empty">No upcoming items in this window match the filters.</p> : null}
        <ul className="upcoming-list">
          {upcoming.map((item) => (
            <li key={item.id}>
              <button type="button" className="up-item" onClick={() => onOpen(item.id)}>
                <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                <span>
                  <span className="up-date">{formatPretty(item.date)}</span>
                  <span className="up-title">{item.title}</span>
                  {item.key_number ? <span className="up-key">{item.key_number}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
