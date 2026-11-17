import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hyperscaler data centers",
  description: "Google, Meta, Microsoft, and Amazon data-center projects and capex.",
};

export default function Page() {
  return <CalendarApp initialView="enterprise" initialSection="datacenter" />;
}
