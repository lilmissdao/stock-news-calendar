import assert from "node:assert/strict";
import { fastForward, minuteLeft, newGame, ticksDue, trade } from "./practice-engine";
import { deleteAllHistory, deleteGame, emptyHistory, type ArchivedGame } from "./practice-history";
import market from "../data/practice-market.json";
import { buildSession, chartBars, minuteSeed, seriesNeedsReset, sharedTape, subpath, type Timeframe } from "./practice-path";
import type { PracticeMarket } from "./practice-market";
import { sellShares } from "./practice-trade";

const price = 50;

function fresh() {
  return { ...newGame(10, () => 0.2), ticker: "TQQQ" as const };
}

function buyThenSellAll() {
  let game = trade(fresh(), "TQQQ", "buy", 0.25, price);
  const bought = game.positions.TQQQ.shares;
  assert.ok(bought > 0, "buy 25% gets shares");
  assert.ok(game.cash < 31000, "cash was spent");
  game = trade(game, "TQQQ", "sell", 1, price);
  assert.equal(game.positions.TQQQ.shares, 0, "sell 100% closes every share");
  assert.equal(game.positions.SQQQ.shares, 0);
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
  const sqqq = { t: 0, o: 18, h: 18.8, l: 17.4, c: 17.9 };
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
  assert.ok(changes >= 40, `tape should tick almost every second, changed ${changes} times`);
}

function clockAndCatchUp() {
  assert.equal(minuteLeft(18, 1), "0:42 left in this minute");
  assert.equal(minuteLeft(0, 1), "1:00 left in this minute");
  assert.equal(ticksDue(5000, 1), 5);
  assert.equal(ticksDue(0, 1), 0);
  const game = fresh();
  const bars = Array.from({ length: 30 }, (_, index) => ({ t: index * 60, o: 10, h: 11, l: 9, c: 10.5 }));
  const next = fastForward(game, ticksDue(5000, 1), bars, bars, "2026-11-18", 31000);
  assert.equal(next.cursor, 0);
  assert.equal(next.tick, 5);
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

buyThenSellAll();
partialSellsThenAll();
sellWithNoCash();
switchTickerThenSell();
tapeMovesAndMirrors();
switchKeepsTheLiveCandle();
clockAndCatchUp();
historyDeleteLeavesTheRest();
console.log("practice behavior ok");
