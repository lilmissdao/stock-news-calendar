"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Direction Quiz: a random TQQQ session from the past year, picked from daily turning points and big trend days.
 * The chart shows the day up to "now"; she calls whether TQQQ will be higher or lower a few minutes later, the next
 * stretch is revealed, and so on until the close. The date stays hidden until the day is over.
 */

type Ohlc = [number, number, number, number];
type QuizDay = { date: string; symbol: string; kinds: string[]; start: number; bars: Ohlc[]; before: Ohlc[]; day: Ohlc; after: Ohlc[] };
type QuizIndex = { symbol: string; days: { date: string; kinds: string[] }[] };
type Timeframe = "1m" | "5m";
type Guess = "up" | "down";
type Tally = { answered: number; correct: number };
type Stats = {
  v: 1;
  answered: number;
  correct: number;
  flat: number;
  byTimeframe: Record<Timeframe, Tally>;
  byHorizon: Record<string, Tally>;
  days: { date: string; kinds: string[]; answered: number; correct: number; at: string }[];
};
type Reveal = { guess: Guess | "skip"; from: number; to: number; change: number; pct: number; outcome: "right" | "wrong" | "flat" | "skip" };

const STATS_KEY = "snc-quiz:v1";
const PREFS_KEY = "snc-quiz-prefs:v1";
const HORIZONS = [5, 15, 30];
/** Moves smaller than this (0.05%) count as flat: neither right nor wrong. */
const FLAT = 0.0005;
/** How much of the day is shown before the first question. */
const WARMUP = 15;
const SESSION = 390;

