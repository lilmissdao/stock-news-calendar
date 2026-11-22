import assert from "node:assert/strict";
import { drawSession, emptyCycle, freshLeft, uniformIndex } from "./practice-cycle";
import { fastForward, holdTqqqValue, minuteLeft, newGame, nextDay, openBatchReview, skipDay, ticksDue, trade, type GameState, restartDay } from "./practice-engine";
import { deleteAllHistory, deleteGame, emptyHistory, type ArchivedGame } from "./practice-history";
import market from "../data/practice-market.json";
import { buildSession, candleInView, chartBars, clock, minuteSeed, priceWindow, seriesNeedsReset, SESSION_MINUTES, sharedTape, subpath, SUBTICKS, type Timeframe } from "./practice-path";
import { mergePracticeDays, type PracticeDay, type PracticeMarket } from "./practice-market";
import { buyShares, catFee, fillDelayMs, secFee, sellFees, sellShares, slipPerShare, slippedPrice, tafFee } from "./practice-trade";
import { rowSlippage } from "./practice-history";

const price = 50;

function fresh() {
  return { ...newGame(10, () => 0.2), ticker: "TQQQ" as const };
}

function resetReplaysTheDay() {
  const start = fresh();
  let game = trade(start, "TQQQ", "buy", 0.5, price, "", 0.01, price);
  game = trade(game, "TQQQ", "sell", 1, price - 0.3, "2026-11-18", 0.01, price - 0.3);
  game = { ...game, cursor: 12, tick: 40 };
  assert.ok(game.cash < start.cash && game.batchTrades.length > 0 && game.batchFees > 0);
  const again = restartDay(game);
  assert.equal(again.cash, start.dayStartEquity, "cash is back to where the day started");
  assert.equal(again.positions.TQQQ.shares, 0);
  assert.equal(again.cursor, 0);
  assert.equal(again.tick, 0);
  assert.equal(again.session, game.session, "same session");
  assert.equal(again.fills.length, 0);
  assert.equal(again.batchTrades.length, 0, "today's closed trades are dropped");
  assert.equal(again.batchFees, 0);
  assert.equal(again.batchSlippage, 0);
  // A game saved before Reset existed has no day-start marker; today's trades are still found from today's sells.
  const older = { ...game, dayTradesFrom: undefined };
  assert.equal(restartDay(older).batchTrades.length, 0);
}

function buyThenSellAll() {
  let game = trade(fresh(), "TQQQ", "buy", 0.25, price);
  const bought = game.positions.TQQQ.shares;
  assert.ok(bought > 0, "buy 25% gets shares");
  assert.ok(game.cash < 31000, "cash was spent");
  game = trade(game, "TQQQ", "sell", 1, price);
  assert.equal(game.positions.TQQQ.shares, 0, "sell 100% closes every share");
  assert.equal(game.positions.SQQQ.shares, 0);
  // Every fill remembers where TQQQ was on the chart, so a SQQQ entry line can be drawn at that spot.
  const sqqq = trade(fresh(), "SQQQ", "buy", 0.5, 40.12, "", 0.01, 65.99);
  assert.equal(sqqq.fills[0].tqqqAt, 65.99);
  assert.equal(sqqq.fills[0].ticker, "SQQQ");
}

function partialSellsThenAll() {
  let game = trade(fresh(), "TQQQ", "buy", 0.5, price);
  const start = game.positions.TQQQ.shares;
  assert.ok(start >= 4, "buy 50% is large enough to split");
  const first = sellShares(start, price, 0.25).shares;
  assert.equal(first, Math.max(1, Math.floor(start * 0.25)));
  game = trade(game, "TQQQ", "sell", 0.25, price);
  assert.equal(game.positions.TQQQ.shares, start - first);
  const mid = game.positions.TQQQ.shares;
  const second = sellShares(mid, price, 0.25).shares;
  game = trade(game, "TQQQ", "sell", 0.25, price);
  assert.equal(game.positions.TQQQ.shares, mid - second);
  assert.ok(game.positions.TQQQ.shares > 0, "two 25% sells leave a position");
  game = trade(game, "TQQQ", "sell", 1, price);
  assert.equal(game.positions.TQQQ.shares, 0, "final 100% sell is flat");
}

