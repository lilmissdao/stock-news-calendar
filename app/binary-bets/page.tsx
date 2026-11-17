import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Binary Bets",
  description: "Small and mid-cap biotech catalysts where one FDA date or Phase 3 readout can reprice the stock.",
};

export default function Page() {
  return <CalendarApp initialView="binary" />;
}
