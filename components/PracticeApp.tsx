"use client";

import { useEffect, useMemo, useState } from "react";
import market from "@/data/practice-market.json";
import { PracticeChart, type ChartCandle, type ChartMark } from "@/components/PracticeChart";
import {
  advance,
  equityNow,
  holdTqqqValue,
  loadGame,
  newGame,
  nextBatch,
  nextDay,
  trade,
  type EquityPoint,
  type GameState,
  type Speed,
} from "@/lib/practice-engine";
import type { PracticeMarket } from "@/lib/practice-market";
import { aggregate, buildSession, clock, type Timeframe } from "@/lib/practice-path";
import { formatCents, formatWholeDollars } from "@/lib/simulator";
import type { Ticker } from "@/lib/practice-trade";

const STORAGE_KEY = "snc-practice:v1";
const BOOK = market as PracticeMarket;
const SPEEDS: Speed[] = [1, 5, 15, 60];
const FRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1D"];
const SIZES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 390 };

function pct(value: number): string {
  const text = `${Math.abs(value * 100).toFixed(2)}%`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function dollars(value: number): string {
  const text = formatWholeDollars(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function holdLabel(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 60) return `${rounded}m`;
  return `${Math.floor(rounded / 60)}h ${rounded % 60}m`;
}

function snap(start: number, minute: number, timeframe: Timeframe): number {
  const size = SIZES[timeframe];
  return start + Math.floor(minute / size) * size * 60;
}

export function PracticeApp() {
  const [game, setGame] = useState<GameState | null>(null);
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    setGame(loadGame(localStorage.getItem(STORAGE_KEY), BOOK.days.length) ?? newGame(BOOK.days.length));
    const stored = localStorage.getItem("snc-theme");
    const initial = stored === "dark" || stored === "light" ? stored : document.documentElement.dataset.theme || "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
  }, []);

  useEffect(() => {
    if (!game) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
    } catch {
      /* Private mode can refuse storage. The session still runs. */
    }
  }, [game]);

  useEffect(() => {
    if (!game?.playing) return;
    const id = window.setInterval(() => {
      setGame((current) => (current ? play(current, current.speed) : current));
    }, 1000);
    return () => window.clearInterval(id);
  }, [game?.playing, game?.speed, game?.phase, game?.day, game?.batchStart]);

  const session = useMemo(() => {
    if (!game) return null;
    return buildSession(BOOK.days[game.batchStart + game.day], game.seeds[game.day] || 1);
  }, [game]);

  if (!game || !session) {
    return (
      <div className="shell">
        <p className="pr-loading">Loading practice…</p>
      </div>
    );
  }

  const day = BOOK.days[game.batchStart + game.day];
  const price = session[game.ticker][game.cursor]?.c ?? 0;
  const value = equityNow(game, session.TQQQ, session.SQQQ);
  const position = game.positions[game.ticker];
  const other = game.ticker === "TQQQ" ? "SQQQ" : "TQQQ";
  const today = game.dayStartEquity > 0 ? value / game.dayStartEquity - 1 : 0;
  const candles = aggregate(session[game.ticker], game.timeframe, game.cursor + 1);
  const marks: ChartMark[] = game.markers
    .filter((mark) => mark.ticker === game.ticker && mark.minute <= game.cursor)
    .map((mark) => ({ time: snap(day.start, mark.minute, game.timeframe), side: mark.side }));
  const asOf = session.TQQQ[game.cursor] ? clock(session.TQQQ[game.cursor].t + 60) : "";

  function act(side: "buy" | "sell", fraction: number) {
    setGame((current) => (current ? trade(current, current.ticker, side, fraction, price) : current));
  }

  return (
    <div className="shell pr-shell">
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
            <a href="/practice" aria-current="page">
              Practice
            </a>
          </nav>
          <button type="button" className="theme" aria-pressed={theme === "dark"} onClick={() => toggle(setTheme)}>
            {theme === "dark" ? "Dark mode" : "Light mode"}
          </button>
        </div>
      </header>
      <main className="pr-main">
        <div className="pr-bar">
          <div className="pr-toggle" role="group" aria-label="Ticker">
            {(["TQQQ", "SQQQ"] as Ticker[]).map((symbol) => (
              <button key={symbol} type="button" aria-pressed={game.ticker === symbol} onClick={() => setGame({ ...game, ticker: symbol })}>
                {symbol}
              </button>
            ))}
          </div>
          <p className="pr-day">
            {game.phase === "play" ? `Day ${game.day + 1} of 5` : prettyDate(day.date)}
            <span>{asOf}</span>
          </p>
          <strong className={today >= 0 ? "up" : "down"}>{dollars(value - game.dayStartEquity)} {pct(today)}</strong>
        </div>
        <div className="pr-toggle" role="group" aria-label="Timeframe">
          {FRAMES.map((frame) => (
            <button key={frame} type="button" aria-pressed={game.timeframe === frame} onClick={() => setGame({ ...game, timeframe: frame })}>
              {frame}
            </button>
          ))}
        </div>
        {game.phase !== "batch" ? <PracticeChart candles={candles as ChartCandle[]} markers={marks} theme={theme} /> : null}
        {game.phase === "play" ? (
          <>
            <dl className="pr-stats">
              <Stat label="Cash" value={formatWholeDollars(game.cash)} />
              <Stat label="Value" value={formatWholeDollars(value)} />
              <Stat label="Today" value={pct(today)} tone={today} />
              <Stat label={position.shares ? `${position.shares} sh` : "Flat"} value={position.shares ? formatWholeDollars(position.avgCost) : "—"} />
              <Stat
                label="Open P/L"
                value={position.shares ? `${dollars((price - position.avgCost) * position.shares)} ${pct(position.avgCost ? price / position.avgCost - 1 : 0)}` : "—"}
                tone={position.shares ? price - position.avgCost : 0}
              />
              <Stat label="Fees" value={formatCents(game.dayFees)} />
            </dl>
            {game.positions[other].shares > 0 ? (
              <p className="pr-note">
                Also holding {game.positions[other].shares} {other}
              </p>
            ) : null}
            <div className="pr-pad">
              <div>
                {([0.25, 0.5, 0.75, 1] as const).map((fraction) => (
                  <button key={fraction} type="button" className="pr-buy" onClick={() => act("buy", fraction)}>
                    Buy {fraction * 100}%
                  </button>
                ))}
              </div>
              <div>
                {([0.25, 0.5, 0.75, 1] as const).map((fraction) => (
                  <button key={fraction} type="button" className="pr-sell" disabled={!position.shares} onClick={() => act("sell", fraction)}>
                    Sell {fraction * 100}%
                  </button>
                ))}
              </div>
            </div>
            <div className="pr-dock">
              <button type="button" className="today-jump" onClick={() => setGame({ ...game, playing: !game.playing })}>
                {game.playing ? "Pause" : "Play"}
              </button>
              {SPEEDS.map((speed) => (
                <button key={speed} type="button" className="text-btn" aria-pressed={game.speed === speed} onClick={() => setGame({ ...game, speed })}>
                  {speed}x
                </button>
              ))}
              <button type="button" className="text-btn" onClick={() => setGame((current) => (current ? play(current, 1) : current))}>
                Step +1m
              </button>
            </div>
          </>
        ) : null}
        {game.phase === "day" ? <DayReview game={game} onNext={() => setGame((current) => (current ? nextDay(current) : current))} /> : null}
        {game.phase === "batch" ? (
          <BatchReview
            game={game}
            onNext={() => setGame((current) => (current ? nextBatch(current, BOOK.days.length) : current))}
            onReset={() => setGame(newGame(BOOK.days.length))}
          />
        ) : null}
        <p className="chart-note">
          {BOOK.source}. Snapshot {BOOK.fetchedAt.slice(0, 10)}. The wiggle inside each 5-minute bar is randomized; the bar’s open, high, low, and close are real.
        </p>
      </main>
    </div>
  );
}