function sellWithNoCash() {
  let game = trade(fresh(), "TQQQ", "buy", 1, price);
  assert.ok(game.cash < price, "almost no cash left");
  const held = game.positions.TQQQ.shares;
  game = trade({ ...game, cash: 0 }, "TQQQ", "sell", 1, price);
  assert.equal(game.positions.TQQQ.shares, 0, "a zero cash balance does not block the sell");
  assert.ok(game.cash > 0, "proceeds come back");
  assert.equal(sellShares(held, price, 1).shares, held);
  assert.equal(sellShares(3, price, 0.25).shares, 1, "25% of a tiny lot still sells 1 share");
}

function switchTickerThenSell() {
  let game = trade(fresh(), "TQQQ", "buy", 0.25, price);
  const held = game.positions.TQQQ.shares;
  const cursor = game.cursor;
  const tick = game.tick;
  game = { ...game, ticker: "SQQQ" };
  game = trade(game, "SQQQ", "buy", 0.25, 20);
  assert.equal(game.positions.TQQQ.shares, held, "SQQQ buy leaves the TQQQ lot alone");
  game = { ...game, ticker: "TQQQ" };
  assert.equal(game.cursor, cursor);
  assert.equal(game.tick, tick);
  game = trade(game, game.ticker, "sell", 1, price);
  assert.equal(game.positions.TQQQ.shares, 0, "sell 100% after switching back");
  assert.ok(game.positions.SQQQ.shares > 0, "the SQQQ lot is still there");
}

function tapeMovesAndMirrors() {
  const tqqq = { t: 0, o: 50, h: 51.2, l: 49.4, c: 50.6 };
  // An inverse bar: TQQQ closes up, so SQQQ closes down from near its high.
  const sqqq = { t: 0, o: 18.65, h: 18.8, l: 17.4, c: 17.9 };
  const up = subpath(tqqq, 11, 1);
  const down = subpath(sqqq, 11, -1);
  const shape = sharedTape(11);
  assert.equal(up[0], tqqq.o);
  assert.equal(up[up.length - 1], tqqq.c);
  assert.equal(down[0], sqqq.o);
  assert.equal(down[down.length - 1], sqqq.c);
  assert.equal(up[shape.hi], tqqq.h);
  assert.equal(up[shape.lo], tqqq.l);
  assert.equal(down[shape.hi], sqqq.l, "SQQQ mirrors the shared high");
  assert.equal(down[shape.lo], sqqq.h, "SQQQ mirrors the shared low");
  const cents = up.map((value) => Math.round(value * 100));
  let changes = 0;
  for (let i = 1; i < cents.length; i += 1) if (cents[i] !== cents[i - 1]) changes += 1;
  assert.ok(changes >= 40, `tape should keep ticking, changed ${changes} times`);
}

function clockAndCatchUp() {
  assert.equal(minuteLeft(SUBTICKS * 0.3, 1), "0:42 left in this minute");
  assert.equal(minuteLeft(0, 1), "1:00 left in this minute");
  assert.equal(ticksDue(5000, 1), 40, "1x is eight evenly spaced ticks a second");
  assert.equal(ticksDue(0, 1), 0);
  const game = fresh();
  const bars = Array.from({ length: 30 }, (_, index) => ({ t: index * 60, o: 10, h: 11, l: 9, c: 10.5 }));
  const next = fastForward(game, ticksDue(5000, 1), bars, bars, "2026-11-18", 31000);
  assert.equal(next.cursor, 0);
  assert.equal(next.tick, 40);
  assert.equal(next.phase, "play");
}

function historyDeleteLeavesTheRest() {
  const games: ArchivedGame[] = [1, 2, 3].map((number) => ({
    id: `g${number}`,
    number,
    playedAt: "2026-11-18T15:00:00.000Z",
    endedAt: "2026-11-18T16:00:00.000Z",
    batches: [],
    endingBalance: 31000,
    startBalance: 31000,
  }));
  const history = { ...emptyHistory(), games };
  const left = deleteGame(history, "g2");
  assert.deepEqual(left.games.map((game) => game.id), ["g1", "g3"]);
  assert.equal(deleteAllHistory().games.length, 0);
}

