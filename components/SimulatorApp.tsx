"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DEFAULT_SCENARIOS,
  TRADING_DAYS_PER_YEAR,
  chartLabelMonths,
  createScenario,
  decodeScenarios,
  duplicateScenario,
  formatAxisMoney,
  formatMonthLabel,
  formatPercent,
  formatSignedPercent,
  formatTimeToMillion,
  formatWholeDollars,
  loadScenarios,
  saveScenarios,
  sharePath,
  simulate,
  type MonthPoint,
  type Scenario,
  type Simulation,
} from "@/lib/simulator";

const NAV = [
  { href: "/", label: "Calendar" },
  { href: "/?view=list", label: "List" },
  { href: "/?view=ticker", label: "Ticker" },
  { href: "/?view=stocks", label: "Stocks" },
  { href: "/?view=connections", label: "Connections" },
  { href: "/enterprise-ai", label: "Enterprise AI" },
  { href: "/pharma", label: "Pharma/Biotech" },
  { href: "/simulator", label: "Simulator", current: true },
];

const CHART_HEIGHT = 400;

function useTheme(): ["light" | "dark", () => void] {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const ready = useRef(false);

  useLayoutEffect(() => {
    const stored = localStorage.getItem("snc-theme");
    const initial =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setTheme(initial);
  }, []);

  useLayoutEffect(() => {
    if (!ready.current) {
      ready.current = true;
      return;
    }
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("snc-theme", theme);
    } catch {
      /* Private browsing can reject storage. The toggle still applies for this visit. */
    }
  }, [theme]);

  return [theme, () => setTheme((current) => (current === "dark" ? "light" : "dark"))];
}

function DollarField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    const digits = caretDigits.current;
    if (!input || digits === null || document.activeElement !== input) return;
    caretDigits.current = null;
    const formatted = input.value;
    if (digits === 0) {
      input.setSelectionRange(formatted.startsWith("$") ? 1 : 0, formatted.startsWith("$") ? 1 : 0);
      return;
    }
    let seen = 0;
    let pos = formatted.length;
    for (let i = 0; i < formatted.length; i += 1) {
      const code = formatted.charCodeAt(i);
      if (code >= 48 && code <= 57) {
        seen += 1;
        if (seen === digits) {
          pos = i + 1;
          break;
        }
      }
    }
    input.setSelectionRange(pos, pos);
  }, [value]);

  return (
    <label className="field">
      <span>{label}</span>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={formatWholeDollars(value)}
        onChange={(event) => {
          const raw = event.target.value;
          const cursor = event.target.selectionStart ?? raw.length;
          caretDigits.current = raw.slice(0, cursor).replace(/\D/g, "").length;
          const digits = raw.replace(/\D/g, "").slice(0, 15);
          onChange(digits ? Number(digits) : 0);
        }}
      />
    </label>
  );
}

function DecimalField({
  label,
  value,
  onChange,
  allowNegative = false,
  integer = false,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const pattern = integer ? /^\d*$/ : allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  function commit(raw: string) {
    let parsed = Number(raw);
    if (!Number.isFinite(parsed)) parsed = min ?? 0;
    if (integer) parsed = Math.round(parsed);
    if (min !== undefined) parsed = Math.max(min, parsed);
    if (max !== undefined) parsed = Math.min(max, parsed);
    onChange(parsed);
  }

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        autoComplete="off"
        spellCheck={false}
        value={text ?? String(value)}
        onBlur={(event) => {
          commit(event.currentTarget.value);
          setText(null);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/,/g, "");
          if (next !== "" && !pattern.test(next)) return;
          if (next.length > 16) return;
          setText(next);
          if (next === "" || next === "-" || next === "." || next === "-.") return;
          const parsed = Number(next);
          if (!Number.isFinite(parsed)) return;
          if (max !== undefined && parsed > max) {
            commit(next);
            setText(null);
            return;
          }
          onChange(integer ? Math.round(parsed) : parsed);
        }}
      />
    </label>
  );
}

