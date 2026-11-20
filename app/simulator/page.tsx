import type { Metadata } from "next";
import { SimulatorApp } from "@/components/SimulatorApp";

export const metadata: Metadata = {
  title: "Trading growth simulator",
  description: "Model compounding trading returns, drawdowns, and monthly deposits.",
};

export default function Page() {
  return <SimulatorApp />;
}
