import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Biotech drug rivalries",
  description: "Company and drug bubbles for rivalries, generic threats, and royalties.",
};

export default function Page() {
  return <CalendarApp initialView="pharma" initialPharma="rivalries" />;
}