function emptyStats(): Stats {
  return { v: 1, answered: 0, correct: 0, flat: 0, byTimeframe: { "1m": { answered: 0, correct: 0 }, "5m": { answered: 0, correct: 0 } }, byHorizon: {}, days: [] };
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
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [score, setScore] = useState<Tally>({ answered: 0, correct: 0 });
  const [stats, setStats] = useState<Stats | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>("5m");
  const [horizon, setHorizon] = useState(15);
  const [error, setError] = useState("");

  useEffect(() => {
    setStats(loadStats());
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { timeframe?: Timeframe; horizon?: number };
      if (prefs.timeframe === "1m" || prefs.timeframe === "5m") setTimeframe(prefs.timeframe);
      if (prefs.horizon && HORIZONS.includes(prefs.horizon)) setHorizon(prefs.horizon);
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
      localStorage.setItem(PREFS_KEY, JSON.stringify({ timeframe, horizon }));
    } catch {
      /* ignore */
    }
  }, [timeframe, horizon]);

  async function newDay() {
    if (!index || index.days.length === 0) return;
    // Prefer days not played recently.
    const recent = new Set((stats?.days ?? []).slice(-Math.min(30, index.days.length - 1)).map((entry) => entry.date));
    const pool = index.days.filter((entry) => !recent.has(entry.date));
    const choices = pool.length ? pool : index.days;
    const pick = choices[Math.floor(Math.random() * choices.length)];
    try {
      const response = await fetch(`/quiz/${pick.date}.json`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as QuizDay;
      setDay(body);
      setCursor(WARMUP);
      setReveal(null);
      setScore({ answered: 0, correct: 0 });
      setError("");
    } catch {
      setError("Couldn’t load that day. Try again.");
    }
  }

  useEffect(() => {
    if (index && !day) void newDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const total = day?.bars.length ?? SESSION;
  const done = !!day && cursor >= total && !!reveal;
  const nextTo = Math.min(cursor + horizon, total);

  function answer(guess: Guess | "skip") {
    if (!day || reveal || cursor >= total) return;
    const from = cursor;
    const to = nextTo;
    const startPrice = day.bars[from - 1][3];
    const change = day.bars[to - 1][3] - startPrice;
    const rate = change / startPrice;
    const outcome: Reveal["outcome"] =
      guess === "skip" ? "skip" : Math.abs(rate) < FLAT ? "flat" : (rate > 0) === (guess === "up") ? "right" : "wrong";
    setReveal({ guess, from, to, change, pct: rate, outcome });
    setCursor(to);
    if (outcome === "right" || outcome === "wrong") {
      const hit = outcome === "right" ? 1 : 0;
      setScore((current) => ({ answered: current.answered + 1, correct: current.correct + hit }));
      setStats((current) => {
        const base = current ?? emptyStats();
        const key = String(to - from);
        const next: Stats = {
          ...base,
          answered: base.answered + 1,
          correct: base.correct + hit,
          byTimeframe: { ...base.byTimeframe, [timeframe]: { answered: base.byTimeframe[timeframe].answered + 1, correct: base.byTimeframe[timeframe].correct + hit } },
          byHorizon: { ...base.byHorizon, [key]: { answered: (base.byHorizon[key]?.answered ?? 0) + 1, correct: (base.byHorizon[key]?.correct ?? 0) + hit } },
        };
        saveStats(next);
        return next;
      });
    } else if (outcome === "flat") {
      setStats((current) => {
        const base = current ?? emptyStats();
        const next = { ...base, flat: base.flat + 1 };
        saveStats(next);
        return next;
      });
    }
  }

  function goOn() {
    if (!day) return;
    if (cursor >= total) {
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

  function resetStats() {
    const fresh = emptyStats();
    saveStats(fresh);
    setStats(fresh);
  }

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
              A random {index?.symbol ?? "TQQQ"} day from the past year: daily turning points and big trend days. Call whether it’s higher or lower
              {` ${horizon} minutes`} from now, all day long. The date shows when the day is over.
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
          <div className="pr-toggle" role="group" aria-label="Call how far ahead">
            {HORIZONS.map((value) => (
              <button key={value} type="button" aria-pressed={horizon === value} onClick={() => setHorizon(value)} disabled={!!reveal && !done}>
                {value} min ahead
              </button>
            ))}
          </div>
        </div>

        {error ? <p className="qz-error">{error}</p> : null}
        {!day ? <p className="qz-note">Loading a day…</p> : null}

        {day ? (
          <>
            <DailyContext day={day} done={done} />
            <IntradayChart day={day} cursor={cursor} timeframe={timeframe} horizon={horizon} reveal={reveal} />
            <div className="qz-now">
              <strong>{clock(Math.min(cursor, total))}</strong>
              <span>
                {day.symbol} ${day.bars[Math.min(cursor, total) - 1][3].toFixed(2)} · day {signedPct(day.bars[Math.min(cursor, total) - 1][3] / day.before[day.before.length - 1][3] - 1)} vs prior close
              </span>
            </div>

            {!reveal ? (
              <div className="qz-ask">
                <p className="qz-q">
                  Higher or lower at <b>{clock(nextTo)}</b>?
                </p>
                <div className="qz-buttons">
                  <button type="button" className="qz-up" onClick={() => answer("up")}>
                    ▲ Higher
                  </button>
                  <button type="button" className="qz-down" onClick={() => answer("down")}>
                    ▼ Lower
                  </button>
                </div>
                <button type="button" className="text-btn qz-skip" onClick={() => answer("skip")}>
                  Skip this one
                </button>
              </div>
            ) : (
              <div className={`qz-result qz-${reveal.outcome}`}>
                <p className="qz-q">
                  {reveal.outcome === "right"
                    ? "✓ Right"
                    : reveal.outcome === "wrong"
                      ? "✗ Wrong"
                      : reveal.outcome === "flat"
                        ? "Flat, not counted"
                        : "Skipped"}
                  {` · ${clock(reveal.from)} → ${clock(reveal.to)}: ${signedCents(reveal.change)} (${signedPct(reveal.pct)})`}
                </p>
                {done ? (
                  <div className="qz-done">
                    <h3>{prettyDate(day.date)}</h3>
                    <p className="qz-note">
                      {day.kinds.join(" · ")} on the daily chart. You were {score.answered ? pct(score.correct / score.answered) : "—"} right ({score.correct} of {score.answered}).
                    </p>
                  </div>
                ) : null}
                <button type="button" className="qz-next" onClick={goOn}>
                  {done ? "Next day" : "Next"}
                </button>
              </div>
            )}
          </>
        ) : null}

        {stats && stats.answered ? (
          <section className="qz-breakdown">
            <h3>Your accuracy</h3>
            <ul>
              {(["1m", "5m"] as Timeframe[]).map((value) =>
                stats.byTimeframe[value].answered ? (
                  <li key={value}>
                    {value === "1m" ? "1-min chart" : "5-min chart"}: {pct(stats.byTimeframe[value].correct / stats.byTimeframe[value].answered)} of {stats.byTimeframe[value].answered}
                  </li>
                ) : null,
              )}
              {Object.entries(stats.byHorizon)
                .filter(([key]) => HORIZONS.includes(Number(key)))
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([key, tally]) => (
                  <li key={key}>
                    {key} min ahead: {pct(tally.correct / tally.answered)} of {tally.answered}
                  </li>
                ))}
              <li>Days finished: {stats.days.length}</li>
            </ul>
            <p className="qz-note">50% is a coin flip. Moves under 0.05% count as flat and aren’t scored.</p>
            <button type="button" className="text-btn" onClick={resetStats}>
              Reset accuracy
            </button>
          </section>
        ) : null}
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

function IntradayChart({ day, cursor, timeframe, horizon, reveal }: { day: QuizDay; cursor: number; timeframe: Timeframe; horizon: number; reveal: Reveal | null }) {
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
    // 1-minute: the last 90 minutes plus room for the next call.
    const window = 90;
    const first = Math.max(0, shown.length - window);
    return { bars: shown.slice(first), slots: window + horizon, firstMinute: first, per: 1 };
  }, [shown, timeframe, horizon]);

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
  const aheadW = Math.min(plotW - nowX, (horizon / view.per) * step);
  const ticks = Array.from({ length: 4 }, (_, i) => min + ((i + 0.5) * (max - min)) / 4);
  const timeMarks: number[] = [];
  for (let minute = 0; minute <= SESSION; minute += timeframe === "5m" ? 60 : 30) {
    const slot = (minute - view.firstMinute) / view.per;
    if (slot >= 0 && slot <= view.slots) timeMarks.push(minute);
  }
  const showPrior = priorClose >= min && priorClose <= max;
  const answerFrom = reveal && reveal.guess !== "skip" ? reveal.from : null;

  return (
    <figure className="qz-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${day.symbol} ${timeframe === "5m" ? "5-minute" : "1-minute"} chart up to ${clock(Math.min(cursor, total))}`}>
        {!reveal && cursor < total ? <rect className="qz-ahead" x={nowX} y={top} width={Math.max(0, aheadW)} height={H - top - bottom} /> : null}
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
        {answerFrom !== null && reveal ? (
          <line
            className={reveal.outcome === "right" ? "qz-move-right" : reveal.outcome === "wrong" ? "qz-move-wrong" : "qz-move-flat"}
            x1={((answerFrom - view.firstMinute) / view.per) * step}
            x2={((reveal.to - view.firstMinute) / view.per) * step}
            y1={y(day.bars[answerFrom - 1][3])}
            y2={y(day.bars[reveal.to - 1][3])}
          />
        ) : null}
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
