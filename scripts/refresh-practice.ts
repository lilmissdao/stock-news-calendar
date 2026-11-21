import { readFile, writeFile } from "node:fs/promises";
import { fetchPracticeMarket, mergePracticeDays, type PracticeMarket } from "../lib/practice-market";

async function main() {
  const path = new URL("../data/practice-market.json", import.meta.url);
  let previous: PracticeMarket["days"] = [];
  try {
    previous = (JSON.parse(await readFile(path, "utf8")) as PracticeMarket).days ?? [];
  } catch {
    previous = [];
  }
  const live = await fetchPracticeMarket();
  const days = mergePracticeDays(previous, live.days);
  const market = { ...live, days };
  await writeFile(path, `${JSON.stringify(market)}\n`);
  const kept = days.length - live.days.length;
  console.log(`Wrote ${days.length} sessions to data/practice-market.json (${days[0]?.date} – ${days[days.length - 1]?.date}), kept ${kept} older than this fetch`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
