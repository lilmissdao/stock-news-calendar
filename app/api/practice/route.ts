import snapshot from "@/data/practice-market.json";
import { fetchPracticeMarket, isPlayableDay, mergePracticeDays, type PracticeMarket } from "@/lib/practice-market";

const BOOK = snapshot as PracticeMarket;

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!refresh) {
    return Response.json(snapshot, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  }
  try {
    const live = await fetchPracticeMarket();
    const merged = { ...live, days: mergePracticeDays(BOOK.days.filter(isPlayableDay), live.days) };
    return Response.json(merged, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json(BOOK, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
