"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import market from "@/data/practice-market.json";
import { PracticeChart, type ChartCandle, type ChartMark, type PracticeChartHandle } from "@/components/PracticeChart";
import { PracticeHistory } from "@/components/PracticeHistory";
import {
  equityNow,
  fastForward,
  liveQuote,
  chooseSession,
  loadGame,
  minuteLeft,
  newGame,
  nextDay,
  openBatchReview,
  sessionHoldValue,
  SPEEDS,
  stepMinute,
  summarizeBatch,
  tickForward,
  ticksDue,
  tickMs,
  trade,
  coerceSpeed,
  type EquityPoint,
  type GameState,
  type Speed,
} from "@/lib/practice-engine";
import {
  archiveCurrent,
  hasProgress,
  HISTORY_KEY,
  deleteAllHistory,
  deleteGame,
  parseExport,
  parseHistory,
  playedDates,
  rowFromGame,
  serializeExport,
  SPEED_KEY,
  type GameRow,
  type HistoryFile,
} from "@/lib/practice-history";
import type { PracticeMarket } from "@/lib/practice-market";
import { chartBars, clock, SESSION_MINUTES, SUBTICKS, buildSession, type Timeframe } from "@/lib/practice-path";
import { formatCents, formatWholeDollars } from "@/lib/simulator";
import type { Ticker } from "@/lib/practice-trade";

const STORAGE_KEY = "snc-practice:v1";
const CHART_KEY = "snc-practice-chart-h";
const BOOK = market as PracticeMarket;
const FRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1D"];
const SIZES: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1D": 30 };

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

function dayStarted(state: GameState): boolean {
  const open = state.positions.TQQQ.shares + state.positions.SQQQ.shares > 0;
  return state.cursor > 0 || state.tick > 0 || state.markers.length > 0 || state.dayFees > 0 || open;
}

function sessionWindow(day: (typeof BOOK.days)[number]): { open: number; close: number; date: string } {
  const closeBar = day.tqqq[5] ?? day.tqqq[day.tqqq.length - 1];
  return { open: day.tqqq[0][0], close: closeBar[3], date: day.date };
}

function fullHold(state: GameState): number {
  return sessionHoldValue(
    state.batchStartEquity,
    BOOK.days.slice(state.batchStart, state.batchStart + state.batchDaysTotal).map(sessionWindow),
  );
}

function holdForDates(startEquity: number, dates: string[]): number {
  const windows = dates.flatMap((date) => {
    const day = BOOK.days.find((item) => item.date === date);
    return day ? [sessionWindow(day)] : [];
  });
  return sessionHoldValue(startEquity, windows);
}

function hasNextSession(state: GameState): boolean {
  if (state.phase === "day" && state.day + 1 < state.batchDaysTotal) return true;
  return state.batchStart + state.batchDaysTotal < BOOK.days.length;
}

function pendingDates(state: GameState): string[] {
  const dates = state.batchDays.map((day) => day.date);
  if (state.phase === "play" && dayStarted(state)) {
    const date = BOOK.days[state.batchStart + state.day]?.date;
    if (date) dates.push(date);
  }
  return dates;
}

function run(state: GameState, step: typeof tickForward): GameState {
  const day = BOOK.days[state.batchStart + state.day];
  const paths = buildSession(day, state.seeds[state.day] || 1);
  return step(state, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES), day.date, fullHold(state));
}

function runForward(state: GameState, steps: number): GameState {
  const day = BOOK.days[state.batchStart + state.day];
  const paths = buildSession(day, state.seeds[state.day] || 1);
  return fastForward(state, steps, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES), day.date, fullHold(state));
}

function priorClose(index: number, ticker: Ticker): number | null {
  if (index <= 0) return null;
  const bars = ticker === "TQQQ" ? BOOK.days[index - 1].tqqq : BOOK.days[index - 1].sqqq;
  return bars[bars.length - 1]?.[3] ?? null;
}

function rememberSpeed(speed: Speed) {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    /* Private mode can refuse storage. */
  }
}

