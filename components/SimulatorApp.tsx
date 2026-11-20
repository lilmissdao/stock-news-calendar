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

const CHART_WIDTH = 760;
const CHART_HEIGHT = 300;

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
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  allowNegative?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text ?? String(value)}
        onBlur={(event) => {
          const parsed = Number(event.currentTarget.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
          setText(null);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/,/g, "");
          if (next !== "" && !pattern.test(next)) return;
          if (next.length > 16) return;
          setText(next);
          if (next === "" || next === "-" || next === "." || next === "-.") return;
          const parsed = Number(next);
          if (Number.isFinite(parsed)) onChange(parsed);
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
  const { points, years } = result;
  const finite = points.length > 1 && points.every((point) => Number.isFinite(point.balance));
  const label = `${name.trim() || "Scenario"} balance over ${years} ${years === 1 ? "year" : "years"}`;

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
    const left = Math.max(78, Math.min(196, longest * 6.6 + 18));
    const top = 16;
    const right = 14;
    const bottom = 36;
    const plotWidth = CHART_WIDTH - left - right;
    const plotHeight = CHART_HEIGHT - top - bottom;
    const xOf = (index: number) => left + (index / (points.length - 1)) * plotWidth;
    const yOf = (value: number) => top + ((max - value) / span) * plotHeight;
    const labels = chartLabelMonths(years * 12);
    return { min, max, span, ticks, tickLabels, left, top, right, bottom, plotHeight, xOf, yOf, labels };
  }, [finite, points, years]);

  if (!geometry) {
    return (
      <figure className="chart">
        <figcaption>Balance</figcaption>
        <p className="empty">This scenario grows past what the chart can draw.</p>
      </figure>
    );
  }

  const { span, ticks, tickLabels, left, top, plotHeight, xOf, yOf, labels } = geometry;
  const line = points.map((point, index) => `${xOf(index).toFixed(1)},${yOf(point.balance).toFixed(1)}`).join(" ");
  const hoverPoint: MonthPoint | null = hover === null ? null : points[hover] ?? null;
  const hoverText = hoverPoint ? `${formatMonthLabel(hoverPoint.month)} ${formatAxisMoney(hoverPoint.balance, span)}` : "";
  const tipX = hover === null ? 0 : xOf(hover);
  const tipY = hoverPoint ? yOf(hoverPoint.balance) : 0;

  function nearest(event: ReactPointerEvent<SVGSVGElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
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
      <figcaption>Balance</figcaption>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
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
        <line className="axis" x1={left} y1={top} x2={left} y2={top + plotHeight} />
        <line className="axis" x1={left} y1={top + plotHeight} x2={CHART_WIDTH - 14} y2={top + plotHeight} />
        {ticks.map((tick, index) => (
          <text key={`${index}-${tick}`} className="tick" x={left - 8} y={yOf(tick) + 4} textAnchor="end">
            {tickLabels[index]}
          </text>
        ))}
        {labels.map((month) => {
          const last = labels[labels.length - 1] === month && month !== labels[0];
          const anchor = month === 0 ? "start" : last ? "end" : "middle";
          return (
            <text key={month} className="tick" x={xOf(month)} y={CHART_HEIGHT - 12} textAnchor={anchor}>
              {formatMonthLabel(month)}
            </text>
          );
        })}
        <polyline className="series" points={line} />
        {hoverPoint ? (
          <g>
            <line className="sim-guide" x1={tipX} y1={top} x2={tipX} y2={top + plotHeight} />
            <circle className="point" cx={tipX} cy={tipY} r="4.5" />
          </g>
        ) : null}
      </svg>
      {hoverPoint ? (
        <div
          className="sim-tip"
          style={{
            left: `${(tipX / CHART_WIDTH) * 100}%`,
            top: `${(tipY / CHART_HEIGHT) * 100}%`,
            transform:
              (tipX / CHART_WIDTH) * 100 > 74
                ? "translate(-100%, calc(-100% - 10px))"
                : (tipX / CHART_WIDTH) * 100 < 26
                  ? "translate(0, calc(-100% - 10px))"
                  : "translate(-50%, calc(-100% - 10px))",
          }}
        >
          <span>{formatMonthLabel(hoverPoint.month)}</span>
          <strong>{formatAxisMoney(hoverPoint.balance, span)}</strong>
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
  canRemove,
  onChange,
  onDuplicate,
  onRemove,
}: {
  scenario: Scenario;
  canRemove: boolean;
  onChange: (id: string, patch: Partial<Omit<Scenario, "id">>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const titleId = useId();
  const result = useMemo(() => simulate(scenario), [scenario]);
  const depositNote = scenario.monthlyDeposit !== 0;

  return (
    <article className="sim-card" id={`scenario-${scenario.id}`} aria-labelledby={titleId}>
      <div className="sim-card-head">
        <label className="field sim-name">
          <span>Name</span>
          <input
            id={titleId}
            type="text"
            value={scenario.name}
            maxLength={80}
            autoComplete="off"
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
          <dt>Drawdown days</dt>
          <dd>
            {result.drawdownDays} of {result.tradingDays}
          </dd>
        </div>
        <div className="sim-stat">
          <dt>Avg net return per month</dt>
          <dd>{depositNote ? "—" : formatPercent(result.avgNetMonthly)}</dd>
          {depositNote ? <small>Shown when the monthly deposit is $0</small> : null}
        </div>
        <div className="sim-stat">
          <dt>Time to $1M</dt>
          <dd>{formatTimeToMillion(result.millionDay, result.years, scenario.startingCapital)}</dd>
        </div>
      </dl>
      <BalanceChart name={scenario.name} result={result} />
    </article>
  );
}

export function SimulatorApp() {
  const [theme, toggleTheme] = useTheme();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [notice, setNotice] = useState("");
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
            {scenarios.map((scenario) => (
              <li key={scenario.id}>
                <ScenarioCard
                  scenario={scenario}
                  canRemove={scenarios.length > 1}
                  onChange={updateScenario}
                  onDuplicate={duplicate}
                  onRemove={remove}
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
