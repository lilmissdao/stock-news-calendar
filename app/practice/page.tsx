import type { Metadata } from "next";
import { PracticeApp } from "@/components/PracticeApp";

export const metadata: Metadata = {
  title: "Day trading practice",
  description: "Replay recent TQQQ and SQQQ sessions and practice day trades.",
};

export default function Page() {
  return <PracticeApp />;
}