function historyRows(game: GameState, history: HistoryFile, ending: number): GameRow[] {
  const archived = [...history.games].reverse().map((item) => rowFromGame(item));
  if (!hasProgress(game)) return archived;
  const batches = [...game.history.batches];
  if (game.phase !== "batch") {
    const days = [...game.batchDays];
    if (game.phase === "play" && dayStarted(game)) {
      const date = BOOK.days[game.batchStart + game.day]?.date ?? "";
      days.push({
        date,
        dollars: ending - game.dayStartEquity,
        pct: game.dayStartEquity > 0 ? ending / game.dayStartEquity - 1 : 0,
        equity: ending,
        drawdown: game.dayDrawdown,
        fees: game.dayFees,
      });
    }
    if (days.length > 0 || game.batchTrades.length > 0) {
      const end = days.length ? days[days.length - 1].equity : ending;
      batches.push(summarizeBatch(days, game.batchTrades, game.batchStartEquity, end, game.batchFees, holdForDates(game.batchStartEquity, days.map((day) => day.date))));
    }
  }
  const current = rowFromGame(
    {
      id: "this",
      number: 0,
      playedAt: game.startedAt,
      endedAt: "",
      batches,
      endingBalance: ending,
      startBalance: game.history.equity[0]?.value || 31000,
    },
    "This game",
  );
  return [current, ...archived];
}

