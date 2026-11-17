import type { Metadata } from "next";
import { CalendarApp } from "@/components/CalendarApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Neoclouds",
  description: "Neocloud revenue, backlog, capacity, and customer contracts.",
};

export default function Page() {
  return <CalendarApp initialView="enterprise" initialSection="neocloud" />;
}
