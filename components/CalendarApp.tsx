import { App } from "@/components/App";
import rawBinary from "@/data/binary-bets.json";
import rawNews from "@/data/news.json";
import rawTracker from "@/data/enterprise-ai.json";
import { loadBinary, mergeBinary } from "@/lib/binary";
import { loadTracker, mergeTracker } from "@/lib/enterprise";
import { todayInNewYork } from "@/lib/format";
import { normalizeNews } from "@/lib/news";
import type { TrackerSection, ViewId } from "@/lib/types";

export function CalendarApp({
  initialView = "calendar",
  initialSection = "deal",
}: {
  initialView?: ViewId;
  initialSection?: TrackerSection;
}) {
  const today = todayInNewYork();
  const tracker = loadTracker(rawTracker, today);
  const binary = loadBinary(rawBinary);
  const items = mergeBinary(mergeTracker(normalizeNews(rawNews), tracker), binary);
  return (
    <App
      items={items}
      today={today}
      companies={tracker.companies}
      binaryItems={binary.items}
      initialView={initialView}
      initialSection={initialSection}
    />
  );
}