export function PracticeApp() {
  const [game, setGame] = useState<GameState | null>(null);
  const [history, setHistory] = useState<HistoryFile | null>(null);
  const [theme, setTheme] = useState("light");
  const [tab, setTab] = useState<"play" | "history">("play");
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chartH, setChartH] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const chartRef = useRef<PracticeChartHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const speed = coerceSpeed(typeof localStorage !== "undefined" ? localStorage.getItem(SPEED_KEY) : 1);
    const loaded = loadGame(localStorage.getItem(STORAGE_KEY), BOOK.days.length) ?? newGame(BOOK.days.length, Math.random, speed);
    setGame(loaded);
    rememberSpeed(loaded.speed);
    setHistory(parseHistory(localStorage.getItem(HISTORY_KEY)));
    const stored = localStorage.getItem("snc-theme");
    const initial = stored === "dark" || stored === "light" ? stored : document.documentElement.dataset.theme || "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    const savedHeight = Number(localStorage.getItem(CHART_KEY));
    if (savedHeight >= 220 && savedHeight <= 1200) setChartH(savedHeight);
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
    if (!history) return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* ignore */
    }
  }, [history]);

  const clockRef = useRef<{ at: number; applied: number } | null>(null);
  useEffect(() => {
    if (!game?.playing || game.phase !== "play") {
      clockRef.current = null;
      return;
    }
    const speed = game.speed;
    clockRef.current = { at: Date.now(), applied: 0 };
    let frame = 0;
    const pump = () => {
      const clock = clockRef.current;
      if (!clock) return;
      const due = ticksDue(Date.now() - clock.at, speed);
      const add = due - clock.applied;
      if (add > 0) {
        clock.applied = due;
        setGame((current) => (current && current.playing && current.phase === "play" ? runForward(current, add) : current));
      }
    };
    const loop = () => {
      pump();
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    const timer = window.setInterval(pump, Math.min(250, tickMs(speed)));
    const wake = () => pump();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      clockRef.current = null;
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, [game?.playing, game?.speed, game?.phase, game?.day, game?.batchStart]);

  const pathKey = game ? `${game.batchStart}:${game.day}:${game.seeds[game.day] ?? 0}` : "";
  const session = useMemo(() => {
    if (!game) return null;
    const day = BOOK.days[game.batchStart + game.day];
    if (!day) return null;
    const paths = buildSession(day, game.seeds[game.day] || 1);
    return { day, TQQQ: paths.TQQQ.slice(0, SESSION_MINUTES), SQQQ: paths.SQQQ.slice(0, SESSION_MINUTES) };
  }, [pathKey]);

  if (!game || !session || !history) {
    return (
      <div className="shell">
        <p className="pr-loading">Loading practice…</p>
      </div>
    );
  }

  const quote = liveQuote(game, session.TQQQ, session.SQQQ);
  const price = quote[game.ticker];
  const value = equityNow(game, session.TQQQ, session.SQQQ);
  const position = game.positions[game.ticker];
  const other = game.ticker === "TQQQ" ? "SQQQ" : "TQQQ";
  const today = game.dayStartEquity > 0 ? value / game.dayStartEquity - 1 : 0;
  const candles = chartBars(session[game.ticker], game.cursor, game.tick, game.seeds[game.day] || 1, game.ticker === "TQQQ" ? 1 : -1, game.timeframe);
  const marks: ChartMark[] = game.markers
    .filter((mark) => mark.ticker === game.ticker && mark.minute <= game.cursor)
    .map((mark) => ({ time: snap(session.day.start, mark.minute, game.timeframe), side: mark.side }));
  const shown = session.TQQQ[Math.min(game.cursor, session.TQQQ.length - 1)];
  const asOf = shown ? clock(shown.t + (game.tick >= SUBTICKS ? 60 : 0)) : "";
  const prior = priorClose(game.batchStart + game.day, game.ticker);
  const played = new Set(playedDates(history, game));
  const rows = historyRows(game, history, value);
  const active = game;
  const tape = session;
  const saved = history;

  function act(side: "buy" | "sell", fraction: number) {
    setGame((current) => {
      if (!current) return current;
      const day = BOOK.days[current.batchStart + current.day];
      const paths = buildSession(day, current.seeds[current.day] || 1);
      const live = liveQuote(current, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES));
      return trade(current, current.ticker, side, fraction, live[current.ticker], day?.date ?? "");
    });
  }

  function chooseSpeed(speed: Speed) {
    rememberSpeed(speed);
    setGame({ ...active, speed });
  }

  function askNew() {
    setGame((current) => (current ? { ...current, playing: false } : current));
    setConfirm(true);
  }

  function pickDay(index: number) {
    setGame((current) => {
      if (!current) return current;
      const dates = current.phase === "batch" ? [] : current.batchDays.map((day) => day.date);
      return chooseSession(current, BOOK.days.length, index, holdForDates(current.batchStartEquity, dates));
    });
  }

  function commitNew() {
    const ending = equityNow(active, tape.TQQQ, tape.SQQQ);
    setHistory(archiveCurrent(active, saved, ending, tape.day.date, holdForDates(active.batchStartEquity, pendingDates(active))));
    const speed = coerceSpeed(localStorage.getItem(SPEED_KEY) ?? active.speed);
    setGame(newGame(BOOK.days.length, Math.random, speed));
    setConfirm(false);
    setTab("play");
    setNotice(null);
  }

  function exportHistory() {
    const blob = new Blob([serializeExport(saved, active, active.speed)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "practice-history.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importHistory(file: File) {
    try {
      const parsed = parseExport(await file.text(), BOOK.days.length);
      if (!parsed) {
        setNotice("That file isn’t a practice history.");
        return;
      }
      setHistory(parsed.history);
      setGame((current) => {
        const base = parsed.game ?? current;
        if (!base) return current;
        const speed = parsed.speed ?? base.speed;
        rememberSpeed(speed);
        return { ...base, playing: false, speed };
      });
      setNotice("History imported.");
    } catch {
      setNotice("That file isn’t a practice history.");
    }
  }

  function removeGame(id: string) {
    if (id === "this") return;
    setHistory((current) => (current ? deleteGame(current, id) : current));
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
        <div className="pr-toggle" role="tablist" aria-label="Practice">
          <button type="button" role="tab" aria-selected={tab === "play"} onClick={() => setTab("play")}>
            Trade
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            onClick={() => {
              setTab("history");
              setGame((current) => (current ? { ...current, playing: false } : current));
            }}
          >
            History
          </button>
        </div>
        {confirm ? (
          <section className="pr-confirm">
            <h2>Start over at $31,000?</h2>
            <p className="pr-lead">Your history is kept.</p>
            <div className="pr-actions">
              <button type="button" className="text-btn" onClick={() => setConfirm(false)}>
                Keep playing
              </button>
              <button type="button" className="today-jump" onClick={commitNew}>
                New game
              </button>
            </div>
          </section>
        ) : null}
        {!confirm && tab === "history" ? (
          <PracticeHistory
            history={history}
            game={game}
            rows={rows}
            pending={game.phase === "batch" ? [] : game.batchDays}
            onExport={exportHistory}
            onImport={(file) => void importHistory(file)}
            onNewGame={askNew}
            onDelete={removeGame}
            onDeleteAll={() => setHistory(deleteAllHistory())}
            notice={notice}
          />
        ) : null}
        {!confirm && tab === "play" ? (
          <>
            <div className="pr-bar">
              <div className="pr-now">
                <strong className="pr-price">{formatCents(price)}</strong>
                <p className="pr-left">{game.phase === "play" ? minuteLeft(game.tick, game.speed) : "9:30–10:00"}</p>
                <p className="pr-day">
                  {prettyDate(session.day.date)}
                  <span>
                    Day {game.day + 1} of {game.batchDaysTotal}
                    {asOf ? ` · ${asOf}` : ""}
                  </span>
                  <span>9:30–10:00{prior !== null ? ` · Prior ${formatCents(prior)}` : ""}</span>
                </p>
              </div>
              <strong className={today >= 0 ? "up" : "down"}>
                {dollars(value - game.dayStartEquity)} {pct(today)}
              </strong>
              {game.phase === "play" ? (
                <button type="button" className="pr-play" onClick={() => setGame({ ...game, playing: !game.playing })}>
                  {game.playing ? "Pause" : "Play"}
                </button>
              ) : null}
            </div>
            {game.phase === "play" ? (
              <DayPicker days={BOOK.days} played={played} value={game.batchStart + game.day} disabled={dayStarted(game)} onPick={pickDay} />
            ) : null}
            {game.phase === "play" ? (
            <div className="pr-toggle" role="group" aria-label="Timeframe">
              {FRAMES.map((frame) => (
                <button key={frame} type="button" aria-pressed={game.timeframe === frame} onClick={() => setGame({ ...game, timeframe: frame })}>
                  {frame}
                </button>
              ))}
            </div>
            ) : null}
            {game.phase === "play" ? (
              <div ref={stageRef} className={full ? "pr-full" : chartH ? "pr-stage pr-stage-set" : "pr-stage"} style={!full && chartH ? { height: chartH } : undefined}>
                <PracticeChart
                  ref={chartRef}
                  candles={candles as ChartCandle[]}
                  markers={marks}
                  theme={theme}
                  priorClose={prior}
                  seriesId={`${game.ticker}-${game.timeframe}`}
                />
                <div className="pr-chart-tools">
                  <button type="button" aria-label="Zoom in" onClick={() => chartRef.current?.zoom(0.75)}>
                    +
                  </button>
                  <button type="button" aria-label="Zoom out" onClick={() => chartRef.current?.zoom(1.35)}>
                    −
                  </button>
                  <button type="button" onClick={() => chartRef.current?.auto()}>
                    Auto
                  </button>
                  <button type="button" onClick={() => setFull((value) => !value)}>
                    {full ? "Close" : "Full"}
                  </button>
                </div>
                {!full ? (
                  <div
                    className="pr-resize"
                    role="separator"
                    aria-label="Resize chart"
                    onPointerDown={(event) => {
                      const stage = stageRef.current;
                      if (!stage) return;
                      const startY = event.clientY;
                      const startH = stage.getBoundingClientRect().height;
                      const target = event.currentTarget;
                      target.setPointerCapture(event.pointerId);
                      const move = (pointer: PointerEvent) => {
                        const next = Math.min(Math.max(220, startH + pointer.clientY - startY), window.innerHeight * 0.92);
                        stage.style.height = `${next}px`;
                      };
                      const up = (pointer: PointerEvent) => {
                        target.releasePointerCapture(pointer.pointerId);
                        target.removeEventListener("pointermove", move);
                        const next = Math.round(stage.getBoundingClientRect().height);
                        setChartH(next);
                        try {
                          localStorage.setItem(CHART_KEY, String(next));
                        } catch {
                          /* ignore */
                        }
                      };
                      target.addEventListener("pointermove", move);
                      target.addEventListener("pointerup", up, { once: true });
                    }}
                  />
                ) : (
                  <div className="pr-fullbar">
                    <div className="pr-toggle pr-ticker" role="group" aria-label="Ticker">
                      {(["TQQQ", "SQQQ"] as Ticker[]).map((symbol) => (
                        <button key={symbol} type="button" aria-pressed={game.ticker === symbol} onClick={() => setGame({ ...game, ticker: symbol })}>
                          {symbol}
                        </button>
                      ))}
                    </div>
                    <p className="pr-book">
                      TQQQ {formatCents(quote.TQQQ)} · {game.positions.TQQQ.shares} sh | SQQQ {formatCents(quote.SQQQ)} · {game.positions.SQQQ.shares} sh
                    </p>
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
                          <button key={fraction} type="button" className="pr-sell" disabled={position.shares <= 0} onClick={() => act("sell", fraction)}>
                            Sell {fraction * 100}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            {game.phase === "play" && !full ? (
              <>
                <div className="pr-trade">
                <div className="pr-toggle pr-ticker" role="group" aria-label="Ticker">
                  {(["TQQQ", "SQQQ"] as Ticker[]).map((symbol) => (
                    <button key={symbol} type="button" aria-pressed={game.ticker === symbol} onClick={() => setGame({ ...game, ticker: symbol })}>
                      {symbol}
                    </button>
                  ))}
                </div>
                <p className="pr-book">
                  TQQQ {formatCents(quote.TQQQ)} · {game.positions.TQQQ.shares} sh | SQQQ {formatCents(quote.SQQQ)} · {game.positions.SQQQ.shares} sh
                </p>
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
                      <button key={fraction} type="button" className="pr-sell" disabled={position.shares <= 0} onClick={() => act("sell", fraction)}>
                        Sell {fraction * 100}%
                      </button>
                    ))}
                  </div>
                </div>
                </div>
                <div className="pr-dock">
                  {SPEEDS.map((speed) => (
                    <button key={speed} type="button" className="text-btn" aria-pressed={game.speed === speed} onClick={() => chooseSpeed(speed)}>
                      {speed}x
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      clockRef.current = { at: Date.now(), applied: 0 };
                      setGame((current) => (current ? run(current, stepMinute) : current));
                    }}
                  >
                    Step
                  </button>
                  <button type="button" className="text-btn" onClick={askNew}>
                    New game
                  </button>
                </div>
                <p className="pr-note">1x is real time. One minute on the chart takes one minute.</p>
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
              </>
            ) : null}
            {game.phase === "day" ? (
              <DayReview
                game={game}
                canNext={hasNextSession(game)}
                played={played}
                onPick={pickDay}
                onNext={() => setGame((current) => (current ? nextDay(current, BOOK.days.length) : current))}
                onReview={() => setGame((current) => (current ? openBatchReview(current) : current))}
              />
            ) : null}
            {game.phase === "batch" ? (
              <BatchReview
                game={game}
                canNext={hasNextSession(game)}
                played={played}
                onPick={pickDay}
                onNext={() => setGame((current) => (current ? nextDay(current, BOOK.days.length) : current))}
                onReset={askNew}
              />
            ) : null}
            <p className="chart-note">
              {BOOK.source}. Snapshot {BOOK.fetchedAt.slice(0, 10)}. Each day is 9:30–10:00 AM ET. The wiggle inside each 5-minute bar is randomized; the bar’s open, high, low, and close are real.
            </p>
            <p className="pr-stamp">
              Build {process.env.NEXT_PUBLIC_COMMIT_SHA || "local"} · {process.env.NEXT_PUBLIC_BUILD_TIME || "dev"} ·{" "}
              <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
                Charts by TradingView
              </a>
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
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

function DayPicker({
  days,
  played,
  value,
  disabled,
  onPick,
}: {
  days: { date: string }[];
  played: Set<string>;
  value: number;
  disabled: boolean;
  onPick: (index: number) => void;
}) {
  return (
    <label className="pr-picker">
      <span>{disabled ? "Today’s session" : "Choose a day"}</span>
      <select aria-label="Choose a day" value={value} disabled={disabled} onChange={(event) => onPick(Number(event.target.value))}>
        {days.map((day, index) => (
          <option key={day.date} value={index}>
            {prettyDate(day.date)}
            {played.has(day.date) ? " · played" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

function DayReview({
  game,
  canNext,
  played,
  onPick,
  onNext,
  onReview,
}: {
  game: GameState;
  canNext: boolean;
  played: Set<string>;
  onPick: (index: number) => void;
  onNext: () => void;
  onReview: () => void;
}) {
  const last = game.batchDays[game.batchDays.length - 1];
  const finishesBatch = game.day + 1 >= game.batchDaysTotal;
  return (
    <section className="pr-review">
      <h2>{prettyDate(last.date)}</h2>
      <p className="pr-lead">
        Day {game.day + 1} of {game.batchDaysTotal} · {dollars(last.dollars)} · {pct(last.pct)}
      </p>
      <p className="pr-note">Sold flat at 10:00. Fees {formatCents(last.fees)}. This result is the 9:30–10:00 window.</p>
      <DayPicker days={BOOK.days} played={played} value={game.batchStart + game.day} disabled={false} onPick={onPick} />
      <button type="button" className="pr-next" onClick={onNext} disabled={!canNext}>
        Next day
      </button>
      {finishesBatch ? (
        <button type="button" className="text-btn pr-review-link" onClick={onReview}>
          Batch review
        </button>
      ) : null}
    </section>
  );
}

function BatchReview({
  game,
  canNext,
  played,
  onPick,
  onNext,
  onReset,
}: {
  game: GameState;
  canNext: boolean;
  played: Set<string>;
  onPick: (index: number) => void;
  onNext: () => void;
  onReset: () => void;
}) {
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
      <p className="pr-note">Hold TQQQ buys the 9:30 open and sells at 10:00 each day.</p>
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
      <DayPicker
        days={BOOK.days}
        played={played}
        value={Math.min(BOOK.days.length - 1, game.batchStart + game.batchDaysTotal)}
        disabled={false}
        onPick={onPick}
      />
      <button type="button" className="pr-next" onClick={onNext} disabled={!canNext}>
        Next day
      </button>
      <div className="pr-actions">
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
