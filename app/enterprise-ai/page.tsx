import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Enterprise AI deals",
  description: "Enterprise AI deals, neocloud capacity, and hyperscaler data-center buildouts.",
};

export default function Page() {
  return <CalendarApp initialView="enterprise" initialSection="deal" />;
}
