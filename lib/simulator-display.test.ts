import assert from "node:assert/strict";
import { DEFAULT_SCENARIOS, formatAxisMoney, formatMoney, simulate, TRADING_DAYS_PER_YEAR } from "./simulator";

function moneyScale() {
  assert.equal(formatMoney(31000), "$31,000.00");
  assert.equal(formatMoney(1_230_000), "$1.23M");
  assert.equal(formatMoney(4_560_000_000), "$4.56B");
  assert.equal(formatMoney(7_890_000_000_000), "$7.89T");
  assert.equal(formatMoney(1.2e18), "$1.2e18");
  assert.equal(formatMoney(Infinity), "$∞");
  assert.equal(formatMoney(-Infinity), "-$∞");
  assert.equal(formatMoney(Number.NaN), "$0");
  assert.equal(formatMoney(1.1110952945573077e22).includes("—"), false);
  assert.equal(formatAxisMoney(1.2e18, 1e18), "$1.2e18");
}

function iraTenYearScenario() {
  const scenario = {
    ...DEFAULT_SCENARIOS[0],
    dailyReturnPct: 2,
    drawdownPct: 0.5,
    drawdownsPerMonth: 3,
    years: 10,
    sharePrice: 50,
    shareSpread: 0.01,
    tradeWith: "shares" as const,
    maxTrade: 0,
  };
  const result = simulate(scenario);
  assert.equal(result.dayOneShares, 620);
  assert.equal(Number.isFinite(result.ending), true);
  assert.equal(Number.isFinite(result.feesPaid), true);
  assert.ok(result.ending > 1e21);
  assert.equal(formatMoney(result.ending), "$1.1e22");
  const fixedShares = 620 * 0.01 * result.tradeDays;
  assert.ok(result.feesPaid > fixedShares * 1000, "fees grow as the balance buys more shares");
  assert.equal(formatMoney(result.feesPaid).includes(","), false);
  for (const slice of result.yearSlices) {
    assert.equal(Number.isFinite(slice.ending), true);
    assert.equal(formatMoney(slice.ending).includes("—"), false);
  }
}

function tradeSizeIsCapped() {
  const base = { ...DEFAULT_SCENARIOS[0], dailyReturnPct: 1, drawdownPct: 0, drawdownsPerMonth: 0, years: 3, shareSpread: 0, sharePrice: 50 };
  const free = simulate({ ...base, maxTrade: 0 });
  const capped = simulate({ ...base, maxTrade: 7_000_000 });
  assert.equal(free.capDay, null);
  assert.ok(capped.capDay !== null && capped.capDay > 0, "the balance reaches the cap");
  assert.ok(capped.ending < free.ending / 2, "capping stops the exponential blow-up");
  // Past the cap, every good day adds about cap × daily return (less the SEC fee), not balance × daily return.
  const day = TRADING_DAYS_PER_YEAR * 3;
  const perDay = (capped.ending - capped.points[capped.points.length - 2].balance) / 21;
  assert.ok(Math.abs(perDay - 70_000) < 200, `about $70K a day at the cap, got ${perDay}`);
  assert.equal(capped.cappedDailyGain, 70_000);
  assert.ok(day > capped.capDay!);
  // Below the cap nothing changes.
  const small = simulate({ ...base, years: 1, dailyReturnPct: 0.1 });
  assert.equal(small.capDay, null);
  assert.equal(small.ending, simulate({ ...base, years: 1, dailyReturnPct: 0.1, maxTrade: 0 }).ending);
}

moneyScale();
iraTenYearScenario();
tradeSizeIsCapped();
console.log("simulator display ok");
