import assert from "node:assert/strict";
import { newGame, restartDay, trade } from "./practice-engine";
import { emptySync, mergeSync, newSyncCode, sanitizeSync, type SyncDoc } from "./sync";
import type { ArchivedGame } from "./practice-history";
import type { Scenario } from "./simulator";

function game(id: string, endedAt: string, days = 1): ArchivedGame {
  return {
    id,
    number: 1,
    playedAt: endedAt,
    endedAt,
    batches: [
      {
        startDate: "2026-11-01",
        endDate: "2026-11-02",
        days: Array.from({ length: days }, (_, index) => ({
          date: `2026-11-${String(index + 1).padStart(2, "0")}`,
          dollars: 10,
          pct: 0.01,
          equity: 31000,
          drawdown: 0,
          fees: 0,
        })),
        trades: [],
        fees: 0,
        startEquity: 31000,
        endEquity: 31100,
        holdTqqq: 31100,
        winRate: null,
        best: null,
        worst: null,
        avgHold: null,
        maxDrawdown: 0,
      },
    ],
    endingBalance: 31100,
    startBalance: 31000,
  };
}

function scenario(id: string, name: string): Scenario {
  return {
    id,
    name,
    startingCapital: 31000,
    dailyReturnPct: 1,
    drawdownPct: 0.5,
    drawdownsPerMonth: 1,
    years: 3,
    tradeWith: "shares",
    sharePrice: 50,
    optionPrice: 2,
    shareSpread: 0.01,
    optionSpread: 0.05,
  };
}

function withGames(doc: SyncDoc, games: ArchivedGame[], extra: Partial<SyncDoc["practice"]> = {}): SyncDoc {
  return { ...doc, practice: { ...doc.practice, games, ...extra } };
}

function unionsGamesAndHonorsDeletions() {
  const local = withGames(emptySync(), [game("a", "2026-11-01T00:00:00.000Z"), game("b", "2026-11-02T00:00:00.000Z")]);
  const remote = withGames(emptySync(), [game("b", "2026-11-02T00:00:00.000Z", 2), game("c", "2026-11-03T00:00:00.000Z")], {
    deletedIds: ["a"],
  });
  const merged = mergeSync(remote, local);
  assert.deepEqual(merged.practice.games.map((item) => item.id), ["b", "c"]);
  assert.equal(merged.practice.games.find((item) => item.id === "b")?.batches[0].days.length, 2);
  assert.ok(merged.practice.deletedIds.includes("a"));
}

function deleteAllDropsOlderGamesOnly() {
  const older = game("old", "2026-11-01T00:00:00.000Z");
  const newer = game("new", "2026-11-20T00:00:00.000Z");
  const local = withGames(emptySync(), [older, newer]);
  const remote = withGames(emptySync(), [], { clearedAt: Date.parse("2026-11-10T00:00:00.000Z"), deletedIds: ["old"] });
  const merged = mergeSync(remote, local);
  assert.deepEqual(merged.practice.games.map((item) => item.id), ["new"]);
}

function settingsAndScenariosUseTheNewerWrite() {
  const local = emptySync();
  local.practice.settings = { speed: 2, realistic: true, chartH: 400, theme: "dark", at: 20 };
  local.simulator = { scenarios: [scenario("s1", "Phone")], at: 5 };
  const remote = emptySync();
  remote.practice.settings = { speed: 1, realistic: false, chartH: 300, theme: "light", at: 10 };
  remote.simulator = { scenarios: [scenario("s2", "Desk")], at: 5 };
  const merged = mergeSync(remote, local);
  assert.equal(merged.practice.settings.speed, 2);
  assert.equal(merged.practice.settings.theme, "dark");
  assert.deepEqual(merged.simulator.scenarios.map((item) => item.id).sort(), ["s1", "s2"]);
  remote.simulator.at = 30;
  const replaced = mergeSync(remote, local);
  assert.deepEqual(replaced.simulator.scenarios.map((item) => item.id), ["s2"]);
}

function newerSessionWins() {
  const local = emptySync();
  const remote = emptySync();
  local.practice.gameAt = 50;
  remote.practice.gameAt = 80;
  remote.practice.game = { startedAt: "remote" } as SyncDoc["practice"]["game"];
  const merged = mergeSync(sanitizeSync(local), sanitizeSync({ ...remote, practice: { ...remote.practice, game: null, gameAt: 80 } }));
  assert.equal(merged.practice.game, null);
  assert.equal(merged.practice.gameAt, 80);
}

function resetBeatsATiedCopyThatHasGoneFurther() {
  const played = { ...trade(newGame(10, () => 0.2), "TQQQ", "buy", 0.25, 50), cursor: 8, tick: 20, editedAt: 100 };
  const reset = restartDay(played);
  const resetGame = { ...reset, editedAt: 200 };
  const local = emptySync();
  const remote = emptySync();
  local.practice.game = played;
  local.practice.gameAt = 100;
  remote.practice.game = resetGame;
  remote.practice.gameAt = 100;
  const merged = mergeSync(sanitizeSync(local), sanitizeSync(remote));
  assert.equal(merged.practice.game?.cursor, 0);
  assert.equal(merged.practice.game?.tick, 0);
  assert.equal(merged.practice.game?.positions.TQQQ.shares, 0);
  assert.equal(merged.practice.game?.editedAt, 200);
}

function codeLooksUnguessable() {
  const code = newSyncCode();
  assert.equal(code.length, 10);
  assert.match(code, /^[a-hjkmnp-z2-9]+$/);
  assert.notEqual(newSyncCode(), code);
}

unionsGamesAndHonorsDeletions();
deleteAllDropsOlderGamesOnly();
settingsAndScenariosUseTheNewerWrite();
newerSessionWins();
resetBeatsATiedCopyThatHasGoneFurther();
codeLooksUnguessable();
console.log("sync ok");
