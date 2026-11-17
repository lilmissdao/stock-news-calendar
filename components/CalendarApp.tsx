import { App } from "@/components/App";
import rawNews from "@/data/news.json";
import rawTracker from "@/data/enterprise-ai.json";
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
  const items = mergeTracker(normalizeNews(rawNews), tracker);
  return (
    <App
      items={items}
      today={today}
      companies={tracker.companies}
      initialView={initialView}
      initialSection={initialSection}
    />
  );
}
