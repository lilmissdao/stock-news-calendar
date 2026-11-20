"use client";

import { useEffect, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, LineStyle, Time, UTCTimestamp } from "lightweight-charts";
import { clock, priceWindow, seriesNeedsReset } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type ChartMark = { time: number; side: "buy" | "sell" };

function toBar(bar: ChartCandle) {
  return { time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}

function showCandles(chart: IChartApi, candles: ChartCandle[], priorClose: number | null, host: HTMLElement | null) {
  const scale = chart.priceScale("right");
  const window = priceWindow(candles, priorClose);
  if (window) {
    scale.setAutoScale(true);
    scale.setVisibleRange({ from: window.from, to: window.to });
    scale.setAutoScale(true);
  }
  const last = Math.max(candles.length - 1, 0);
  chart.timeScale().fitContent();
  chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: last + 1.5 });
  if (host && window) {
    const visible = scale.getVisibleRange();
    host.dataset.priceFrom = visible ? String(visible.from) : String(window.from);
    host.dataset.priceTo = visible ? String(visible.to) : String(window.to);
    host.dataset.barCount = String(candles.length);
    host.dataset.last = candles.length ? String(candles[candles.length - 1].c) : "";
  }
}

function candleOffscreen(chart: IChartApi, candles: ChartCandle[]): boolean {
  const last = candles[candles.length - 1];
  if (!last) return false;
  const price = chart.priceScale("right").getVisibleRange();
  const time = chart.timeScale().getVisibleLogicalRange();
  const index = candles.length - 1;
  if (!price || last.c < price.from || last.c > price.to || last.l < price.from || last.h > price.to) return true;
  if (!time || index < time.from || index > time.to) return true;
  return false;
}

function paint(
  series: ISeriesApi<"Candlestick">,
  marks: ISeriesMarkersPluginApi<Time> | null,
  chart: IChartApi,
  line: { current: IPriceLine | null },
  candles: ChartCandle[],
  markers: ChartMark[],
  priorClose: number | null,
  fit: boolean,
  previous: { current: ChartCandle[] | null },
  previousId: { current: string | null },
  seriesId: string,
  host: HTMLElement | null,
) {
  const replace = seriesNeedsReset(previousId.current, seriesId, previous.current, candles) || !candles.length;
  const markerData = markers.map((mark) => ({
    time: mark.time as UTCTimestamp,
    position: mark.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
    shape: mark.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
    color: mark.side === "buy" ? getComputedStyle(document.documentElement).getPropertyValue("--up").trim() : getComputedStyle(document.documentElement).getPropertyValue("--down").trim(),
    text: mark.side === "buy" ? "B" : "S",
  }));
  if (replace) {
    marks?.setMarkers([]);
    if (line.current) {
      series.removePriceLine(line.current);
      line.current = null;
    }
    series.setData(candles.map(toBar));
    try {
      marks?.setMarkers(markerData);
    } catch {
      marks?.setMarkers([]);
    }
    const window = priceWindow(candles, priorClose);
    if (priorClose !== null && window && priorClose >= window.from && priorClose <= window.to) {
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
    showCandles(chart, candles, priorClose, host);
  } else if (candles.length) {
    series.update(toBar(candles[candles.length - 1]));
    try {
      marks?.setMarkers(markerData);
    } catch {
      marks?.setMarkers([]);
    }
    if (candleOffscreen(chart, candles)) showCandles(chart, candles, priorClose, host);
  }
  previous.current = candles;
  previousId.current = seriesId;
  if (fit && !replace && candles.length) chart.timeScale().fitContent();
  if (host && candles.length) {
    const visible = chart.priceScale("right").getVisibleRange();
    if (visible) {
      host.dataset.priceFrom = String(visible.from);
      host.dataset.priceTo = String(visible.to);
    }
    host.dataset.barCount = String(candles.length);
    host.dataset.last = String(candles[candles.length - 1].c);
  }
}

export function PracticeChart({ candles, markers, theme, priorClose, seriesId }: { candles: ChartCandle[]; markers: ChartMark[]; theme: string; priorClose: number | null; seriesId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const countRef = useRef(0);
  const priorSeen = useRef<number | null | undefined>(undefined);
  const barsRef = useRef<ChartCandle[] | null>(null);
  const seriesIdRef = useRef<string | null>(null);
  const latest = useRef({ candles, markers, priorClose, seriesId });
  latest.current = { candles, markers, priorClose, seriesId };

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
      barsRef.current = null;
      seriesIdRef.current = null;
      paint(series, marksRef.current, chart, lineRef, latest.current.candles, latest.current.markers, latest.current.priorClose, true, barsRef, seriesIdRef, latest.current.seriesId, host.current);
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
      barsRef.current = null;
      seriesIdRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const switched = seriesIdRef.current !== seriesId;
    const fit = switched || candles.length !== countRef.current;
    countRef.current = candles.length;
    priorSeen.current = priorClose;
    let frames = 0;
    let raf = 0;
    let cancelled = false;
    const draw = () => {
      if (cancelled) return;
      const live = seriesRef.current;
      const box = chartRef.current;
      if (!live || !box) return;
      if ((host.current?.clientWidth ?? 0) < 8 && frames < 20) {
        frames += 1;
        raf = window.requestAnimationFrame(draw);
        return;
      }
      paint(live, marksRef.current, box, lineRef, candles, markers, priorClose, fit, barsRef, seriesIdRef, seriesId, host.current);
    };
    draw();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [candles, markers, priorClose, seriesId]);

  return <div ref={host} className="pr-chart" />;
}
