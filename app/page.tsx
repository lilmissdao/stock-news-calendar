import { App } from "@/components/App";
import raw from "@/data/news.json";
import { todayInNewYork } from "@/lib/format";
import { normalizeNews } from "@/lib/news";

export const dynamic = "force-dynamic";

export default function Page() {
  const items = normalizeNews(raw);
  return <App items={items} today={todayInNewYork()} />;
}
