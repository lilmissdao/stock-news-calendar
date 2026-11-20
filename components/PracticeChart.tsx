"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, LineStyle, Time, UTCTimestamp } from "lightweight-charts";
import { clock } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type ChartMark = { time: number; side: "buy" | "sell" };

function paint(
  series: ISeriesApi<"Candlestick">,
  marks: ISeriesMarkersPluginApi<Time> | null,
  chart: IChartApi,
  line: { current: IPriceLine | null },
  candles: ChartCandle[],
  markers: ChartMark[],
  priorClose: number | null,
  fit: boolean,
  refreshLine: boolean,
) {
  series.setData(
    candles.map((bar) => ({
      time: bar.t as UTCTimestamp,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
    })),
  );
  const up = getComputedStyle(document.documentElement).getPropertyValue("--up").trim();
  const down = getComputedStyle(document.documentElement).getPropertyValue("--down").trim();
  marks?.setMarkers(
    markers.map((mark) => ({
      time: mark.time as UTCTimestamp,
      position: mark.side === "buy" ? "belowBar" : "aboveBar",
      shape: mark.side === "buy" ? "arrowUp" : "arrowDown",
      color: mark.side === "buy" ? up : down,
      text: mark.side === "buy" ? "B" : "S",
    })),
  );
  if (refreshLine) {
  if (line.current) {
    series.removePriceLine(line.current);
    line.current = null;
  }
  if (priorClose !== null && Number.isFinite(priorClose)) {
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim();
    line.current = series.createPriceLine({
      price: priorClose,
      color: ink || "#8a8478",
      lineWidth: 1,
      lineStyle: 2 as LineStyle,
      axisLabelVisible: true,
      title: "Prior close",
    });
  }
  }
  if (fit && candles.length) chart.timeScale().fitContent();
}

export function PracticeChart({ candles, markers, theme, priorClose }: { candles: ChartCandle[]; markers: ChartMark[]; theme: string; priorClose: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const countRef = useRef(0);
  const priorSeen = useRef<number | null | undefined>(undefined);
  const latest = useRef({ candles, markers, priorClose });
  latest.current = { candles, markers, priorClose };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let chart: IChartApi | null = null;
    void import("lightweight-charts").then(({ CandlestickSeries, ColorType, createChart, createSeriesMarkers }) => {
      if (dead || !host.current) return;
      const style = getComputedStyle(document.documentElement);
      const pick = (name: string) => style.getPropertyValue(name).trim();
      chart = createChart(host.current, {
        autoSize: true,
        layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: pick("--ink-soft"), fontFamily: "var(--font-sans), sans-serif" },
        grid: { vertLines: { color: pick("--line") }, horzLines: { color: pick("--line") } },
        rightPriceScale: { borderColor: pick("--line") },
        timeScale: {
          borderColor: pick("--line"),
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 8,
          minBarSpacing: 3,
          rightOffset: 4,
          tickMarkFormatter: (time: Time) => clock(typeof time === "number" ? time : 0),
        },
        localization: { timeFormatter: (time: Time) => clock(typeof time === "number" ? time : 0) },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: pick("--up"),
        downColor: pick("--down"),
        wickUpColor: pick("--up"),
        wickDownColor: pick("--down"),
        borderVisible: false,
        autoscaleInfoProvider: () => {
          const data = latest.current.candles;
          if (!data.length) return null;
          let high = Math.max(...data.map((bar) => bar.h));
          let low = Math.min(...data.map((bar) => bar.l));
          const mid = (high + low) / 2;
          const prior = latest.current.priorClose;
          if (prior !== null && mid > 0 && Math.abs(prior - mid) / mid <= 0.04) {
            high = Math.max(high, prior);
            low = Math.min(low, prior);
          }
          const pad = Math.max((high - low) * 0.12, high * 0.0015);
          return { priceRange: { minValue: low - pad, maxValue: high + pad } };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      marksRef.current = createSeriesMarkers(series, []);
      countRef.current = latest.current.candles.length;
      priorSeen.current = latest.current.priorClose;
      paint(series, marksRef.current, chart, lineRef, latest.current.candles, latest.current.markers, latest.current.priorClose, true, true);
    });
    return () => {
      dead = true;
      chart?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      marksRef.current = null;
      lineRef.current = null;
      countRef.current = 0;
      priorSeen.current = undefined;
    };
  }, [theme]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const fit = candles.length !== countRef.current;
    countRef.current = candles.length;
    const refreshLine = priorSeen.current !== priorClose;
    priorSeen.current = priorClose;
    paint(series, marksRef.current, chart, lineRef, candles, markers, priorClose, fit, refreshLine);
  }, [candles, markers, priorClose]);

  return <div ref={host} className="pr-chart" />;
}
