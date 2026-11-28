"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Direction Quiz: a random TQQQ session from the past year, picked from daily turning points and big trend days.
 * The chart shows the day up to "now". For any of the next 5, 15 and 30 minutes she calls Higher, Flat or Lower,
 * then reveals: every call is scored and the chart moves on to the furthest one. The date shows once the day is over.
 */

type Ohlc = [number, number, number, number];
type QuizDay = { date: string; symbol: string; kinds: string[]; start: number; bars: Ohlc[]; before: Ohlc[]; day: Ohlc; after: Ohlc[] };
type QuizIndex = { symbol: string; days: { date: string; kinds: string[] }[] };
type Timeframe = "1m" | "5m";
type Call = "up" | "flat" | "down";
type Tally = { answered: number; correct: number };
type Stats = {
  v: 1;
  answered: number;
  correct: number;
  flat: number;
  byTimeframe: Record<Timeframe, Tally>;
  byHorizon: Record<string, Tally>;
  byCall?: Partial<Record<Call, Tally>>;
  days: { date: string; kinds: string[]; answered: number; correct: number; at: string }[];
};
type Result = { horizon: number; call: Call; to: number; change: number; pct: number; actual: Call; right: boolean };
type Reveal = { from: number; to: number; results: Result[]; skipped: boolean };

const STATS_KEY = "snc-quiz:v1";
const PREFS_KEY = "snc-quiz-prefs:v1";
const HORIZONS = [5, 15, 30];
/** Within ±0.15% of the price now counts as Flat; beyond it, Higher or Lower. */
const FLAT = 0.0015;
/** How much of the day is shown before the first call. */
const WARMUP = 15;
const SKIP = 15;
const SESSION = 390;
const CALLS: { call: Call; label: string; cls: string }[] = [
  { call: "up", label: "▲ Higher", cls: "qz-pick-up" },
  { call: "flat", label: "— Flat", cls: "qz-pick-flat" },
  { call: "down", label: "▼ Lower", cls: "qz-pick-down" },
];
const CALL_WORD: Record<Call, string> = { up: "Higher", flat: "Flat", down: "Lower" };

function emptyStats(): Stats {
  return { v: 1, answered: 0, correct: 0, flat: 0, byTimeframe: { "1m": { answered: 0, correct: 0 }, "5m": { answered: 0, correct: 0 } }, byHorizon: {}, byCall: {}, days: [] };
}

function loadStats(): Stats {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATS_KEY) ?? "null") as Stats | null;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.days)) return { ...emptyStats(), ...parsed };
  } catch {
    /* ignore */
  }
  return emptyStats();
}

function saveStats(stats: Stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    /* ignore */
  }
}

function bump(tally: Tally | undefined, hit: number): Tally {
  return { answered: (tally?.answered ?? 0) + 1, correct: (tally?.correct ?? 0) + hit };
}

function clock(minute: number): string {
  const total = 9 * 60 + 30 + minute;
  const hour = Math.floor(total / 60);
  const mins = total % 60;
  return `${hour > 12 ? hour - 12 : hour}:${String(mins).padStart(2, "0")}`;
}

