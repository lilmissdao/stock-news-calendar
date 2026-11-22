import type { MinuteBar } from "./practice-path";

export const STARTING_CASH = 31_000;
const SEC_PER_DOLLAR = 20.6 / 1_000_000;
const CAT_PER_SHARE = 0.000003;
const TAF_PER_SHARE = 0.000195;
const TAF_MAX = 9.79;
const TAF_PAUSE_START = "2026-10-01";
const TAF_PAUSE_END = "2026-12-31";

function roundUpCent(amount: number): number {
  if (!(amount > 0)) return 0;
  return Math.ceil(amount * 100 - 1e-8) / 100;
}

export type Ticker = "TQQQ" | "SQQQ";
export type Lot = { shares: number; price: number; minute: number };
export type Position = { shares: number; avgCost: number; lots: Lot[] };
export type ClosedTrade = {
  ticker: Ticker;
  shares: number;
  entry: number;
  exit: number;
  entryMinute: number;
  exitMinute: number;
  pnl: number;
};

export type FillNote = {
  minute: number;
  ticker: Ticker;
  side: "buy" | "sell";
  shares: number;
  price: number;
  slippage: number;
  /** TQQQ's chart price at the moment of the fill, so SQQQ entries can be drawn on the TQQQ chart. */
  tqqqAt?: number;
};

/** Marketable delay, 0.5s to 1.2s. */
export function fillDelayMs(random: () => number = Math.random): number {
  return Math.round(500 + Math.min(1, Math.max(0, random())) * 700);
}

/**
 * Cents of slippage per share on a market order. TQQQ and SQQQ trade with a 1¢ spread, so a few hundred shares
 * usually fill within a penny of the last print: 1–2¢ in the opening five minutes while spreads are wider, then 0–1¢.
 */
export function slipPerShare(minute: number, random: () => number = Math.random): number {
  const roll = Math.floor(Math.min(0.999999, Math.max(0, random())) * 2);
  return (minute < 5 ? 1 + roll : roll) / 100;
}

/** Buys pay above the print. Sells receive below it. */
export function slippedPrice(quote: number, side: "buy" | "sell", slip: number): number {
  const worse = side === "buy" ? quote + slip : quote - slip;
  return Math.max(0.01, worse);
}

export function emptyPosition(): Position {
  return { shares: 0, avgCost: 0, lots: [] };
}

export function secFee(sellValue: number): number {
  if (!(sellValue > 500)) return 0;
  return roundUpCent(sellValue * SEC_PER_DOLLAR);
}

/** FINRA TAF is paused Oct 1 through Dec 31, 2026. Other dates still charge it. */
export function tafApplies(date: string): boolean {
  return date < TAF_PAUSE_START || date > TAF_PAUSE_END;
}

export function catFee(shares: number): number {
  return roundUpCent(shares * CAT_PER_SHARE);
}

export function tafFee(shares: number, date: string): number {
  if (shares <= 50 || !tafApplies(date)) return 0;
  return Math.min(TAF_MAX, roundUpCent(shares * TAF_PER_SHARE));
}

export function sellFees(shares: number, price: number, date: string): number {
  return secFee(shares * price) + catFee(shares) + tafFee(shares, date);
}

export function buyShares(cash: number, price: number, fraction: number): { shares: number; cash: number; fee: number } {
  if (!(price > 0) || !(cash > 0) || !(fraction > 0)) return { shares: 0, cash, fee: 0 };
  const shares = Math.floor((cash * Math.min(1, fraction)) / price);
  if (shares <= 0) return { shares: 0, cash, fee: 0 };
  return { shares, cash: cash - shares * price, fee: 0 };
}

/** Buy an exact number of shares, or as many as the cash covers if that's fewer. */
export function buyCount(cash: number, price: number, want: number): { shares: number; cash: number; fee: number } {
  if (!(price > 0) || !(cash > 0) || !(want > 0)) return { shares: 0, cash, fee: 0 };
  const shares = Math.min(Math.floor(want), Math.floor(cash / price));
  if (shares <= 0) return { shares: 0, cash, fee: 0 };
  return { shares, cash: cash - shares * price, fee: 0 };
}

/** Sell an exact number of shares, or everything held if that's fewer. */
export function sellCount(held: number, price: number, want: number, date = ""): { shares: number; proceeds: number; fee: number } {
  if (!(price > 0) || held <= 0 || !(want > 0)) return { shares: 0, proceeds: 0, fee: 0 };
  const shares = Math.min(held, Math.floor(want));
  if (shares <= 0) return { shares: 0, proceeds: 0, fee: 0 };
  const gross = shares * price;
  const fee = sellFees(shares, price, date);
  return { shares, proceeds: gross - fee, fee };
}

/** Sell a fraction of the shares she already holds. Buys are free; sells pay Robinhood's regulatory fees only. */
export function sellShares(held: number, price: number, fraction: number, date = ""): { shares: number; proceeds: number; fee: number } {
  if (!(price > 0) || held <= 0 || !(fraction > 0)) return { shares: 0, proceeds: 0, fee: 0 };
  const portion = Math.min(1, fraction);
  let shares = portion >= 1 ? held : Math.floor(held * portion);
  if (shares < 1) shares = 1;
  shares = Math.min(held, shares);
  const gross = shares * price;
  const fee = sellFees(shares, price, date);
  return { shares, proceeds: gross - fee, fee };
}

export function addLots(position: Position, shares: number, price: number, minute: number): Position {
  const lots = [...position.lots, { shares, price, minute }];
  const total = position.shares + shares;
  const avgCost = total > 0 ? (position.shares * position.avgCost + shares * price) / total : 0;
  return { shares: total, avgCost, lots };
}

export function closeLots(position: Position, shares: number, price: number, minute: number, ticker: Ticker, sellFee: number): { position: Position; trades: ClosedTrade[] } {
  let left = shares;
  const lots: Lot[] = [];
  const trades: ClosedTrade[] = [];
  for (const lot of position.lots) {
    if (left <= 0) {
      lots.push(lot);
      continue;
    }
    const used = Math.min(lot.shares, left);
    const feeShare = shares > 0 ? sellFee * (used / shares) : 0;
    trades.push({
      ticker,
      shares: used,
      entry: lot.price,
      exit: price,
      entryMinute: lot.minute,
      exitMinute: minute,
      pnl: (price - lot.price) * used - feeShare,
    });
    left -= used;
    if (lot.shares > used) lots.push({ ...lot, shares: lot.shares - used });
  }
  const remaining = lots.reduce((sum, lot) => sum + lot.shares, 0);
  const avgCost = remaining > 0 ? lots.reduce((sum, lot) => sum + lot.shares * lot.price, 0) / remaining : 0;
  return { position: { shares: remaining, avgCost, lots }, trades };
}

export function mark(minutes: MinuteBar[], cursor: number): number {
  const bar = minutes[Math.max(0, Math.min(cursor, minutes.length - 1))];
  return bar?.c ?? 0;
}

export function accountValue(cash: number, tqqq: Position, sqqq: Position, tqqqPrice: number, sqqqPrice: number): number {
  return cash + tqqq.shares * tqqqPrice + sqqq.shares * sqqqPrice;
}