function switchKeepsTheLiveCandle() {
  const book = market as PracticeMarket;
  const session = buildSession(book.days[4], 99);
  const tqqq = session.TQQQ.slice(0, 30);
  const sqqq = session.SQQQ.slice(0, 30);
  const frames: Timeframe[] = ["1m", "5m", "15m", "30m", "1D"];
  const spots = [
    { cursor: 0, tick: 0 },
    { cursor: 0, tick: 10 },
    { cursor: 6, tick: 3 },
    { cursor: 12, tick: 40 },
    { cursor: 29, tick: 15 },
  ];
  for (const frame of frames) {
    for (const spot of spots) {
      const up = chartBars(tqqq, spot.cursor, spot.tick, 99, 1, frame);
      const down = chartBars(sqqq, spot.cursor, spot.tick, 99, -1, frame);
      for (const [bars, minutes, sign] of [
        [up, tqqq, 1],
        [down, sqqq, -1],
      ] as const) {
        assert.ok(bars.length >= 1, `${frame} ${spot.cursor}:${spot.tick} missing the live candle`);
        for (let i = 1; i < bars.length; i += 1) assert.ok(bars[i].t > bars[i - 1].t, "candle times must increase");
        const last = bars[bars.length - 1];
        const path = subpath(minutes[spot.cursor], minuteSeed(99, spot.cursor), sign);
        assert.equal(last.c, path[spot.tick], `${frame} live close`);
        assert.ok(last.h >= Math.max(last.o, last.c) - 1e-9);
        assert.ok(last.l <= Math.min(last.o, last.c) + 1e-9);
        assert.ok([last.o, last.h, last.l, last.c].every((value) => Number.isFinite(value)));
      }
      assert.equal(up[up.length - 1].t, down[down.length - 1].t);
      assert.equal(seriesNeedsReset(`TQQQ-${frame}`, `SQQQ-${frame}`, up, down), true);
    }
  }
  const before = chartBars(tqqq, 0, 10, 99, 1, "1m");
  const after = chartBars(tqqq, 0, 11, 99, 1, "1m");
  assert.equal(seriesNeedsReset("TQQQ-1m", "TQQQ-1m", before, after), false, "the same ticker keeps updating the live candle");
}

function scaleStaysOnTheTicker() {
  const book = market as PracticeMarket;
  const session = buildSession(book.days[4], 99);
  const sqqq = session.SQQQ.slice(0, 30);
  const frames: Timeframe[] = ["1m", "5m", "15m", "30m", "1D"];
  for (const frame of frames) {
    const bars = chartBars(sqqq, 8, 12, 99, -1, frame);
    const last = bars[bars.length - 1];
    const range = priceWindow(bars, 82);
    assert.ok(range, frame);
    const time = { from: -0.5, to: bars.length - 1 + 1.5 };
    assert.equal(candleInView(range, time, last, bars.length - 1), true, `${frame} live candle outside the view`);
    assert.ok(82 > range.to, `${frame} still includes the other ticker at ${range.to}`);
    assert.ok((range.from + range.to) / 2 < last.c * 1.2, `${frame} scale center drifted`);
  }
}

function regulatoryFeesOnly() {
  assert.equal(secFee(500), 0);
  assert.equal(secFee(500.01), 0.02);
  assert.equal(secFee(1_000_000), 20.6);
  assert.equal(catFee(1), 0.01);
  assert.equal(catFee(3333), 0.01);
  assert.equal(catFee(3334), 0.02);
  assert.equal(tafFee(50, "2026-09-01"), 0);
  assert.equal(tafFee(51, "2026-09-01"), 0.01);
  assert.equal(tafFee(100, "2026-09-30"), 0.02);
  assert.equal(tafFee(100, "2026-10-01"), 0);
  assert.equal(tafFee(100, "2026-12-31"), 0);
  assert.equal(tafFee(100, "2027-01-01"), 0.02);
  assert.equal(tafFee(100_000, "2026-09-01"), 9.79);
  const bought = buyShares(31_000, 50, 1);
  assert.equal(bought.shares, 620);
  assert.equal(bought.fee, 0);
  assert.equal(bought.cash, 0);
  const paused = "2026-11-18";
  const charged = "2026-09-15";
  assert.equal(sellFees(620, 50, paused), 0.65);
  assert.equal(sellFees(620, 50, charged), 0.78);
  assert.equal(sellShares(10, 40, 1, charged).fee, 0.01);
  let game = trade(fresh(), "TQQQ", "buy", 1, 50, charged);
  assert.equal(game.dayFees, 0);
  game = trade(game, "TQQQ", "sell", 1, 50, charged);
  assert.equal(game.positions.TQQQ.shares, 0);
  assert.equal(game.dayFees, 0.78);
  assert.equal(game.cash, 31_000 - 0.78);
  const held = holdTqqqValue(31_000, 50, 55, paused);
  assert.equal(held, 31_000 - 620 * 50 + 620 * 55 - sellFees(620, 55, paused));
}