function pct(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

function signedPct(rate: number): string {
  const text = `${Math.abs(rate * 100).toFixed(2)}%`;
  return rate > 0 ? `+${text}` : rate < 0 ? `-${text}` : text;
}

function signedCents(value: number): string {
  const text = `$${Math.abs(value).toFixed(2)}`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** 5-minute candles from 1-minute bars (the last one may be partial). */
function aggregate(bars: Ohlc[], size: number): Ohlc[] {
  const out: Ohlc[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const slice = bars.slice(i, i + size);
    out.push([slice[0][0], Math.max(...slice.map((b) => b[1])), Math.min(...slice.map((b) => b[2])), slice[slice.length - 1][3]]);
  }
  return out;
}

export function QuizApp() {
  const [index, setIndex] = useState<QuizIndex | null>(null);
  const [day, setDay] = useState<QuizDay | null>(null);
  const [cursor, setCursor] = useState(WARMUP);
  const [picks, setPicks] = useState<Partial<Record<number, Call>>>({});
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [score, setScore] = useState<Tally>({ answered: 0, correct: 0 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  /** The row the keyboard's ↑ / F / ↓ keys fill in. */
  const [keyRow, setKeyRow] = useState(15);
  const [error, setError] = useState("");

  useEffect(() => {
    setStats(loadStats());
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { timeframe?: Timeframe };
      if (prefs.timeframe === "1m" || prefs.timeframe === "5m") setTimeframe(prefs.timeframe);
    } catch {
      /* ignore */
    }
    fetch("/quiz/index.json")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: QuizIndex) => setIndex(body))
      .catch(() => setError("Couldn’t load the quiz days. Refresh to try again."));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ timeframe }));
    } catch {
      /* ignore */
    }
  }, [timeframe]);

  function startDay(next: QuizDay) {
    setDay(next);
    setCursor(WARMUP);
    setPicks({});
    setReveal(null);
    setScore({ answered: 0, correct: 0 });
    setError("");
  }

  async function newDay() {
    if (!index || index.days.length === 0) return;
    // Prefer days not played recently.
    const recent = new Set((stats?.days ?? []).slice(-Math.min(30, index.days.length - 1)).map((entry) => entry.date));
    const pool = index.days.filter((entry) => !recent.has(entry.date) && entry.date !== day?.date);
    const choices = pool.length ? pool : index.days;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    try {
      const response = await fetch(`/quiz/${pick.date}.json`);
      if (!response.ok) throw new Error(String(response.status));
      startDay((await response.json()) as QuizDay);
    } catch {
      setError("Couldn’t load that day. Try again.");
    }
  }

  useEffect(() => {
    if (index && !day) void newDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const total = day?.bars.length ?? SESSION;
  const done = !!day && cursor >= total;
  const open = HORIZONS.filter((horizon) => cursor + horizon <= total);
  const chosen = open.filter((horizon) => picks[horizon]);
  const furthest = chosen.length ? Math.max(...chosen) : SKIP;
  const priceNow = day ? day.bars[Math.min(cursor, total) - 1][3] : 0;

  function choose(horizon: number, call: Call) {
    if (reveal || !open.includes(horizon)) return;
    setKeyRow(horizon);
    setPicks((current) => ({ ...current, [horizon]: current[horizon] === call ? undefined : call }));
  }

  function lockIn() {
    if (!day || reveal || done || chosen.length === 0) return;
    const from = cursor;
    const start = day.bars[from - 1][3];
    const results: Result[] = chosen.map((horizon) => {
      const to = from + horizon;
      const change = day.bars[to - 1][3] - start;
      const rate = change / start;
      const actual: Call = rate > FLAT ? "up" : rate < -FLAT ? "down" : "flat";
      const call = picks[horizon]!;
      return { horizon, call, to, change, pct: rate, actual, right: call === actual };
    });
    const to = from + Math.max(...chosen);
    setReveal({ from, to, results, skipped: false });
    setCursor(to);
    setPicks({});
    const hits = results.filter((result) => result.right).length;
    setScore((current) => ({ answered: current.answered + results.length, correct: current.correct + hits }));
    setStats((current) => {
      const base = current ?? emptyStats();
      const next: Stats = { ...base, byHorizon: { ...base.byHorizon }, byCall: { ...(base.byCall ?? {}) }, byTimeframe: { ...base.byTimeframe } };
      for (const result of results) {
        const hit = result.right ? 1 : 0;
        next.answered += 1;
        next.correct += hit;
        next.byTimeframe[timeframe] = bump(next.byTimeframe[timeframe], hit);
        next.byHorizon[String(result.horizon)] = bump(next.byHorizon[String(result.horizon)], hit);
        next.byCall![result.call] = bump(next.byCall![result.call], hit);
      }
      saveStats(next);
      return next;
    });
  }

  function skip() {
    if (!day || reveal || done) return;
    const to = Math.min(cursor + SKIP, total);
    setReveal({ from: cursor, to, results: [], skipped: true });
    setCursor(to);
    setPicks({});
  }

  function goOn() {
    if (!day) return;
    if (done) {
      // Record the finished day once, then deal another.
      setStats((current) => {
        const base = current ?? emptyStats();
        const next = { ...base, days: [...base.days, { date: day.date, kinds: day.kinds, answered: score.answered, correct: score.correct, at: new Date().toISOString() }].slice(-500) };
        saveStats(next);
        return next;
      });
      void newDay();
      return;
    }
    setReveal(null);
  }

  /** Play the same day again from 9:45. Calls already scored stay in the all-time numbers. */
  function restartDay() {
    if (day) startDay(day);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (!reveal && !done) {
        if (key === "1" || key === "2" || key === "3") setKeyRow(HORIZONS[Number(key) - 1]);
        else if (key === "arrowup" || key === "h") choose(keyRow, "up");
        else if (key === "f") choose(keyRow, "flat");
        else if (key === "arrowdown" || key === "l") choose(keyRow, "down");
        else if (key === "enter" || key === " ") lockIn();
        else if (key === "s") skip();
        else return;
      } else if (key === "enter" || key === " " || key === "arrowright" || key === "n") {
        goOn();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function resetStats() {
    const fresh = emptyStats();
    saveStats(fresh);
    setStats(fresh);
  }

  const rightNow = reveal ? reveal.results.filter((result) => result.right).length : 0;

  return (
    <div className="shell qz-shell">
      <header className="topbar">
        <div className="brand">
          <p className="kicker">For Dao</p>
          <h1>
            <a href="/">Stock News Calendar</a>
          </h1>
        </div>
        <div className="top-actions">
          <nav className="view-switch" aria-label="Views">
            <a href="/">Calendar</a>
            <a href="/simulator">Simulator</a>
            <a href="/practice">Practice</a>
            <a href="/quiz" aria-current="page">
              Quiz
            </a>
          </nav>
        </div>
      </header>
      <main className="qz-main">
        <section className="qz-head">
          <div>
            <h2>Direction quiz</h2>
            <p className="qz-note">
              A random {index?.symbol ?? "TQQQ"} day from the past year: daily turning points and big trend days. From “now”, call where it’ll be 5, 15
              and 30 minutes later: higher, flat (within ±{(FLAT * 100).toFixed(2)}%) or lower. Make one call or all three, then reveal. The date shows
              when the day is over.
            </p>
          </div>
          <dl className="qz-stats">
            <div>
              <dt>All-time</dt>
              <dd>{stats && stats.answered ? `${pct(stats.correct / stats.answered)} right` : "—"}</dd>
              <dd className="qz-small">{stats ? `${stats.correct} of ${stats.answered} calls` : ""}</dd>
            </div>
            <div>
              <dt>This day</dt>
              <dd>{score.answered ? `${pct(score.correct / score.answered)} right` : "—"}</dd>
              <dd className="qz-small">{`${score.correct} of ${score.answered} calls`}</dd>
            </div>
          </dl>
        </section>

        <div className="qz-controls">
          <div className="pr-toggle" role="group" aria-label="Chart timeframe">
            {(["1m", "5m"] as Timeframe[]).map((value) => (
              <button key={value} type="button" aria-pressed={timeframe === value} onClick={() => setTimeframe(value)}>
                {value === "1m" ? "1 min" : "5 min"}
              </button>
            ))}
          </div>
          <div className="pr-toggle" role="group" aria-label="Day">
            <button type="button" onClick={restartDay} disabled={!day}>
              Restart this day
            </button>
            <button type="button" onClick={() => void newDay()} disabled={!index}>
              New day
            </button>
          </div>
        </div>

        {error ? <p className="qz-error">{error}</p> : null}
        {!day ? <p className="qz-note">Loading a day…</p> : null}

        <div className="qz-board">
          <div className="qz-charts">
            {day ? (
              <>
                <DailyContext day={day} done={done} />
                <IntradayChart day={day} cursor={cursor} timeframe={timeframe} ahead={reveal ? 0 : furthest} reveal={reveal} />
                <div className="qz-now">
                  <strong>{clock(Math.min(cursor, total))}</strong>
                  <span>
                    {day.symbol} ${priceNow.toFixed(2)} · day {signedPct(priceNow / day.before[day.before.length - 1][3] - 1)} vs prior close
                  </span>
                </div>
              </>
            ) : null}
          </div>
          <div className="qz-side">
            {day && !reveal && !done ? (
              <div className="qz-ask">
                <p className="qz-q">Where will {day.symbol} be?</p>
                <p className="qz-note">
                  Flat = within ±${(priceNow * FLAT).toFixed(2)} of ${priceNow.toFixed(2)}.
                </p>
                {HORIZONS.map((horizon) => {
                  const available = open.includes(horizon);
                  return (
                    <div key={horizon} className={keyRow === horizon ? "qz-row qz-row-key" : "qz-row"}>
                      <p className="qz-row-label">
                        <b>{horizon} min</b> · {available ? clock(cursor + horizon) : "after the close"}
                      </p>
                      <div className="qz-picks" role="group" aria-label={`${horizon} minutes ahead`}>
                        {CALLS.map(({ call, label, cls }) => (
                          <button
                            key={call}
                            type="button"
                            className={`qz-pick ${cls}`}
                            aria-pressed={picks[horizon] === call}
                            disabled={!available}
                            onClick={() => choose(horizon, call)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="qz-next" disabled={chosen.length === 0} onClick={lockIn}>
                  {chosen.length === 0 ? "Make a call to reveal" : `Reveal ${chosen.length} call${chosen.length === 1 ? "" : "s"} (to ${clock(cursor + furthest)})`}
                </button>
                <button type="button" className="text-btn qz-skip" onClick={skip}>
                  Skip {SKIP} min
                </button>
                <p className="qz-keys">Keys: 1 2 3 pick a row · ↑ higher · F flat · ↓ lower · Enter reveal · S skip</p>
              </div>
            ) : null}
            {day && reveal ? (
              <div className={`qz-result ${reveal.skipped ? "" : rightNow === reveal.results.length ? "qz-right" : rightNow === 0 ? "qz-wrong" : ""}`}>
                <p className="qz-q">
                  {reveal.skipped
                    ? `Skipped to ${clock(reveal.to)}`
                    : `${rightNow} of ${reveal.results.length} right`}
                </p>
                {reveal.results.map((result) => (
                  <p key={result.horizon} className={result.right ? "qz-line qz-line-right" : "qz-line qz-line-wrong"}>
                    {result.right ? "✓" : "✗"} <b>{result.horizon} min</b> ({clock(result.to)}): you said {CALL_WORD[result.call]}, it was {CALL_WORD[result.actual]}{" "}
                    {signedCents(result.change)} ({signedPct(result.pct)})
                  </p>
                ))}
                {done ? (
                  <div className="qz-done">
                    <h3>{prettyDate(day.date)}</h3>
                    <p className="qz-note">
                      {day.kinds.join(" · ")} on the daily chart. You were {score.answered ? pct(score.correct / score.answered) : "—"} right ({score.correct} of{" "}
                      {score.answered}).
                    </p>
                  </div>
                ) : null}
                <button type="button" className="qz-next" onClick={goOn}>
                  {done ? "Next day" : "Next"}
                </button>
                <p className="qz-keys">Key: Enter or Space for {done ? "the next day" : "the next call"}</p>
              </div>
            ) : null}

            {stats && stats.answered ? (
              <section className="qz-breakdown">
                <h3>Your accuracy</h3>
                <ul>
                  {(["1m", "5m"] as Timeframe[]).map((value) =>
                    stats.byTimeframe[value].answered ? (
                      <li key={value}>
                        {value === "1m" ? "1-min chart" : "5-min chart"}: {pct(stats.byTimeframe[value].correct / stats.byTimeframe[value].answered)} of{" "}
                        {stats.byTimeframe[value].answered}
                      </li>
                    ) : null,
                  )}
                  {HORIZONS.filter((horizon) => stats.byHorizon[String(horizon)]?.answered).map((horizon) => {
                    const tally = stats.byHorizon[String(horizon)];
                    return (
                      <li key={horizon}>
                        {horizon} min ahead: {pct(tally.correct / tally.answered)} of {tally.answered}
                      </li>
                    );
                  })}
                  {CALLS.filter(({ call }) => stats.byCall?.[call]?.answered).map(({ call }) => {
                    const tally = stats.byCall![call]!;
                    return (
                      <li key={call}>
                        When you said {CALL_WORD[call]}: {pct(tally.correct / tally.answered)} of {tally.answered}
                      </li>
                    );
                  })}
                  <li>Days finished: {stats.days.length}</li>
                </ul>
                <p className="qz-note">With three choices, guessing at random gets about 33%.</p>
                <button type="button" className="text-btn" onClick={resetStats}>
                  Reset accuracy
                </button>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

const W = 1000;

function Candles({ bars, x, y, width }: { bars: Ohlc[]; x: (i: number) => number; y: (price: number) => number; width: number }) {
  return (
    <>
      {bars.map((bar, i) => {
        const [o, h, l, c] = bar;
        const up = c >= o;
        const top = y(Math.max(o, c));
        const bottom = y(Math.min(o, c));
        const cls = up ? "qz-c-up" : "qz-c-down";
        return (
          <g key={i} className={cls}>
            <line x1={x(i)} x2={x(i)} y1={y(h)} y2={y(l)} strokeWidth={Math.max(1, width / 5)} />
            <rect x={x(i) - width / 2} y={top} width={width} height={Math.max(1, bottom - top)} />
          </g>
        );
      })}
    </>
  );
}

function IntradayChart({ day, cursor, timeframe, ahead, reveal }: { day: QuizDay; cursor: number; timeframe: Timeframe; ahead: number; reveal: Reveal | null }) {
  const H = 420;
  const top = 16;
  const bottom = 44;
  const right = 96;
  const total = day.bars.length;
  const shown = day.bars.slice(0, Math.min(cursor, total));
  const priorClose = day.before[day.before.length - 1][3];

  const view = useMemo(() => {
    if (timeframe === "5m") {
      const bars = aggregate(shown, 5);
      const slots = Math.ceil(SESSION / 5);
      return { bars, slots, firstMinute: 0, per: 5 };
    }
    // 1-minute: the last 90 minutes plus room for the furthest call (30 minutes).
    const window = 90;
    const first = Math.max(0, shown.length - window);
    return { bars: shown.slice(first), slots: window + 30, firstMinute: first, per: 1 };
  }, [shown, timeframe]);

  const prices = view.bars.flatMap((bar) => [bar[1], bar[2]]);
  let min = Math.min(...prices, priorClose);
  let max = Math.max(...prices, priorClose);
  // Keep the prior close in view only when it's near; far away it would squash the candles.
  if (priorClose < Math.min(...prices) - (Math.max(...prices) - Math.min(...prices)) * 1.5 || priorClose > Math.max(...prices) + (Math.max(...prices) - Math.min(...prices)) * 1.5) {
    min = Math.min(...prices);
    max = Math.max(...prices);
  }
  const pad = (max - min || max * 0.01) * 0.08;
  min -= pad;
  max += pad;
  const plotW = W - right;
  const step = plotW / view.slots;
  const x = (i: number) => step * (i + 0.5);
  const y = (price: number) => top + ((max - price) / (max - min)) * (H - top - bottom);
  const width = Math.max(1.5, Math.min(14, step * 0.6));
  const nowX = step * view.bars.length;
  const aheadW = Math.min(plotW - nowX, (ahead / view.per) * step);
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) * (max - min)) / 4);
  const timeMarks: number[] = [];
  for (let minute = 0; minute <= SESSION; minute += timeframe === "5m" ? 60 : 30) {
    const slot = (minute - view.firstMinute) / view.per;
    if (slot >= 0 && slot <= view.slots) timeMarks.push(minute);
  }
  const showPrior = priorClose >= min && priorClose <= max;
  const xAt = (minute: number) => ((minute - view.firstMinute) / view.per) * step;

  return (
    <figure className="qz-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${day.symbol} ${timeframe === "5m" ? "5-minute" : "1-minute"} chart up to ${clock(Math.min(cursor, total))}`}>
        {!reveal && cursor < total && ahead > 0 ? <rect className="qz-ahead" x={nowX} y={top} width={Math.max(0, aheadW)} height={H - top - bottom} /> : null}
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="qz-grid" x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} />
            <text className="qz-tick" x={plotW + 8} y={y(tick) + 5}>
              {tick.toFixed(2)}
            </text>
          </g>
        ))}
        {timeMarks.map((minute) => (
          <text
            key={minute}
            className="qz-tick"
            x={Math.max(0, ((minute - view.firstMinute) / view.per) * step)}
            y={H - 8}
            textAnchor={((minute - view.firstMinute) / view.per) * step < 40 ? "start" : "middle"}
          >
            {clock(minute)}
          </text>
        ))}
        {showPrior ? (
          <g>
            <line className="qz-prior" x1={0} x2={plotW} y1={y(priorClose)} y2={y(priorClose)} />
            <text className="qz-prior-label" x={6} y={y(priorClose) - 6}>
              Prior close {priorClose.toFixed(2)}
            </text>
          </g>
        ) : null}
        <Candles bars={view.bars} x={x} y={y} width={width} />
        {reveal
          ? reveal.results.map((result) => (
              <g key={result.horizon}>
                <line
                  className={result.right ? "qz-move-right" : "qz-move-wrong"}
                  x1={xAt(reveal.from)}
                  x2={xAt(result.to)}
                  y1={y(day.bars[reveal.from - 1][3])}
                  y2={y(day.bars[result.to - 1][3])}
                />
                <circle className={result.right ? "qz-dot-right" : "qz-dot-wrong"} cx={xAt(result.to)} cy={y(day.bars[result.to - 1][3])} r={6} />
              </g>
            ))
          : null}
        <line className="qz-nowline" x1={nowX} x2={nowX} y1={top} y2={H - bottom} />
      </svg>
    </figure>
  );
}

function DailyContext({ day, done }: { day: QuizDay; done: boolean }) {
  const H = 150;
  const bars = done ? [...day.before, day.day, ...day.after] : day.before;
  const slots = day.before.length + 1 + day.after.length;
  const prices = bars.flatMap((bar) => [bar[1], bar[2]]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const step = W / slots;
  const x = (i: number) => step * (i + 0.5);
  const y = (price: number) => 8 + ((max - price) / (max - min || 1)) * (H - 16);
  const dayX = x(day.before.length);
  return (
    <figure className="qz-daily">
      <figcaption>Daily chart{done ? ": the quiz day is outlined, then the days after it" : " into this day (dates hidden)"}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={done ? "Daily candles before, on and after the quiz day" : "Daily candles leading into the quiz day"}>
        <rect className={done ? "qz-dayslot-done" : "qz-dayslot"} x={dayX - step / 2} y={2} width={step} height={H - 4} />
        <Candles bars={bars} x={x} y={y} width={Math.max(2, step * 0.6)} />
      </svg>
    </figure>
  );
}
