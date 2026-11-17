import { CalendarApp } from "@/components/CalendarApp";
import type { ViewId } from "@/lib/types";

export const dynamic = "force-dynamic";

const VIEWS = new Set<ViewId>(["calendar", "list", "ticker", "stocks", "connections"]);

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const params = await searchParams;
  const requested = params.view ?? "calendar";
  const initialView = VIEWS.has(requested as ViewId) ? (requested as ViewId) : "calendar";
  return <CalendarApp initialView={initialView} />;
}
