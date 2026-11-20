import type { MinuteBar } from "./practice-path";

export const STARTING_CASH = 31_000;
export const SPREAD = 0.01;
const SEC_FEE_RATE = 0.0000206;

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

export function emptyPosition(): Position {
  return { shares: 0, avgCost: 0, lots: [] };
}

export function secFee(sellValue: number): number {
  if (!(sellValue > 500)) return 0;
  return Math.ceil(sellValue * SEC_FEE_RATE * 100 - 1e-8) / 100;
}

export function buyShares(cash: number, price: number, fraction: number): { shares: number; cash: number; fee: number } {
  if (!(price > 0) || !(cash > 0) || !(fraction > 0)) return { shares: 0, cash, fee: 0 };
  const shares = Math.floor((cash * Math.min(1, fraction)) / (price + SPREAD));
  if (shares <= 0) return { shares: 0, cash, fee: 0 };
  const fee = shares * SPREAD;
  return { shares, cash: cash - shares * price - fee, fee };
}

export function sellShares(held: number, price: number, fraction: number): { shares: number; proceeds: number; fee: number } {
  if (!(price > 0) || held <= 0 || !(fraction > 0)) return { shares: 0, proceeds: 0, fee: 0 };
  const shares = fraction >= 1 ? held : Math.min(held, Math.floor(held * fraction));
  if (shares <= 0) return { shares: 0, proceeds: 0, fee: 0 };
  const gross = shares * price;
  const fee = shares * SPREAD + secFee(gross);
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
      pnl: (price - lot.price) * used - used * SPREAD - feeShare,
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
