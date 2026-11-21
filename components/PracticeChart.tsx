"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, LineStyle, LogicalRange, Time, UTCTimestamp } from "lightweight-charts";
import { clock, dayRange, priceWindow, seriesNeedsReset } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type CostLine = { key: string; price: number; title: string };
export type PracticeChartHandle = {
  zoom: (factor: number) => void;
  auto: () => void;
};

function toBar(bar: ChartCandle) {
  return { time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}

function applyCostLines(
  series: ISeriesApi<"Candlestick">,
  bag: { current: { sig: string; lines: IPriceLine[] } },
  lines: CostLine[],
  host: HTMLElement | null,
) {
  const sig = lines.map((line) => `${line.key}:${line.price}:${line.title}`).join("|");
  if (host) host.dataset.costs = sig;
  if (bag.current.sig === sig) return;
  for (const line of bag.current.lines) {
    try {
      series.removePriceLine(line);
    } catch {
      /* A replaced series has already dropped its lines. */
    }
  }
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue("--ink").trim() || "#241f1a";
  const accent = style.getPropertyValue("--accent").trim() || "#8f3d32";
  bag.current.lines = lines.map((line) =>
    series.createPriceLine({
      price: line.price,
      color: line.key === "sqqq" ? accent : ink,
      lineWidth: 1,
      lineStyle: 2 as LineStyle,
      axisLabelVisible: true,
      title: line.title,
    }),
  );
  bag.current.sig = sig;
}

function publish(chart: IChartApi, candles: ChartCandle[], host: HTMLElement | null, manual: boolean) {
  if (!host) return;
  const price = chart.priceScale("right").getVisibleRange();
  const time = chart.timeScale().getVisibleLogicalRange();
  if (price) {
    host.dataset.priceFrom = String(price.from);
    host.dataset.priceTo = String(price.to);
  }
  if (time) {
    host.dataset.timeFrom = String(time.from);
    host.dataset.timeTo = String(time.to);
  }
  host.dataset.barCount = String(candles.length);
  host.dataset.last = candles.length ? String(candles[candles.length - 1].c) : "";
  host.dataset.manual = manual ? "1" : "0";
}

function holdApply(applying: { current: boolean }, run: () => void) {
  applying.current = true;
  run();
  window.setTimeout(() => {
    applying.current = false;
  }, 120);
}

function fitNow(
  chart: IChartApi,
  candles: ChartCandle[],
  priorClose: number | null,
  anchors: number[],
  timeframe: string,
  host: HTMLElement | null,
  applying: { current: boolean },
) {
  const scale = chart.priceScale("right");
  const window = priceWindow(candles, priorClose, anchors);
  holdApply(applying, () => {
    chart.timeScale().applyOptions({ rightOffset: 0, minBarSpacing: 0.5, shiftVisibleRangeOnNewBar: false });
    scale.setAutoScale(true);
    if (window) scale.setVisibleRange({ from: window.from, to: window.to });
    chart.timeScale().setVisibleLogicalRange(dayRange(timeframe));
  });
  publish(chart, candles, host, false);
}

export const PracticeChart = forwardRef<PracticeChartHandle, {
  candles: ChartCandle[];
  costLines: CostLine[];
  theme: string;
  priorClose: number | null;
  seriesId: string;
}>(function PracticeChart({ candles, costLines, theme, priorClose, seriesId }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const costRef = useRef<{ sig: string; lines: IPriceLine[] }>({ sig: "", lines: [] });
  const barsRef = useRef<ChartCandle[] | null>(null);
  const seriesIdRef = useRef<string | null>(null);
  const manual = useRef(false);
  const applying = useRef(false);
  const latest = useRef({ candles, costLines, priorClose, seriesId });
  latest.current = { candles, costLines, priorClose, seriesId };

  function anchors() {
    return latest.current.costLines.map((line) => line.price);
  }

  useImperativeHandle(ref, () => ({
    zoom(factor: number) {
      const chart = chartRef.current;
      if (!chart) return;
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range) return;
      manual.current = true;
      chart.priceScale("right").setAutoScale(false);
      const center = (range.from + range.to) / 2;
      const half = Math.max(2, ((range.to - range.from) / 2) * factor);
      applying.current = true;
      chart.timeScale().setVisibleLogicalRange({ from: center - half, to: center + half });
      applying.current = false;
      publish(chart, latest.current.candles, host.current, true);
    },
    auto() {
      const chart = chartRef.current;
      if (!chart) return;
      manual.current = false;
      fitNow(chart, latest.current.candles, latest.current.priorClose, anchors(), latest.current.seriesId, host.current, applying);
      window.setTimeout(() => {
        manual.current = false;
        if (chartRef.current) publish(chartRef.current, latest.current.candles, host.current, false);
      }, 160);
    },
  }));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let dead = false;
    let chart: IChartApi | null = null;
      void import("lightweight-charts").then(({ CandlestickSeries, ColorType, createChart }) => {
      if (dead || !host.current) return;
      const style = getComputedStyle(document.documentElement);
      const pick = (name: string) => style.getPropertyValue(name).trim();
      chart = createChart(host.current, {
        autoSize: true,
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: pick("--ink-soft"),
          fontFamily: "var(--font-sans), sans-serif",
          attributionLogo: false,
        },
        grid: { vertLines: { color: pick("--line") }, horzLines: { color: pick("--line") } },
        rightPriceScale: { borderColor: pick("--line") },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale: {
          mouseWheel: true,
          pinch: true,
          axisPressedMouseMove: { time: true, price: true },
          axisDoubleClickReset: { time: true, price: true },
        },
        timeScale: {
          borderColor: pick("--line"),
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 12,
          minBarSpacing: 0.5,
          rightOffset: 0,
          shiftVisibleRangeOnNewBar: false,
          tickMarkFormatter: (time: Time) => clock(typeof time === "number" ? time : 0),
        },
        localization: { timeFormatter: (time: Time) => clock(typeof time === "number" ? time : 0) },
      });
      const gesture = { current: false };
      const arm = () => {
        gesture.current = true;
      };
      const disarm = () => {
        window.setTimeout(() => {
          gesture.current = false;
        }, 250);
      };
      host.current.addEventListener("pointerdown", arm);
      host.current.addEventListener("pointerup", disarm);
      host.current.addEventListener("wheel", arm, { passive: true });
      const onRange = () => {
        if (gesture.current && !applying.current) {
          manual.current = true;
          chart?.priceScale("right").setAutoScale(false);
        }
        if (chart) publish(chart, latest.current.candles, host.current, manual.current);
      };
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      const series = chart.addSeries(CandlestickSeries, {
        upColor: pick("--up"),
        downColor: pick("--down"),
        wickUpColor: pick("--up"),
        wickDownColor: pick("--down"),
        borderVisible: false,
        autoscaleInfoProvider: () => {
          const data = latest.current.candles;
          const window = priceWindow(data, latest.current.priorClose, latest.current.costLines.map((line) => line.price));
          if (!window) return null;
          return { priceRange: { minValue: window.from, maxValue: window.to } };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      barsRef.current = null;
      seriesIdRef.current = null;
      costRef.current = { sig: "", lines: [] };
      manual.current = false;
      paint(series, chart, lineRef, costRef, latest.current, host.current, true, barsRef, seriesIdRef, manual, applying);
    });
    return () => {
      dead = true;
      chart?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      lineRef.current = null;
      costRef.current = { sig: "", lines: [] };
      barsRef.current = null;
      seriesIdRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const blockScroll = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    const down = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      if (event.clientX > box.right - 72) {
        manual.current = true;
        chartRef.current?.priceScale("right").setAutoScale(false);
        if (chartRef.current) publish(chartRef.current, latest.current.candles, el, true);
      }
    };
    el.addEventListener("touchmove", blockScroll, { passive: false, capture: true });
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("touchmove", blockScroll, true);
      el.removeEventListener("pointerdown", down);
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const switched = seriesIdRef.current !== null && seriesIdRef.current !== seriesId;
    if (switched) manual.current = false;
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
      paint(live, box, lineRef, costRef, latest.current, host.current, switched, barsRef, seriesIdRef, manual, applying);
    };
    draw();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [candles, costLines, priorClose, seriesId]);

  return <div ref={host} className="pr-chart" />;
});