function flatBars() {
  return Array.from({ length: 30 }, (_, index) => ({ t: index * 60, o: 50, h: 51, l: 49, c: 50 }));
}

function playDay(game: GameState, date: string) {
  return fastForward(game, (SESSION_MINUTES + 1) * (SUBTICKS + 1), flatBars(), flatBars(), date, 31_000);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return (value ^ (value >>> 14)) >>> 0;
  };
}

function realMinutesAreUsedAsIs() {
  const book = market as PracticeMarket;
  for (const day of book.days) {
    assert.equal(day.tqqq.length, 30, `${day.date} has thirty real 1-minute bars`);
    const session = buildSession(day, 1);
    session.TQQQ.forEach((bar, index) => {
      assert.equal(bar.c, day.tqqq[index][3], `${day.date} ${index} TQQQ close is the real close`);
      assert.equal(bar.t, day.start + index * 60);
      assert.equal(bar.o, index === 0 ? day.tqqq[0][0] : session.TQQQ[index - 1].c, "each candle opens at the previous close");
    });
    session.SQQQ.forEach((bar, index) => assert.equal(bar.c, day.sqqq[index][3], `${day.date} ${index} SQQQ close is the real close`));
  }
}

function shuffleUsesEveryDayBeforeRepeating() {
  const book = market as PracticeMarket;
  const total = book.days.length;
  assert.ok(total >= 20, `the book holds the real 1-minute sessions Yahoo keeps, ${total}`);
  const dates = book.days.map((day) => day.date);
  const history = dates.slice(0, 10);
  let cycle = emptyCycle();
  const next = mulberry32(99);
  const dealt: string[] = [];
  for (let step = 0; step < dates.length - history.length; step += 1) {
    const draw = drawSession(dates, history, cycle, "", next);
    assert.equal(history.includes(draw.date) || dealt.includes(draw.date), false);
    dealt.push(draw.date);
    cycle = draw.cycle;
    assert.equal(freshLeft(dates, history, cycle, draw.date), dates.length - history.length - dealt.length + 1);
  }
  assert.equal(new Set([...history, ...dealt]).size, total);
  const again = drawSession(dates, history, cycle, dealt[dealt.length - 1], next);
  assert.equal(again.cycle.generation, 1);
  assert.notEqual(again.date, dealt[dealt.length - 1]);
  assert.equal(again.cycle.dates.length, 1);
  assert.equal(freshLeft(dates, history, again.cycle, again.date), total);
  const counts = Array.from({ length: 60 }, () => 0);
  const roll = mulberry32(3);
  for (let sample = 0; sample < 12000; sample += 1) counts[uniformIndex(60, roll)] += 1;
  assert.ok(Math.min(...counts) > 120, `shuffle missed an end: ${counts[0]} … ${counts[59]}`);
  const older: PracticeDay[] = [{ date: "2020-01-02", start: 1, tqqq: [], sqqq: [] }];
  const newer: PracticeDay[] = [
    { date: "2020-01-03", start: 2, tqqq: [], sqqq: [] },
    { date: "2020-01-02", start: 9, tqqq: [], sqqq: [] },
  ];
  const merged = mergePracticeDays(older, newer);
  assert.deepEqual(merged.map((day) => [day.date, day.start]), [["2020-01-02", 9], ["2020-01-03", 2]]);
}

function dealtSessionAdvancesTheBatch() {
  const book = market as PracticeMarket;
  const count = book.days.length;
  let game = newGame(count, () => 0, 1, 3);
  assert.equal(game.session, 3);
  assert.equal(game.batchDaysTotal, 5);
  const seen = [3];
  for (let day = 0; day < 4; day += 1) {
    game = playDay(game, book.days[game.session].date);
    game = nextDay(game, count, 4 + day);
    assert.equal(game.phase, "play");
    assert.equal(game.day, day + 1);
    seen.push(game.session);
  }
  assert.deepEqual(seen, [3, 4, 5, 6, 7]);
  game = playDay(game, book.days[game.session].date);
  const reviewed = openBatchReview(game);
  assert.equal(reviewed.history.batches[0].days.map((day) => day.date).join(), seen.map((index) => book.days[index].date).join());
  const continued = nextDay(game, count, 8);
  assert.equal(continued.phase, "play");
  assert.equal(continued.day, 0);
  assert.equal(continued.session, 8);
  assert.equal(continued.history.batches.length, 1);
  assert.equal(continued.cash, 31_000);
  const label = clock(book.days[0].start);
  assert.match(label, /\d{1,2}:\d{2}/);
  assert.equal(/\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(label), false);
}

