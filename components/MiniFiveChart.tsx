"use client";

import type { ChartCandle } from "@/components/PracticeChart";

const W = 150;
const H = 92;
const PAD_X = 6;
const TOP = 16;
const BOTTOM = 6;
/** The session is 9:30–10:00, so six 5-minute slots. Fixed slots keep candles from resizing as they appear. */
const SLOTS = 6;

/**
 * A small, read-only 5-minute candle view that sits in the main chart's top-left corner.
 * It uses the main chart's pixels-per-dollar, so a 5m candle is drawn the same height as the
 * same move on the 1m chart. Only when the 5m candles are too tall for the box does it shrink to fit.
 */
export function MiniFiveChart({ candles, pxPerDollar }: { candles: ChartCandle[]; pxPerDollar?: number | null }) {
  const slots = Math.max(SLOTS, candles.length);
  const hi = candles.length ? Math.max(...candles.map((bar) => bar.h)) : 1;
  const lo = candles.length ? Math.min(...candles.map((bar) => bar.l)) : 0;
  const plot = H - TOP - BOTTOM;
  const span = hi - lo || Math.max(hi * 0.001, 0.01);
  const fit = plot / span;
  const scale = pxPerDollar && pxPerDollar > 0 ? Math.min(pxPerDollar, fit) : fit;
  const mid = TOP + plot / 2;
  const center = (hi + lo) / 2;
  const y = (price: number) => mid + (center - price) * scale;
  const slotW = (W - PAD_X * 2) / slots;
  const bodyW = Math.max(4, slotW * 0.6);

  return (
    <div className="pr-mini" aria-label="5-minute candles" data-bar-count={candles.length}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img">
        <text x={6} y={11} className="pr-mini-label">
          5m
        </text>
        {candles.map((bar, index) => {
          const cx = PAD_X + slotW * index + slotW / 2;
          const up = bar.c >= bar.o;
          const color = up ? "var(--up)" : "var(--down)";
          const top = y(Math.max(bar.o, bar.c));
          const bottom = y(Math.min(bar.o, bar.c));
          return (
            <g key={bar.t}>
              <line x1={cx} x2={cx} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth={1} />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bottom - top)} fill={color} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