function paint(
  series: ISeriesApi<"Candlestick">,
  chart: IChartApi,
  line: { current: IPriceLine | null },
  costs: { current: { sig: string; lines: IPriceLine[] } },
  latest: { candles: ChartCandle[]; costLines: CostLine[]; priorClose: number | null; seriesId: string },
  host: HTMLElement | null,
  switched: boolean,
  previous: { current: ChartCandle[] | null },
  previousId: { current: string | null },
  manual: { current: boolean },
  applying: { current: boolean },
) {
  const { candles, costLines, priorClose, seriesId } = latest;
  const prices = costLines.map((line) => line.price);
  const replace = seriesNeedsReset(previousId.current, seriesId, previous.current, candles) || !candles.length;
  const savedTime: LogicalRange | null = manual.current ? chart.timeScale().getVisibleLogicalRange() : null;
  const savedPrice = manual.current ? chart.priceScale("right").getVisibleRange() : null;
  if (replace) {
    if (line.current) {
      series.removePriceLine(line.current);
      line.current = null;
    }
    series.setData(candles.map(toBar));
    const window = priceWindow(candles, priorClose, prices);
    if (priorClose !== null && window && priorClose >= window.from && priorClose <= window.to) {
      const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim();
      line.current = series.createPriceLine({
        price: priorClose,
        color: ink || "#8a8478",
        lineWidth: 1,
        lineStyle: 2 as LineStyle,
        axisLabelVisible: true,
        title: "Prior",
      });
    }
    applyCostLines(series, costs, costLines, host);
    if (!manual.current || switched) {
      manual.current = false;
      fitNow(chart, candles, priorClose, prices, seriesId, host, applying);
    } else {
      applying.current = true;
      if (savedTime) chart.timeScale().setVisibleLogicalRange(savedTime);
      if (savedPrice) chart.priceScale("right").setVisibleRange(savedPrice);
      applying.current = false;
      publish(chart, candles, host, true);
    }
  } else if (candles.length) {
    const bar = toBar(candles[candles.length - 1]);
    try {
      series.update(bar);
    } catch {
      series.setData(candles.map(toBar));
    }
    applyCostLines(series, costs, costLines, host);
    if (!manual.current) {
      chart.priceScale("right").setAutoScale(true);
      const desired = dayRange(seriesId);
      const range = chart.timeScale().getVisibleLogicalRange();
      if (!range || Math.abs(range.from - desired.from) > 0.2 || Math.abs(range.to - desired.to) > 0.2) {
        holdApply(applying, () => chart.timeScale().setVisibleLogicalRange(desired));
      }
    }
    publish(chart, candles, host, manual.current);
  }
  previous.current = candles;
  previousId.current = seriesId;
}
