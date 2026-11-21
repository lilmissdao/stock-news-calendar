"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, LineStyle, LogicalRange, Time, UTCTimestamp } from "lightweight-charts";
import { clock, priceWindow, seriesNeedsReset } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type ChartMark = { time: number; side: "buy" | "sell" };
export type PracticeChartHandle = {
  zoom: (factor: number) => void;
  auto: () => void;
};

function toBar(bar: ChartCandle) {
  return { time: bar.t as UTCTimestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c };
}

function applyMarkers(
  marks: ISeriesMarkersPluginApi<Time> | null,
  markerData: { time: UTCTimestamp; position: "belowBar" | "aboveBar"; shape: "arrowUp" | "arrowDown"; color: string; text: string }[],
  markerSig: { current: string },
  sig: string,
) {
  if (!marks || markerSig.current === sig) return;
  try {
    marks.setMarkers(markerData);
    markerSig.current = sig;
  } catch {
    try {
      marks.setMarkers([]);
    } catch {
      /* The candle series is still updated when a marker is rejected. */
    }
    markerSig.current = "";
  }
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

function fitNow(chart: IChartApi, candles: ChartCandle[], priorClose: number | null, host: HTMLElement | null, applying: { current: boolean }) {
  const scale = chart.priceScale("right");
  const window = priceWindow(candles, priorClose);
  holdApply(applying, () => {
    chart.timeScale().applyOptions({ barSpacing: 16, rightOffset: 5, minBarSpacing: 8 });
    if (window) {
      scale.setVisibleRange({ from: window.from, to: window.to });
      scale.setAutoScale(true);
    }
    const last = Math.max(candles.length - 1, 0);
    chart.timeScale().setVisibleLogicalRange({ from: last - 14, to: last + 5 });
  });
  publish(chart, candles, host, false);
}

export const PracticeChart = forwardRef<PracticeChartHandle, {
  candles: ChartCandle[];
  markers: ChartMark[];
  /** Average cost of the shares held in the charted ticker, drawn as a plain dashed line. */
  costPrice?: number | null;
  theme: string;
  priorClose: number | null;
  seriesId: string;
}>(function PracticeChart({ candles, markers, costPrice = null, theme, priorClose, seriesId }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const costRef = useRef<{ line: IPriceLine | null; price: number | null }>({ line: null, price: null });
  const barsRef = useRef<ChartCandle[] | null>(null);
  const seriesIdRef = useRef<string | null>(null);
  const markerSig = useRef("");
  const manual = useRef(false);
  const applying = useRef(false);
  const latest = useRef({ candles, markers, priorClose, seriesId });
  latest.current = { candles, markers, priorClose, seriesId };

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
      fitNow(chart, latest.current.candles, latest.current.priorClose, host.current, applying);
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
    void import("lightweight-charts").then(({ CandlestickSeries, ColorType, createChart, createSeriesMarkers }) => {
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
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
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
          barSpacing: 16,
          minBarSpacing: 8,
          rightOffset: 5,
          shiftVisibleRangeOnNewBar: true,
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
          const window = priceWindow(data, latest.current.priorClose);
          if (!window) return null;
          return { priceRange: { minValue: window.from, maxValue: window.to } };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      costRef.current = { line: null, price: null };
      marksRef.current = createSeriesMarkers(series, []);
      barsRef.current = null;
      seriesIdRef.current = null;
      markerSig.current = "";
      manual.current = false;
      paint(series, marksRef.current, chart, lineRef, latest.current, host.current, true, barsRef, seriesIdRef, markerSig, manual, applying);
    });
    return () => {
      dead = true;
      chart?.remove();
      chartRef.current = null;
      seriesRef.current = null;
      costRef.current = { line: null, price: null };
      marksRef.current = null;
      lineRef.current = null;
      barsRef.current = null;
      seriesIdRef.current = null;
      markerSig.current = "";
    };
  }, [theme]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const down = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      if (event.clientX > box.right - 72) {
        manual.current = true;
        chartRef.current?.priceScale("right").setAutoScale(false);
        if (chartRef.current) publish(chartRef.current, latest.current.candles, el, true);
      }
    };
    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
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
      paint(live, marksRef.current, box, lineRef, latest.current, host.current, switched, barsRef, seriesIdRef, markerSig, manual, applying);
    };
    draw();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [candles, markers, priorClose, seriesId]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bag = costRef.current;
    if (bag.price === costPrice && (bag.line !== null) === (costPrice !== null)) return;
    if (bag.line) {
      try {
        series.removePriceLine(bag.line);
      } catch {
        /* The series was rebuilt and already dropped its lines. */
      }
      bag.line = null;
    }
    bag.price = costPrice;
    if (costPrice === null || !(costPrice > 0)) return;
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--ink-soft").trim();
    // Just the dashed line: no title on the chart and no price tag on the right axis.
    bag.line = series.createPriceLine({
      price: costPrice,
      color: ink || "#8a8478",
      lineWidth: 1,
      lineStyle: 2 as LineStyle,
      axisLabelVisible: false,
      title: "",
    });
  }, [costPrice, candles, theme]);

  return <div ref={host} className="pr-chart" />;
});

function paint(
  series: ISeriesApi<"Candlestick">,
  marks: ISeriesMarkersPluginApi<Time> | null,
  chart: IChartApi,
  line: { current: IPriceLine | null },
  latest: { candles: ChartCandle[]; markers: ChartMark[]; priorClose: number | null; seriesId: string },
  host: HTMLElement | null,
  switched: boolean,
  previous: { current: ChartCandle[] | null },
  previousId: { current: string | null },
  markerSig: { current: string },
  manual: { current: boolean },
  applying: { current: boolean },
) {
  const { candles, markers, priorClose, seriesId } = latest;
  const replace = seriesNeedsReset(previousId.current, seriesId, previous.current, candles) || !candles.length;
  const sig = markers.map((mark) => `${mark.time}:${mark.side}`).join("|");
  const savedTime: LogicalRange | null = manual.current ? chart.timeScale().getVisibleLogicalRange() : null;
  const savedPrice = manual.current ? chart.priceScale("right").getVisibleRange() : null;
  const markerData = markers.map((mark) => ({
    time: mark.time as UTCTimestamp,
    position: mark.side === "buy" ? ("belowBar" as const) : ("aboveBar" as const),
    shape: mark.side === "buy" ? ("arrowUp" as const) : ("arrowDown" as const),
    color: mark.side === "buy" ? getComputedStyle(document.documentElement).getPropertyValue("--up").trim() : getComputedStyle(document.documentElement).getPropertyValue("--down").trim(),
    text: mark.side === "buy" ? "B" : "S",
  }));
  if (replace) {
    marks?.setMarkers([]);
    markerSig.current = "";
    if (line.current) {
      series.removePriceLine(line.current);
      line.current = null;
    }
    series.setData(candles.map(toBar));
    applyMarkers(marks, markerData, markerSig, sig);
    const window = priceWindow(candles, priorClose);
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
    if (!manual.current || switched) {
      manual.current = false;
      fitNow(chart, candles, priorClose, host, applying);
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
    applyMarkers(marks, markerData, markerSig, sig);
    if (!manual.current) {
      chart.priceScale("right").setAutoScale(true);
      const range = chart.timeScale().getVisibleLogicalRange();
      const last = candles.length - 1;
      if (!range || last > range.to - 1 || last < range.from) {
        holdApply(applying, () => chart.timeScale().setVisibleLogicalRange({ from: last - 14, to: last + 5 }));
      }
    }
    publish(chart, candles, host, manual.current);
  }
  previous.current = candles;
  previousId.current = seriesId;
}