function axisTicks(min: number, max: number): number[] {
  const span = max - min;
  const rough = span / 4;
  const exponent = Math.floor(Math.log10(rough > 0 ? rough : 1));
  const base = 10 ** exponent;
  const fraction = rough / base;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  const step = nice * base;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const value = Number((start + i * step).toPrecision(12));
    if (value > max + step * 1e-6) break;
    if (value >= min - step * 1e-6) ticks.push(value);
  }
  return ticks.length > 0 ? ticks : [min, max];
}

function BalanceChart({ name, result }: { name: string; result: Simulation }) {
  const [hover, setHover] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(960);
  const { points, years } = result;
  const finite = points.length > 1 && points.every((point) => Number.isFinite(point.balance));
  const label = `${name.trim() || "Scenario"} balance over ${years} ${years === 1 ? "year" : "years"}`;

  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => setViewWidth(Math.max(320, Math.round(node.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    if (!finite) return null;
    const values = points.map((point) => point.balance);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.08;
      min -= pad;
      max += pad;
    }
    const span = max - min;
    const ticks = axisTicks(min, max);
    const tickLabels = ticks.map((tick) => formatAxisMoney(tick, span));
    const longest = tickLabels.reduce((best, text) => Math.max(best, text.length), 0);
    const left = Math.max(84, Math.min(168, longest * 8.4 + 22));
    const top = 18;
    const right = 28;
    const bottom = 42;
    const plotWidth = viewWidth - left - right;
    const plotHeight = CHART_HEIGHT - top - bottom;
    const xOf = (index: number) => left + (index / (points.length - 1)) * plotWidth;
    const yOf = (value: number) => top + ((max - value) / span) * plotHeight;
    const labels = chartLabelMonths(years * 12, plotWidth);
    return { span, ticks, tickLabels, left, top, right, plotWidth, plotHeight, xOf, yOf, labels };
  }, [finite, points, years, viewWidth]);

  if (!geometry) {
    return (
      <figure className="chart">
        <figcaption>Balance</figcaption>
        <p className="empty">This scenario grows past what the chart can draw.</p>
      </figure>
    );
  }

  const { ticks, tickLabels, left, top, plotWidth, plotHeight, xOf, yOf, labels } = geometry;
  const line = points.map((point, index) => `${xOf(index).toFixed(1)},${yOf(point.balance).toFixed(1)}`).join(" ");
  const hoverPoint: MonthPoint | null = hover === null ? null : points[hover] ?? null;
  const hoverText = hoverPoint ? `${formatMonthLabel(hoverPoint.month)} ${formatWholeDollars(hoverPoint.balance)}` : "";
  const tipX = hover === null ? 0 : xOf(hover);
  const tipY = hoverPoint ? yOf(hoverPoint.balance) : 0;
  const plotRight = left + plotWidth;

  function nearest(event: ReactPointerEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * viewWidth;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.abs(xOf(index) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    return best;
  }

  return (
    <figure className="chart sim-chart">
      <div ref={frameRef}>
      <svg
        viewBox={`0 0 ${viewWidth} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${label}, from ${formatWholeDollars(points[0].balance)} to ${formatWholeDollars(points[points.length - 1].balance)}. Drawdowns are included.`}
        tabIndex={0}
        onPointerMove={(event) => setHover(nearest(event))}
        onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((current) => current ?? 0)}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          setHover((current) => {
            const index = current ?? 0;
            return event.key === "ArrowRight" ? Math.min(points.length - 1, index + 1) : Math.max(0, index - 1);
          });
        }}
      >
        {ticks.map((tick, index) => (
          <line key={`h-${index}-${tick}`} className="sim-grid" x1={left} y1={yOf(tick)} x2={plotRight} y2={yOf(tick)} />
        ))}
        {labels.map((month) => (
          <line key={`v-${month}`} className="sim-grid" x1={xOf(month)} y1={top} x2={xOf(month)} y2={top + plotHeight} />
        ))}
        <line className="axis" x1={left} y1={top} x2={left} y2={top + plotHeight} />
        <line className="axis" x1={left} y1={top + plotHeight} x2={plotRight} y2={top + plotHeight} />
        {ticks.map((tick, index) => (
          <text key={`${index}-${tick}`} className="tick" x={left - 10} y={yOf(tick) + 5} textAnchor="end">
            {tickLabels[index]}
          </text>
        ))}
        {labels.map((month, index) => {
          const last = index === labels.length - 1 && index !== 0;
          const anchor = index === 0 ? "start" : last ? "end" : "middle";
          return (
            <text key={month} className="tick sim-xlabel" x={xOf(month)} y={CHART_HEIGHT - 16} textAnchor={anchor}>
              {formatMonthLabel(month)}
            </text>
          );
        })}
        <polyline className="series" points={line} />
        {hoverPoint ? (
          <g>
            <line className="sim-guide" x1={tipX} y1={top} x2={tipX} y2={top + plotHeight} />
            <circle className="point" cx={tipX} cy={tipY} r="5" />
          </g>
        ) : null}
      </svg>
      </div>
      {hoverPoint ? (
        <div
          className="sim-tip"
          style={{
            left: `${(tipX / viewWidth) * 100}%`,
            top: `${(tipY / CHART_HEIGHT) * 100}%`,
            transform:
              (tipX / viewWidth) * 100 > 74
                ? "translate(-100%, calc(-100% - 10px))"
                : (tipX / viewWidth) * 100 < 26
                  ? "translate(0, calc(-100% - 10px))"
                  : "translate(-50%, calc(-100% - 10px))",
          }}
        >
          <span>{formatMonthLabel(hoverPoint.month)}</span>
          <strong>{formatWholeDollars(hoverPoint.balance)}</strong>
        </div>
      ) : null}
      <p className="sr" aria-live="polite">
        {hoverText}
      </p>
    </figure>
  );
}

