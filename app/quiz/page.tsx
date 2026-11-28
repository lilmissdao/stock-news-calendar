import type { Metadata } from "next";
import { QuizApp } from "@/components/QuizApp";

export const metadata: Metadata = {
  title: "Direction quiz",
  description: "Call TQQQ's next move on random turning-point days from the past year.",
};

export default function Page() {
  return <QuizApp />;
}
