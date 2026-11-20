import { writeFile } from "node:fs/promises";
import { fetchPracticeMarket } from "../lib/practice-market";

async function main() {
  const market = await fetchPracticeMarket();
  const path = new URL("../data/practice-market.json", import.meta.url);
  await writeFile(path, `${JSON.stringify(market)}\n`);
  console.log(`Wrote ${market.days.length} sessions to data/practice-market.json (${market.days[0].date} – ${market.days[market.days.length - 1].date})`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