function skipUntouchedDayDoesNotScore() {
  const bars = flatBars();
  let game: GameState = { ...fresh(), cursor: 4, tick: 10 };
  const cash = game.cash;
  const day = game.day;
  game = skipDay(game, 10, 4, bars, bars, "2026-09-01", 31_000);
  assert.equal(game.phase, "play");
  assert.equal(game.day, day);
  assert.equal(game.session, 4);
  assert.equal(game.batchDays.length, 0);
  assert.equal(game.cash, cash);
  assert.equal(game.cursor, 0);
}

function skipSellsAndCountsTheDay() {
  const bars = flatBars();
  let game = trade(fresh(), "TQQQ", "buy", 0.25, 50, "2026-09-01");
  assert.ok(game.positions.TQQQ.shares > 0);
  game = skipDay(game, 10, 6, bars, bars, "2026-09-01", 31_000);
  assert.equal(game.positions.TQQQ.shares, 0);
  assert.equal(game.batchDays.length, 1);
  assert.equal(game.batchDays[0].date, "2026-09-01");
  assert.ok(game.batchDays[0].fees > 0);
  assert.equal(game.day, 1);
  assert.equal(game.session, 6);
  assert.equal(game.phase, "play");
}

function skipAfterARoundTripStillCounts() {
  const bars = flatBars();
  let game = trade(fresh(), "TQQQ", "buy", 1, 50, "2026-09-15");
  game = trade(game, "TQQQ", "sell", 1, 50, "2026-09-15");
  assert.equal(game.positions.TQQQ.shares, 0);
  game = skipDay(game, 10, 2, bars, bars, "2026-09-15", 31_000);
  assert.equal(game.batchDays.length, 1);
  assert.equal(game.day, 1);
  assert.equal(game.phase, "play");
}

function skipAfterTheCloseDoesNotDoubleCount() {
  const bars = flatBars();
  let game = playDay(fresh(), "2026-09-01");
  assert.equal(game.phase, "day");
  assert.equal(game.batchDays.length, 1);
  game = skipDay(game, 10, 3, bars, bars, "2026-09-01", 31_000);
  assert.equal(game.batchDays.length, 1);
  assert.equal(game.day, 1);
  assert.equal(game.session, 3);
  assert.equal(game.phase, "play");
}

function realisticFillMath() {
  assert.equal(slipPerShare(0, () => 0), 0.01);
  assert.equal(slipPerShare(4, () => 0.999), 0.02);
  assert.equal(slipPerShare(5, () => 0), 0);
  assert.equal(slipPerShare(14, () => 0.999), 0.01);
  assert.equal(slipPerShare(15, () => 0), 0);
  assert.equal(slipPerShare(29, () => 0.999), 0.01);
  assert.equal(slippedPrice(50, "buy", 0.04), 50.04);
  assert.equal(slippedPrice(50, "sell", 0.04), 49.96);
  assert.equal(fillDelayMs(() => 0), 500);
  assert.equal(fillDelayMs(() => 1), 1200);
  let game = trade(fresh(), "TQQQ", "buy", 0.25, 50.04, "2026-09-01", 0.04);
  assert.equal(game.dayFees, 0);
  assert.equal(game.daySlippage, game.positions.TQQQ.shares * 0.04);
  assert.equal(game.fills[0].side, "buy");
  game = trade(game, "TQQQ", "sell", 1, 49.96, "2026-09-01", 0.04);
  assert.ok(game.dayFees > 0);
  assert.ok(game.daySlippage > game.fills[0].slippage);
  assert.equal(rowSlippage([{ fees: 1, days: [{ slippage: 0.2 }] } as never, { fees: 1 } as never]), null);
  assert.equal(rowSlippage([{ slippage: 0.2 } as never, { slippage: 0.3 } as never]), 0.5);
}

regulatoryFeesOnly();
realMinutesAreUsedAsIs();
shuffleUsesEveryDayBeforeRepeating();
dealtSessionAdvancesTheBatch();
buyThenSellAll();
resetReplaysTheDay();
partialSellsThenAll();
sellWithNoCash();
switchTickerThenSell();
tapeMovesAndMirrors();
switchKeepsTheLiveCandle();
scaleStaysOnTheTicker();
clockAndCatchUp();
historyDeleteLeavesTheRest();
console.log("practice behavior ok");
