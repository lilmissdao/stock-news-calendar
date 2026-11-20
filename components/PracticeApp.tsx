"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import market from "@/data/practice-market.json";
import { PracticeChart, type ChartCandle, type CostLine, type PracticeChartHandle } from "@/components/PracticeChart";
import { PracticeHistory } from "@/components/PracticeHistory";
import {
  equityNow,
  fastForward,
  liveQuote,
  loadGame,
  minuteLeft,
  newGame,
  nextDay,
  openBatchReview,
  sharesHeld,
  skipDay,
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
import { CYCLE_KEY, drawSession, freshLeft, parseCycle, type CycleFile } from "@/lib/practice-cycle";
import type { PracticeMarket } from "@/lib/practice-market";
import { avgCostLabel, chartBars, clock, SESSION_MINUTES, SUBTICKS, buildSession, type Timeframe } from "@/lib/practice-path";
import { formatCents, formatWholeDollars } from "@/lib/simulator";
import { fillDelayMs, slipPerShare, slippedPrice, type FillNote, type Ticker } from "@/lib/practice-trade";

const REALISTIC_KEY = "snc-practice-realistic";
const STORAGE_KEY = "snc-practice:v1";
const CHART_KEY = "snc-practice-chart-h";
const BOOK = market as PracticeMarket;
const SESSION_DATES = BOOK.days.map((day) => day.date);
const FRAMES: Timeframe[] = ["1m", "5m", "15m", "30m", "1D"];

function pct(value: number): string {
  const text = `${Math.abs(value * 100).toFixed(2)}%`;
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

function dollars(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.5) {
    const cents = formatCents(Math.abs(value));
    return value > 0 ? `+${cents}` : `-${cents}`;
  }
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

function dayStarted(state: GameState): boolean {
  const open = state.positions.TQQQ.shares + state.positions.SQQQ.shares > 0;
  return state.cursor > 0 || state.tick > 0 || state.markers.length > 0 || state.dayFees > 0 || open;
}

function sessionWindow(day: (typeof BOOK.days)[number]): { open: number; close: number; date: string } {
  const closeBar = day.tqqq[5] ?? day.tqqq[day.tqqq.length - 1];
  return { open: day.tqqq[0][0], close: closeBar[3], date: day.date };
}

function bookDay(state: GameState) {
  return BOOK.days[state.session] ?? BOOK.days[Math.max(0, Math.min(BOOK.days.length - 1, state.batchStart))];
}

function deal(historyDates: string[], cycle: CycleFile, avoid = ""): { index: number; cycle: CycleFile } {
  const draw = drawSession(SESSION_DATES, historyDates, cycle, avoid);
  const index = SESSION_DATES.indexOf(draw.date);
  return { index: index < 0 ? 0 : index, cycle: draw.cycle };
}

function holdSoFar(state: GameState): number {
  const dates = state.batchDays.map((day) => day.date);
  const current = bookDay(state)?.date;
  if (current && !dates.includes(current)) dates.push(current);
  return holdForDates(state.batchStartEquity, dates);
}

function holdForDates(startEquity: number, dates: string[]): number {
  const windows = dates.flatMap((date) => {
    const day = BOOK.days.find((item) => item.date === date);
    return day ? [sessionWindow(day)] : [];
  });
  return sessionHoldValue(startEquity, windows);
}

function pendingDates(state: GameState): string[] {
  const dates = state.batchDays.map((day) => day.date);
  if (state.phase === "play" && dayStarted(state)) {
    const date = bookDay(state)?.date;
    if (date) dates.push(date);
  }
  return dates;
}

function run(state: GameState, step: typeof tickForward): GameState {
  const day = bookDay(state);
  const paths = buildSession(day, state.seeds[state.day] || 1);
  return step(state, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES), day.date, holdSoFar(state));
}

function runForward(state: GameState, steps: number): GameState {
  const day = bookDay(state);
  const paths = buildSession(day, state.seeds[state.day] || 1);
  return fastForward(state, steps, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES), day.date, holdSoFar(state));
}

