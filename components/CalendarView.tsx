import { useEffect, useMemo, useRef, useState } from "react";
import { BriefCard } from "@/components/BriefCard";
import { ItemCard } from "@/components/ItemCard";
import { formatMonth, formatPretty, monthKey, monthMatrix, monthOfISO, precisionLabel, shiftMonth, toISODate } from "@/lib/format";
import { dayBriefFor } from "@/lib/saved-briefs";
import { industryColor } from "@/lib/taxonomy";
import type { NewsItem } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({
  items,
  year,
  month,
  today,
  selectedDay,
  onSelectDay,
  onMonth,
  onOpen,
}: {
  items: NewsItem[];
  year: number;
  month: number;
  today: string | null;
  selectedDay: string;
  onSelectDay: (iso: string) => void;
  onMonth: (year: number, month: number) => void;
  onOpen: (id: string) => void;
}) {
  const key = monthKey(year, month);
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBehavior = useRef<ScrollBehavior>("auto");
  const [focusToday, setFocusToday] = useState(0);
  const pinned = useMemo(() => {
    const map = new Map<string, NewsItem[]>();
    for (const item of items) {
      if (item.graph_only || item.date_precision !== "day") continue;
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items]);
  const undated = items.filter((item) => !item.graph_only && item.date_precision !== "day" && item.date.startsWith(key));
  const agenda = pinned.get(selectedDay) ?? [];
  const daySummary = useMemo(() => dayBriefFor(selectedDay, agenda), [selectedDay, agenda]);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !today) return;
    const cell = root.querySelector<HTMLElement>('[data-today="true"]');
    if (!cell) return;
    const pad = 8;
    const rootRect = root.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const behavior = scrollBehavior.current;
    scrollBehavior.current = "auto";
    if (cellRect.left >= rootRect.left + pad && cellRect.right <= rootRect.right - pad) return;
    const delta = cellRect.left - rootRect.left - pad;
    root.scrollTo({ left: Math.max(0, root.scrollLeft + delta), behavior });
  }, [year, month, today, focusToday]);

  return (
    <div className="cal">
      <div className="cal-nav">
        <div className="month-switch">
          <button type="button" onClick={() => onMonth(prev.year, prev.month)} aria-label="Previous month">
            Prev
          </button>
          <h2>{formatMonth(year, month)}</h2>
          <button type="button" onClick={() => onMonth(next.year, next.month)} aria-label="Next month">
            Next
          </button>
        </div>
        <button
          type="button"
          className="today-jump"
          onClick={() => {
            if (!today) return;
            const current = monthOfISO(today);
            scrollBehavior.current = "smooth";
            setFocusToday((tick) => tick + 1);
            onMonth(current.year, current.month);
            onSelectDay(today);
          }}
        >
          Today
        </button>
      </div>
      <section className="undated" aria-label="This month, not pinned to a day">
        <h3>This month / undated</h3>
        {undated.length === 0 ? (
          <p className="empty">No month, quarter, or uncertain items in {formatMonth(year, month)}.</p>
        ) : (
          <ul>
            {undated.map((item) => (
              <li key={item.id}>
                <button type="button" className="pill" onClick={() => onOpen(item.id)}>
                  <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                  <span>
                    {item.title}
                    <small>{precisionLabel(item)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <BriefCard brief={daySummary} label={`Summary for ${formatPretty(selectedDay)}`} />
      <div className="cal-layout">
        <div className="cal-scroll" ref={scrollRef}>
          <div className="month-grid" role="grid" aria-label={formatMonth(year, month)}>
            {WEEKDAYS.map((day) => (
              <div key={day} className="dow" role="columnheader">
                {day}
              </div>
            ))}
            {weeks.flat().map((date) => {
              const iso = toISODate(date);
              const dayItems = pinned.get(iso) ?? [];
              const outside = date.getMonth() !== month;
              const shown = dayItems.length > 3 ? dayItems.slice(0, 2) : dayItems;
              const hidden = dayItems.length - shown.length;
              const counts = new Map<string, number>();
              for (const item of dayItems) counts.set(item.industry, (counts.get(item.industry) ?? 0) + 1);
              return (
                <div
                  key={iso}
                  role="gridcell"
                  data-today={today === iso ? "true" : undefined}
                  className={[
                    "day",
                    outside ? "out" : "",
                    today === iso ? "today" : "",
                    selectedDay === iso ? "selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="day-num"
                    aria-pressed={selectedDay === iso}
                    aria-current={today === iso ? "date" : undefined}
                    aria-label={`${formatPretty(iso)}${today === iso ? ", today" : ""}, ${dayItems.length} items`}
                    onClick={() => onSelectDay(iso)}
                  >
                    <span className="day-num-stack">
                      <span className="day-num-mark">{date.getDate()}</span>
                      {today === iso ? <span className="today-tag">Today</span> : null}
                    </span>
                    {dayItems.length > 0 ? <span className="day-count">{dayItems.length}</span> : null}
                  </button>
                  {dayItems.length > 0 ? (
                    <span className="mix" aria-hidden="true">
                      {[...counts.entries()].map(([industry, count]) => (
                        <i key={industry} style={{ background: industryColor(industry), flex: count }} />
                      ))}
                    </span>
                  ) : null}
                  <div className="day-pills">
                    {shown.map((item) => (
                      <button key={item.id} type="button" className="pill" onClick={() => onOpen(item.id)}>
                        <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                        <span>{item.title}</span>
                      </button>
                    ))}
                    {hidden > 0 ? (
                      <button type="button" className="more" onClick={() => onSelectDay(iso)}>
                        +{hidden} more
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <section className="agenda" aria-label={`Items on ${formatPretty(selectedDay)}`}>
          <header>
            <h3>
              {formatPretty(selectedDay)}
              {today === selectedDay ? <span className="today-tag">Today</span> : null}
            </h3>
            <p>{agenda.length === 0 ? "Nothing pinned to this day." : `${agenda.length} pinned to this day`}</p>
          </header>
          <div className="agenda-list">
            {agenda.map((item) => (
              <ItemCard key={item.id} item={item} onOpen={onOpen} showSummary />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