function ScenarioCard({
  scenario,
  index,
  total,
  canRemove,
  dragging,
  onChange,
  onDuplicate,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  scenario: Scenario;
  index: number;
  total: number;
  canRemove: boolean;
  dragging: boolean;
  onChange: (id: string, patch: Partial<Omit<Scenario, "id">>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, delta: number) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (targetId: string, sourceId: string) => void;
}) {
  const titleId = useId();
  const result = useMemo(() => simulate(scenario), [scenario]);
  const depositNote = scenario.monthlyDeposit !== 0;
  const number = index + 1;

  return (
    <article
      className={dragging ? "sim-card is-dragging" : "sim-card"}
      id={`scenario-${scenario.id}`}
      aria-labelledby={titleId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId = event.dataTransfer.getData("text/plain");
        if (sourceId) onDrop(scenario.id, sourceId);
      }}
    >
      <div className="sim-card-head">
        <div className="sim-reorder">
          <button
            type="button"
            className="sim-move"
            aria-label={`Move scenario ${number} up`}
            disabled={index === 0}
            onClick={() => onMove(scenario.id, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="sim-move"
            aria-label={`Move scenario ${number} down`}
            disabled={index === total - 1}
            onClick={() => onMove(scenario.id, 1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="sim-drag"
            draggable
            aria-label={`Drag scenario ${number} to reorder`}
            title="Drag to reorder"
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", scenario.id);
              event.dataTransfer.effectAllowed = "move";
              onDragStart(scenario.id);
            }}
            onDragEnd={onDragEnd}
          >
            <span aria-hidden="true">⋮⋮</span>
          </button>
        </div>
        <label className="sim-title">
          <span className="sim-index" aria-hidden="true">
            #{number}
          </span>
          <input
            id={titleId}
            type="text"
            value={scenario.name}
            maxLength={80}
            autoComplete="off"
            aria-label={`Scenario ${number} name`}
            onChange={(event) => onChange(scenario.id, { name: event.target.value })}
          />
        </label>
        <div className="sim-card-actions">
          <button type="button" className="text-btn" onClick={() => onDuplicate(scenario.id)}>
            Duplicate
          </button>
          <button
            type="button"
            className="text-btn"
            disabled={!canRemove}
            title={canRemove ? "Remove scenario" : "At least one scenario stays"}
            onClick={() => onRemove(scenario.id)}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="sim-fields">
        <DollarField
          label="Starting capital"
          value={scenario.startingCapital}
          onChange={(startingCapital) => onChange(scenario.id, { startingCapital })}
        />
        <DecimalField
          label="Avg return per trading day (%)"
          value={scenario.dailyReturnPct}
          allowNegative
          onChange={(dailyReturnPct) => onChange(scenario.id, { dailyReturnPct })}
        />
        <DecimalField
          label="Drawdown size per hit (%)"
          value={scenario.drawdownPct}
          onChange={(drawdownPct) => onChange(scenario.id, { drawdownPct })}
        />
        <DecimalField
          label="Drawdowns per month"
          value={scenario.drawdownsPerMonth}
          onChange={(drawdownsPerMonth) => onChange(scenario.id, { drawdownsPerMonth: Math.max(0, drawdownsPerMonth) })}
        />
        <DecimalField
          label="No-trade days / month"
          value={scenario.noTradeDaysPerMonth}
          integer
          min={0}
          max={21}
          onChange={(noTradeDaysPerMonth) => onChange(scenario.id, { noTradeDaysPerMonth })}
        />
        <DollarField
          label="Monthly deposit"
          value={scenario.monthlyDeposit}
          onChange={(monthlyDeposit) => onChange(scenario.id, { monthlyDeposit })}
        />
        <label className="field">
          <span>Time span</span>
          <select
            value={scenario.years}
            onChange={(event) => onChange(scenario.id, { years: Number(event.target.value) })}
          >
            {Array.from({ length: 10 }, (_, index) => index + 1).map((year) => (
              <option key={year} value={year}>
                {year} {year === 1 ? "year" : "years"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="sim-results">
        <div className="sim-stat">
          <dt>Ending balance</dt>
          <dd>{formatWholeDollars(result.ending)}</dd>
        </div>
        <div className="sim-stat">
          <dt>Total put in</dt>
          <dd>{formatWholeDollars(result.totalPutIn)}</dd>
        </div>
        <div className="sim-stat">
          <dt>Avg net return per month</dt>
          <dd>{depositNote ? "—" : formatPercent(result.avgNetMonthly)}</dd>
          {depositNote ? <small>Shown when the monthly deposit is $0</small> : null}
        </div>
        <div className="sim-stat">
          <dt>Avg return per year</dt>
          <dd>{formatSignedPercent(result.avgAnnual)}</dd>
        </div>
        <div className="sim-stat">
          <dt>Time to $1M</dt>
          <dd>{formatTimeToMillion(result.millionDay, result.years, scenario.startingCapital)}</dd>
        </div>
      </dl>
      <p className="sim-years">
        {result.yearSlices.map((slice, index) => (
          <span key={slice.year}>
            {index > 0 ? " · " : ""}
            Yr {slice.year} {formatSignedPercent(slice.rate)} · {formatWholeDollars(slice.ending)}
          </span>
        ))}
      </p>
      <BalanceChart name={scenario.name} result={result} />
    </article>
  );
}

export function SimulatorApp() {
  const [theme, toggleTheme] = useTheme();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const scrollNew = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("s");
    const shared = token ? decodeScenarios(token) : null;
    if (shared) {
      saveScenarios(shared);
      params.delete("s");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      setScenarios(shared);
      return;
    }
    setScenarios(loadScenarios() ?? DEFAULT_SCENARIOS.map((scenario) => ({ ...scenario })));
  }, []);

  useEffect(() => {
    if (!scenarios) return;
    setSaveError(!saveScenarios(scenarios));
  }, [scenarios]);

  useEffect(() => {
    if (notice !== "Copied the share link.") return;
    const id = window.setTimeout(() => setNotice(""), 2500);
    return () => window.clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (!scrollNew.current || !scenarios) return;
    scrollNew.current = false;
    const last = scenarios[scenarios.length - 1];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`scenario-${last.id}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [scenarios]);

  function updateScenario(id: string, patch: Partial<Omit<Scenario, "id">>) {
    setScenarios((current) => (current ? current.map((scenario) => (scenario.id === id ? { ...scenario, ...patch } : scenario)) : current));
  }

  function addScenario() {
    scrollNew.current = true;
    setScenarios((current) => {
      const list = current ?? [];
      return [...list, createScenario(list[list.length - 1], list.length + 1)];
    });
  }

  function duplicate(id: string) {
    setScenarios((current) => {
      if (!current) return current;
      const index = current.findIndex((scenario) => scenario.id === id);
      if (index < 0) return current;
      const next = current.slice();
      next.splice(index + 1, 0, duplicateScenario(current[index]));
      return next;
    });
  }

  function remove(id: string) {
    setScenarios((current) => {
      if (!current || current.length <= 1) return current;
      return current.filter((scenario) => scenario.id !== id);
    });
  }

  function moveScenario(id: string, delta: number) {
    setScenarios((current) => {
      if (!current) return current;
      const from = current.findIndex((scenario) => scenario.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = current.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function beginDrag(id: string) {
    draggingRef.current = id;
    setDraggingId(id);
  }

  function endDrag() {
    draggingRef.current = null;
    setDraggingId(null);
  }

  function dropScenario(targetId: string, sourceId: string) {
    const source = sourceId || draggingRef.current;
    endDrag();
    if (!source) return;
    setScenarios((current) => {
      if (!current || source === targetId) return current;
      const from = current.findIndex((scenario) => scenario.id === source);
      const to = current.findIndex((scenario) => scenario.id === targetId);
      if (from < 0 || to < 0) return current;
      const next = current.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  async function copyShare() {
    if (!scenarios) return;
    const url = `${window.location.origin}${sharePath(scenarios)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Copied the share link.");
    } catch {
      setNotice(url);
    }
  }

  const shareFallback = notice.startsWith("http");

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">For Dao</p>
          <h1>
            <a href="/">Stock News Calendar</a>
          </h1>
        </div>
        <div className="top-actions">
          <nav className="view-switch" aria-label="Views">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} aria-current={item.current ? "page" : undefined} aria-selected={item.current ? "true" : "false"}>
                {item.label}
              </a>
            ))}
          </nav>
          <button type="button" className="theme" aria-pressed={theme === "dark"} onClick={toggleTheme}>
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>
      <main className="sim-page">
        <div className="sim-head">
          <div>
            <p className="kicker">Model</p>
            <h2>Trading growth simulator</h2>
            <p className="chart-note sim-footnote">Assumes steady returns. Real trading has losing streaks.</p>
          </div>
          <div className="sim-actions">
            <button type="button" className="today-jump" disabled={!scenarios} onClick={addScenario}>
              Add scenario
            </button>
            <button type="button" className="text-btn" disabled={!scenarios} onClick={() => void copyShare()}>
              {notice === "Copied the share link." ? "Copied" : "Copy share link"}
            </button>
          </div>
        </div>
        <p className="chart-note">Saved in this browser. Copy share link opens the same scenarios on another device.</p>
        {saveError ? (
          <p className="sim-status" role="status">
            This browser blocked saving. Copy share link still works.
          </p>
        ) : null}
        {notice && !shareFallback ? (
          <p className="sim-status" role="status">
            {notice}
          </p>
        ) : null}
        {shareFallback ? (
          <label className="field">
            <span>Share link</span>
            <input className="sim-share" readOnly value={notice} onFocus={(event) => event.currentTarget.select()} />
          </label>
        ) : null}
        {scenarios === null ? (
          <p className="sim-loading">Loading saved scenarios…</p>
        ) : (
          <ul className="sim-list">
            {scenarios.map((scenario, index) => (
              <li key={scenario.id}>
                <ScenarioCard
                  scenario={scenario}
                  index={index}
                  total={scenarios.length}
                  canRemove={scenarios.length > 1}
                  dragging={draggingId === scenario.id}
                  onChange={updateScenario}
                  onDuplicate={duplicate}
                  onRemove={remove}
                  onMove={moveScenario}
                  onDragStart={beginDrag}
                  onDragEnd={endDrag}
                  onDrop={dropScenario}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="chart-note">
          {TRADING_DAYS_PER_YEAR} trading days a year, 21 a month. Each day compounds. A drawdown day replaces that day’s gain. A
          deposit lands every 21 trading days. The line is one point per month.
        </p>
      </main>
    </div>
  );
}
