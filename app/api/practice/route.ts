import snapshot from "@/data/practice-market.json";
import { fetchPracticeMarket } from "@/lib/practice-market";

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  if (!refresh) {
    return Response.json(snapshot, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  }
  try {
    const live = await fetchPracticeMarket();
    return Response.json(live, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return Response.json(snapshot, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
