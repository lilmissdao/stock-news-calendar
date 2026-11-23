"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, ISeriesMarkersPluginApi, LineStyle, LogicalRange, Time, UTCTimestamp } from "lightweight-charts";
import { clock, growToInclude, priceWindow, seriesNeedsReset } from "@/lib/practice-path";

export type ChartCandle = { t: number; o: number; h: number; l: number; c: number };
export type ChartMark = { time: number; side: "buy" | "sell" };
export type CostLine = { kind: "tqqq" | "sqqq"; price: number };
const NO_COST_LINES: CostLine[] = [];
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
  // Read the scale after the chart has redrawn, so autoscale changes are included.
  window.requestAnimationFrame(() => {
    try {
      const range = chart.priceScale("right").getVisibleRange();
      const height = chart.paneSize().height;
      const span = range ? Math.abs(range.to - range.from) : 0;
      if (height > 0 && span > 0) host.dispatchEvent(new CustomEvent("pr-scale", { detail: height / span }));
    } catch {
      /* The chart was removed before the frame ran. */
    }
  });
  if (time) {
    host.dataset.timeFrom = String(time.from);
    host.dataset.timeTo = String(time.to);
  }
  host.dataset.barCount = String(candles.length);
  host.dataset.last = candles.length ? String(candles[candles.length - 1].c) : "";
  host.dataset.manual = manual ? "1" : "0";
}

/** With a hand-set price range, widen it just enough (plus a little room) when the live candle pokes out. */
function keepLiveCandleInView(chart: IChartApi, candles: ChartCandle[]) {
  const scale = chart.priceScale("right");
  if (!candles.length || scale.options().autoScale) return;
  const range = scale.getVisibleRange();
  if (!range) return;
  const next = growToInclude(range, candles[candles.length - 1]);
  if (next) scale.setVisibleRange(next);
}

function holdApply(applying: { current: boolean }, run: () => void) {
  applying.current = true;
  run();
  window.setTimeout(() => {
    applying.current = false;
  }, 120);
}

function fitNow(chart: IChartApi, candles: ChartCandle[], host: HTMLElement | null, applying: { current: boolean }) {
  const scale = chart.priceScale("right");
  const window = priceWindow(candles);
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
  theme: string;
  priorClose: number | null;
  /** Average entry of each open position, drawn as a dashed line with no right-axis tag. */
  costLines?: CostLine[];
  seriesId: string;
  /** Pixels per dollar on the price axis, reported whenever the view changes. */
  onScale?: (pxPerDollar: number) => void;
}>(function PracticeChart({ candles, markers, theme, priorClose, costLines = NO_COST_LINES, seriesId, onScale }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lineRef = useRef<IPriceLine | null>(null);
  const costRef = useRef<{ lines: IPriceLine[]; sig: string; series: ISeriesApi<"Candlestick"> | null }>({ lines: [], sig: "", series: null });
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
      fitNow(chart, latest.current.candles, host.current, applying);
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
        // Scrolling or zooming time keeps the user's time window, but the price axis keeps fitting the candles.
        if (gesture.current && !applying.current) manual.current = true;
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
          const window = priceWindow(data);
          if (!window) return null;
          return { priceRange: { minValue: window.from, maxValue: window.to } };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
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
      marksRef.current = null;
      lineRef.current = null;
      barsRef.current = null;
      seriesIdRef.current = null;
      markerSig.current = "";
    };
  }, [theme]);

  const scaleCb = useRef(onScale);
  scaleCb.current = onScale;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const report = (event: Event) => scaleCb.current?.((event as CustomEvent<number>).detail);
    el.addEventListener("pr-scale", report);
    return () => el.removeEventListener("pr-scale", report);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const down =(event: PointerEvent) => {
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

  const costSig = costLines.map((line) => `${line.kind}:${line.price.toFixed(4)}`).join("|");
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bag = costRef.current;
    if (bag.series === series && bag.sig === `${costSig}#${theme}`) return;
    if (bag.series === series) {
      for (const line of bag.lines) {
        try {
          series.removePriceLine(line);
        } catch {
          /* already gone */
        }
      }
    }
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#8f3d32";
    bag.lines = costLines.map((line) =>
      series.createPriceLine({
        price: line.price,
        color: accent,
        lineWidth: 2,
        // TQQQ entry is dashed; the SQQQ breakeven level is dotted so the two can't be confused.
        lineStyle: (line.kind === "tqqq" ? 2 : 1) as LineStyle,
        axisLabelVisible: false,
        title: "",
      }),
    );
    bag.series = series;
    bag.sig = `${costSig}#${theme}`;
  });

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
  // Only a price-axis drag turns autoscale off; restore that hand-set price range, never freeze an autoscaled one.
  const savedPrice = manual.current && !chart.priceScale("right").options().autoScale ? chart.priceScale("right").getVisibleRange() : null;
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
    const window = priceWindow(candles);
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
      fitNow(chart, candles, host, applying);
    } else {
      applying.current = true;
      if (savedTime) chart.timeScale().setVisibleLogicalRange(savedTime);
      if (savedPrice) chart.priceScale("right").setVisibleRange(savedPrice);
      applying.current = false;
      keepLiveCandleInView(chart, candles);
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
    } else {
      keepLiveCandleInView(chart, candles);
    }
    publish(chart, candles, host, manual.current);
  }
  previous.current = candles;
  previousId.current = seriesId;
}
