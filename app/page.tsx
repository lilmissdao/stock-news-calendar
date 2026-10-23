import { App } from "@/components/App";
import raw from "@/data/news.json";
import { normalizeNews } from "@/lib/news";

export default function Page() {
  const items = normalizeNews(raw);
  return <App items={items} />;
}
