import assert from "node:assert/strict";
import { ASSUMED_SHARE_PRICE, DEFAULT_SCENARIOS, formatAxisMoney, formatMoney, simulate } from "./simulator";

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
  };
  const result = simulate(scenario);
  assert.equal(result.dayOneShares, Math.floor(31_000 / ASSUMED_SHARE_PRICE));
  assert.notEqual(result.dayOneShares, Math.floor(31_000 / scenario.sharePrice));
  assert.equal(Number.isFinite(result.ending), true);
  assert.equal(Number.isFinite(result.feesPaid), true);
  assert.ok(result.ending > 1e21);
  assert.equal(formatMoney(result.ending), "$1.2e22");
  const fixedShares = 620 * 0.01 * result.tradeDays;
  assert.ok(result.feesPaid > fixedShares * 1000, "fees grow as the balance buys more shares");
  assert.equal(formatMoney(result.feesPaid).includes(","), false);
  for (const slice of result.yearSlices) {
    assert.equal(Number.isFinite(slice.ending), true);
    assert.equal(formatMoney(slice.ending).includes("—"), false);
  }
}

moneyScale();
iraTenYearScenario();
console.log("simulator display ok");
