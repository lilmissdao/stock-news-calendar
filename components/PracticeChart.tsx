"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, ISeriesMarkersPluginApi, Time, UTCTimestamp } from "lightweight-charts";
import { clock } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type ChartMark = { time: number; side: "buy" | "sell" };

function paint(
  series: ISeriesApi<"Candlestick">,
  marks: ISeriesMarkersPluginApi<Time> | null,
  chart: IChartApi,
  candles: ChartCandle[],
  markers: ChartMark[],
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
  if (candles.length) chart.timeScale().fitContent();
}

export function PracticeChart({ candles, markers, theme }: { candles: ChartCandle[]; markers: ChartMark[]; theme: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const latest = useRef({ candles, markers });
  latest.current = { candles, markers };

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
      });
      chartRef.current = chart;
      seriesRef.current = series;
      marksRef.current = createSeriesMarkers(series, []);
      paint(series, marksRef.current, chart, latest.current.candles, latest.current.markers);
    });
    return () => {
      dead = true;
      chart?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      marksRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    paint(series, marksRef.current, chart, candles, markers);
  }, [candles, markers]);

  return <div ref={host} className="pr-chart" />;
}