function applyFill(state: GameState, side: "buy" | "sell", fraction: number, ticker: Ticker, slip: number): GameState {
  if (state.phase !== "play") return state;
  const day = bookDay(state);
  const paths = buildSession(day, state.seeds[state.day] || 1);
  const live = liveQuote(state, paths.TQQQ.slice(0, SESSION_MINUTES), paths.SQQQ.slice(0, SESSION_MINUTES));
  const quote = live[ticker];
  const price = slip > 0 ? slippedPrice(quote, side, slip) : quote;
  const quotes = { TQQQ: ticker === "TQQQ" ? price : live.TQQQ, SQQQ: ticker === "SQQQ" ? price : live.SQQQ };
  return trade(state, ticker, side, fraction, price, day?.date ?? "", slip, quotes);
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
      const date = bookDay(game)?.date ?? "";
      days.push({
        date,
        dollars: ending - game.dayStartEquity,
        pct: game.dayStartEquity > 0 ? ending / game.dayStartEquity - 1 : 0,
        equity: ending,
        drawdown: game.dayDrawdown,
        fees: game.dayFees,
        slippage: game.daySlippage,
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
  const [skipAsk, setSkipAsk] = useState(false);
  const [realistic, setRealistic] = useState(true);
  const [filling, setFilling] = useState(false);
  const gameRef = useRef<GameState | null>(null);
  const realisticRef = useRef(true);
  const fillTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cycle, setCycle] = useState<CycleFile | null>(null);
  const [chartH, setChartH] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const chartRef = useRef<PracticeChartHandle>(null);
  gameRef.current = game;
  realisticRef.current = realistic;
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const speed = coerceSpeed(typeof localStorage !== "undefined" ? localStorage.getItem(SPEED_KEY) : 1);
    const savedFills = localStorage.getItem(REALISTIC_KEY);
    const realisticOn = savedFills !== "0";
    setRealistic(realisticOn);
    realisticRef.current = realisticOn;
    const savedHistory = parseHistory(localStorage.getItem(HISTORY_KEY));
    const loaded = loadGame(localStorage.getItem(STORAGE_KEY), BOOK.days.length);
    let nextCycle = parseCycle(localStorage.getItem(CYCLE_KEY));
    let game = loaded;
    if (!game) {
      const dealt = deal(playedDates(savedHistory, null), nextCycle);
      game = newGame(BOOK.days.length, Math.random, speed, dealt.index);
      nextCycle = dealt.cycle;
    } else {
      const current = BOOK.days[game.session]?.date;
      const seen = playedDates(savedHistory, game);
      if (current && !seen.includes(current) && !nextCycle.dates.includes(current)) {
        nextCycle = { ...nextCycle, dates: [...nextCycle.dates, current] };
      }
    }
    try {
      localStorage.setItem(CYCLE_KEY, JSON.stringify(nextCycle));
    } catch {
      /* Private mode can refuse storage. */
    }
    setCycle(nextCycle);
    setGame(game);
    rememberSpeed(game.speed);
    setHistory(savedHistory);
    const stored = localStorage.getItem("snc-theme");
    const initial = stored === "dark" || stored === "light" ? stored : document.documentElement.dataset.theme || "light";
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    const savedHeight = Number(localStorage.getItem(CHART_KEY));
    if (savedHeight >= 220 && savedHeight <= 1200) setChartH(savedHeight);
  }, []);

  useEffect(() => {
    return () => {
      if (fillTimer.current !== null) window.clearTimeout(fillTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!cycle) return;
    try {
      localStorage.setItem(CYCLE_KEY, JSON.stringify(cycle));
    } catch {
      /* Private mode can refuse storage. */
    }
  }, [cycle]);

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

  const pace = useRef({ playing: false, speed: 1 as Speed, phase: "play" as GameState["phase"] });
  const clockRef = useRef<{ at: number; applied: number; speed: Speed } | null>(null);
  pace.current = {
    playing: !!game?.playing,
    speed: game?.speed ?? 1,
    phase: game?.phase ?? "play",
  };
  useEffect(() => {
    let frame = 0;
    const pump = () => {
      const { playing, speed, phase } = pace.current;
      if (!playing || phase !== "play") {
        clockRef.current = null;
        return;
      }
      if (!clockRef.current || clockRef.current.speed !== speed) clockRef.current = { at: Date.now(), applied: 0, speed };
      const clock = clockRef.current;
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
    const timer = window.setInterval(pump, 200);
    const wake = () => pump();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, []);

  const pathKey = game ? `${game.session}:${game.day}:${game.seeds[game.day] ?? 0}` : "";
  const session = useMemo(() => {
    if (!game) return null;
    const day = BOOK.days[game.session];
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
  const candles = chartBars(session.TQQQ, game.cursor, game.tick, game.seeds[game.day] || 1, 1, game.timeframe);
  const costLines: CostLine[] = [];
  let sqqqNote: string | null = null;
  if (game.positions.TQQQ.shares > 0 && game.positions.TQQQ.avgCost > 0) {
    costLines.push({ key: "tqqq", price: game.positions.TQQQ.avgCost, title: avgCostLabel("tqqq", game.positions.TQQQ.avgCost) });
  }
  if (game.positions.SQQQ.shares > 0 && game.positions.SQQQ.avgCost > 0) {
    const title = avgCostLabel("sqqq", game.positions.SQQQ.avgCost);
    const guide = game.sqqqGuide;
    if (guide && guide.level !== null && Math.abs(guide.avg - game.positions.SQQQ.avgCost) < 1e-6) {
      costLines.push({ key: "sqqq", price: guide.level, title });
    } else {
      sqqqNote = title;
    }
  }
  const shown = session.TQQQ[Math.min(game.cursor, session.TQQQ.length - 1)];
  const asOf = shown ? clock(shown.t + (game.tick >= SUBTICKS ? 60 : 0)) : "";
  const prior = priorClose(game.session, "TQQQ");
  const rows = historyRows(game, history, value);
  const active = game;
  const tape = session;
  const saved = history;

  function clearFill() {
    if (fillTimer.current !== null) {
      window.clearTimeout(fillTimer.current);
      fillTimer.current = null;
    }
    setFilling(false);
  }

  function act(side: "buy" | "sell", fraction: number) {
    const snapshot = gameRef.current;
    if (!snapshot || snapshot.phase !== "play" || filling) return;
    const ticker = snapshot.ticker;
    if (!realisticRef.current) {
      setGame((state) => (state ? applyFill(state, side, fraction, ticker, 0) : state));
      return;
    }
    setFilling(true);
    fillTimer.current = window.setTimeout(() => {
      fillTimer.current = null;
      setFilling(false);
      setGame((state) => {
        if (!state || state.phase !== "play") return state;
        const slip = realisticRef.current ? slipPerShare(state.cursor) : 0;
        return applyFill(state, side, fraction, ticker, slip);
      });
    }, fillDelayMs());
  }

  function chooseSpeed(speed: Speed) {
    rememberSpeed(speed);
    setGame({ ...active, speed });
  }

  function askNew() {
    setGame((current) => (current ? { ...current, playing: false } : current));
    setSkipAsk(false);
    setConfirm(true);
  }

  function skipNow() {
    if (!active || !cycle) return;
    setSkipAsk(false);
    setFull(false);
    const dealt = deal(playedDates(saved, active), cycle, bookDay(active)?.date ?? "");
    setCycle(dealt.cycle);
    const day = bookDay(active);
    const paths = buildSession(day, active.seeds[active.day] || 1);
    setGame(
      skipDay(
        { ...active, playing: false },
        BOOK.days.length,
        dealt.index,
        paths.TQQQ.slice(0, SESSION_MINUTES),
        paths.SQQQ.slice(0, SESSION_MINUTES),
        day?.date ?? "",
        holdSoFar(active),
      ),
    );
  }

  function askSkip() {
    if (!active) return;
    clearFill();
    setGame((current) => (current ? { ...current, playing: false } : current));
    if (active.phase === "play" && sharesHeld(active) > 0) {
      setSkipAsk(true);
      return;
    }
    skipNow();
  }

  function goNext() {
    if (!active || !cycle) return;
    const dealt = deal(playedDates(saved, active), cycle, bookDay(active)?.date ?? "");
    setCycle(dealt.cycle);
    setGame(nextDay(active, BOOK.days.length, dealt.index));
  }

  function commitNew() {
    const ending = equityNow(active, tape.TQQQ, tape.SQQQ);
    const nextHistory = archiveCurrent(active, saved, ending, tape.day.date, holdForDates(active.batchStartEquity, pendingDates(active)));
    setHistory(nextHistory);
    const speed = coerceSpeed(localStorage.getItem(SPEED_KEY) ?? active.speed);
    const dealt = deal(playedDates(nextHistory, null), cycle ?? { v: 1, generation: 0, dates: [] }, tape.day.date);
    setCycle(dealt.cycle);
    setGame(newGame(BOOK.days.length, Math.random, speed, dealt.index));
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
                <strong className="pr-price">
                  {game.ticker} {formatCents(price)}
                </strong>
                <p className="pr-left">{game.phase === "play" ? minuteLeft(game.tick, game.speed) : "9:30–10:00"}</p>
                <p className="pr-day">
                  {game.phase === "play" ? `Day ${game.day + 1} of ${game.batchDaysTotal}` : prettyDate(session.day.date)}
                  <span>{game.phase === "play" ? asOf : `Day ${game.day + 1} of ${game.batchDaysTotal}${asOf ? ` · ${asOf}` : ""}`}</span>
                  <span>9:30–10:00{prior !== null ? ` · TQQQ prior ${formatCents(prior)}` : ""}</span>
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
            {game.phase === "play" || game.phase === "day" ? (
              <div className="pr-skiprow">
                <button type="button" className="pr-skip" onClick={askSkip}>
                  Skip day
                </button>
              </div>
            ) : null}
            {skipAsk ? (
              <section className="pr-confirm">
                <h2>Sell and skip this day?</h2>
                <p className="pr-lead">The open position sells at the current price.</p>
                <div className="pr-actions">
                  <button type="button" className="text-btn" onClick={() => setSkipAsk(false)}>
                    Keep playing
                  </button>
                  <button type="button" className="pr-skip" onClick={skipNow}>
                    Sell and skip
                  </button>
                </div>
              </section>
            ) : null}
            {cycle && game.phase === "play" && !dayStarted(game) ? (
              <p className="pr-fresh">Fresh days left: {freshLeft(SESSION_DATES, playedDates(history, game), cycle, session.day.date)} of {BOOK.days.length}</p>
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
                  costLines={costLines}
                  theme={theme}
                  priorClose={prior}
                  seriesId={game.timeframe}
                />
                <p className="pr-chart-label">Chart: TQQQ</p>
                {sqqqNote ? <p className="pr-sqqq-avg">{sqqqNote}</p> : null}
                {full ? (
                  <button type="button" className="pr-skip pr-fullskip" onClick={askSkip}>
                    Skip day
                  </button>
                ) : null}
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
                    <TradeCue ticker={game.ticker} tqqq={quote.TQQQ} sqqq={quote.SQQQ} tqqqShares={game.positions.TQQQ.shares} sqqqShares={game.positions.SQQQ.shares} />
                    {filling ? <p className="pr-note">Filling…</p> : null}
                    <OrderPad filling={filling} shares={position.shares} onAct={act} />
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
                <TradeCue ticker={game.ticker} tqqq={quote.TQQQ} sqqq={quote.SQQQ} tqqqShares={game.positions.TQQQ.shares} sqqqShares={game.positions.SQQQ.shares} />
                {filling ? <p className="pr-note">Filling…</p> : null}
                <OrderPad filling={filling} shares={position.shares} onAct={act} />
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
                      clockRef.current = { at: Date.now(), applied: 0, speed: game.speed };
                      setGame((current) => (current ? run(current, stepMinute) : current));
                    }}
                  >
                    Step
                  </button>
                  <button type="button" className="text-btn" onClick={askNew}>
                    New game
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    aria-pressed={realistic}
                    onClick={() => {
                      const next = !realistic;
                      realisticRef.current = next;
                      setRealistic(next);
                      try {
                        localStorage.setItem(REALISTIC_KEY, next ? "1" : "0");
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    Realistic fills
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
                  <Stat label="Slippage" value={formatCents(game.daySlippage)} />
                </dl>
                <TradeLog fills={game.fills ?? []} />
                {game.positions[other].shares > 0 ? (
                  <p className="pr-note">
                    Also holding {game.positions[other].shares} {other}
                  </p>
                ) : null}
              </>
            ) : null}
            {game.phase === "day" ? (
              <DayReview game={game} onNext={goNext} onReview={() => setGame((current) => (current ? openBatchReview(current) : current))} />
            ) : null}
            {game.phase === "batch" ? (
              <BatchReview game={game} onNext={goNext} onReset={askNew} />
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

function slippageText(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? formatCents(value) : "—";
}

function TradeCue({
  ticker,
  tqqq,
  sqqq,
  tqqqShares,
  sqqqShares,
}: {
  ticker: Ticker;
  tqqq: number;
  sqqq: number;
  tqqqShares: number;
  sqqqShares: number;
}) {
  const trading = ticker === "SQQQ" ? sqqq : tqqq;
  return (
    <>
      <p className="pr-which">
        Chart: TQQQ · Trading: {ticker}
      </p>
      <p className="pr-book">
        <strong>
          {ticker} {formatCents(trading)}
        </strong>
        {ticker === "TQQQ" ? <span> · SQQQ {formatCents(sqqq)}</span> : <span> · chart stays on TQQQ</span>}
        <span>
          {" "}
          · {tqqqShares} TQQQ sh | {sqqqShares} SQQQ sh
        </span>
      </p>
    </>
  );
}

function OrderPad({ filling, shares, onAct }: { filling: boolean; shares: number; onAct: (side: "buy" | "sell", fraction: number) => void }) {
  return (
    <div className="pr-pad">
      <div>
        {([0.25, 0.5, 0.75, 1] as const).map((fraction) => (
          <button key={fraction} type="button" className="pr-buy" disabled={filling} onClick={() => onAct("buy", fraction)}>
            {filling ? "Filling…" : `Buy ${fraction * 100}%`}
          </button>
        ))}
      </div>
      <div>
        {([0.25, 0.5, 0.75, 1] as const).map((fraction) => (
          <button key={fraction} type="button" className="pr-sell" disabled={filling || shares <= 0} onClick={() => onAct("sell", fraction)}>
            {filling ? "Filling…" : `Sell ${fraction * 100}%`}
          </button>
        ))}
      </div>
    </div>
  );
}

function TradeLog({ fills }: { fills: FillNote[] }) {
  if (fills.length === 0) return null;
  return (
    <ul className="pr-log" aria-label="Trade log">
      {fills.map((fill, index) => (
        <li key={`${fill.minute}-${fill.side}-${index}`}>
          {fill.side === "buy" ? "Buy" : "Sell"} {fill.shares} {fill.ticker} at {formatCents(fill.price)} · slippage {formatCents(fill.slippage)}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, tone = 0 }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone > 0 ? "up" : tone < 0 ? "down" : undefined}>{value}</dd>
    </div>
  );
}

function DayReview({ game, onNext, onReview }: { game: GameState; onNext: () => void; onReview: () => void }) {
  const last = game.batchDays[game.batchDays.length - 1];
  const finishesBatch = game.day + 1 >= game.batchDaysTotal;
  return (
    <section className="pr-review">
      <h2>{prettyDate(last.date)}</h2>
      <p className="pr-lead">
        Day {game.day + 1} of {game.batchDaysTotal} · {dollars(last.dollars)} · {pct(last.pct)}
      </p>
      <p className="pr-note">
        Sold flat at 10:00. Fees {formatCents(last.fees)}. Slippage {slippageText(last.slippage)}. This result is the 9:30–10:00 window.
      </p>
      <button type="button" className="pr-next" onClick={onNext}>
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
          <li key={`${day.date}-${index}`}>
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
        <Stat label="Slippage" value={slippageText(batch.slippage)} />
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
      <button type="button" className="pr-next" onClick={onNext}>
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
