import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pharma/Biotech",
  description: "Pharma and biotech news, drug rivalries, and binary-bet catalysts.",
};

export default function Page() {
  return <CalendarApp initialView="pharma" initialPharma="news" />;
}