function play(state: GameState, steps: number): GameState {
  const sessionDay = BOOK.days[state.batchStart + state.day];
  const paths = buildSession(sessionDay, state.seeds[state.day] || 1);
  const first = BOOK.days[state.batchStart].tqqq[0][0];
  const last = BOOK.days[state.batchStart + 4].tqqq[77][3];
  return advance(state, steps, paths.TQQQ, paths.SQQQ, sessionDay.date, holdTqqqValue(state.batchStartEquity, first, last));
}

function toggle(setTheme: (theme: string) => void) {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("snc-theme", next);
  } catch {
    /* ignore */
  }
  setTheme(next);
}

function Stat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone > 0 ? "up" : tone < 0 ? "down" : undefined}>{value}</dd>
    </div>
  );
}

function DayReview({ game, onNext }: { game: GameState; onNext: () => void }) {
  const last = game.batchDays[game.batchDays.length - 1];
  return (
    <section className="pr-review">
      <h2>Day {game.day + 1} of 5</h2>
      <p className="pr-lead">
        {prettyDate(last.date)} · {dollars(last.dollars)} · {pct(last.pct)}
      </p>
      <p className="pr-note">Fees {formatCents(last.fees)}. Flat into the close.</p>
      <button type="button" className="today-jump" onClick={onNext}>
        {game.day < 4 ? "Next day" : "Batch review"}
      </button>
    </section>
  );
}

function BatchReview({ game, onNext, onReset }: { game: GameState; onNext: () => void; onReset: () => void }) {
  const batch = game.history.batches[game.history.batches.length - 1];
  const origin = game.history.equity[0]?.value || 31000;
  const latest = game.history.equity[game.history.equity.length - 1]?.value || game.cash;
  return (
    <section className="pr-review">
      <h2>Batch review</h2>
      <p className="pr-lead">
        {prettyDate(batch.startDate)} – {prettyDate(batch.endDate)} · {dollars(batch.endEquity - batch.startEquity)} · {pct(batch.startEquity ? batch.endEquity / batch.startEquity - 1 : 0)}
      </p>
      <ul className="pr-days">
        {batch.days.map((day, index) => (
          <li key={day.date}>
            <span>Day {index + 1}</span>
            <span>{prettyDate(day.date)}</span>
            <strong className={day.dollars >= 0 ? "up" : "down"}>
              {dollars(day.dollars)} {pct(day.pct)}
            </strong>
          </li>
        ))}
      </ul>
      <dl className="pr-stats">
        <Stat label="Trades" value={String(batch.trades.length)} />
        <Stat label="Win rate" value={batch.winRate === null ? "—" : pct(batch.winRate).replace("+", "")} />
        <Stat label="Best" value={batch.best === null ? "—" : dollars(batch.best)} tone={batch.best ?? 0} />
        <Stat label="Worst" value={batch.worst === null ? "—" : dollars(batch.worst)} tone={batch.worst ?? 0} />
        <Stat label="Avg hold" value={holdLabel(batch.avgHold)} />
        <Stat label="Max drop" value={pct(-batch.maxDrawdown)} tone={-1} />
        <Stat label="Fees" value={formatCents(batch.fees)} />
        <Stat label="Hold TQQQ" value={dollars(batch.holdTqqq - batch.startEquity)} tone={batch.holdTqqq - batch.startEquity} />
      </dl>
      <h3>Overall</h3>
      <p className="pr-lead">
        {dollars(latest - origin)} · {pct(origin ? latest / origin - 1 : 0)} from {formatWholeDollars(origin)}
      </p>
      <EquityChart points={game.history.equity} />
      <ol className="pr-batches">
        {game.history.batches.map((item, index) => (
          <li key={`${item.startDate}-${index}`}>
            Batch {index + 1}: {dollars(item.endEquity - item.startEquity)} {pct(item.startEquity ? item.endEquity / item.startEquity - 1 : 0)}
          </li>
        ))}
      </ol>
      <div className="pr-actions">
        <button type="button" className="today-jump" onClick={onNext}>
          Next batch
        </button>
        <button type="button" className="text-btn" onClick={onReset}>
          New game
        </button>
      </div>
    </section>
  );
}

function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 640;
  const height = 150;
  const pad = 18;
  const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
  const y = (value: number) => (max === min ? height / 2 : pad + (1 - (value - min) / (max - min)) * (height - pad * 2));
  const path = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  return (
    <svg className="pr-equity" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Account value by day">
      <path d={path} />
    </svg>
  );
}
