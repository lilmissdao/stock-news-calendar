/**
 * Records real second-by-second TQQQ and SQQQ prices for each practice morning (9:30–10:00 ET) from Alpaca's
 * historical trades and writes public/practice-seconds/<date>.json for every day in data/practice-market.json that
 * doesn't have one yet.
 *
 * Auth: Alpaca reads APCA-API-KEY-ID and APCA-API-SECRET-KEY headers. They're sent from the APCA_API_KEY_ID and
 * APCA_API_SECRET_KEY environment variables when set; otherwise the cloud environment's network secrets add them.
 * The free plan serves SIP trades once they're 15 minutes old, so run it after 10:15 ET.
 */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import type { PracticeMarket } from "../lib/practice-market";
import { perSecond, SECONDS_DIR, SECONDS_PER_SESSION, type AlpacaTrade, type SessionSeconds } from "../lib/practice-seconds";

const API = "https://data.alpaca.markets/v2/stocks/trades";

function headers(): Record<string, string> {
  const id = process.env.APCA_API_KEY_ID;
  const secret = process.env.APCA_API_SECRET_KEY;
  return id && secret ? { "APCA-API-KEY-ID": id, "APCA-API-SECRET-KEY": secret } : {};
}

async function trades(start: number): Promise<Record<"TQQQ" | "SQQQ", AlpacaTrade[]>> {
  const out: Record<"TQQQ" | "SQQQ", AlpacaTrade[]> = { TQQQ: [], SQQQ: [] };
  let token: string | null = null;
  for (let page = 0; page < 2000; page += 1) {
    const params = new URLSearchParams({
      symbols: "TQQQ,SQQQ",
      start: new Date(start * 1000).toISOString(),
      end: new Date((start + SECONDS_PER_SESSION) * 1000).toISOString(),
      feed: "sip",
      limit: "10000",
      sort: "asc",
    });
    if (token) params.set("page_token", token);
    const response = await fetch(`${API}?${params}`, { headers: headers() });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      page -= 1;
      continue;
    }
    if (!response.ok) throw new Error(`Alpaca ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const body = (await response.json()) as { trades?: Record<string, AlpacaTrade[]>; next_page_token?: string | null };
    for (const symbol of ["TQQQ", "SQQQ"] as const) out[symbol].push(...(body.trades?.[symbol] ?? []));
    token = body.next_page_token ?? null;
    if (!token) return out;
  }
  throw new Error("Too many pages");
}

async function exists(path: URL): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const book = JSON.parse(await readFile(new URL("../data/practice-market.json", import.meta.url), "utf8")) as PracticeMarket;
  const dir = new URL(`../public/${SECONDS_DIR}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const only = process.argv[2];
  let wrote = 0;
  for (const day of book.days) {
    if (only && day.date !== only) continue;
    const file = new URL(`${day.date}.json`, dir);
    if (!only && (await exists(file))) continue;
    // Recent SIP trades need a paid plan; skip a morning until it's over 15 minutes old.
    if (Date.now() / 1000 < day.start + SECONDS_PER_SESSION + 16 * 60) continue;
    const got = await trades(day.start);
    if (got.TQQQ.length === 0 || got.SQQQ.length === 0) {
      console.log(`${day.date}: no trades returned, skipped`);
      continue;
    }
    const record: SessionSeconds = {
      date: day.date,
      source: "Alpaca SIP trades, median exchange-printed sale each second (no off-exchange TRF reports), 9:30:00–9:59:59 ET",
      tqqq: perSecond(got.TQQQ, day.start, day.tqqq[0][0]),
      sqqq: perSecond(got.SQQQ, day.start, day.sqqq[0][0]),
    };
    await writeFile(file, `${JSON.stringify(record)}\n`);
    wrote += 1;
    console.log(`${day.date}: ${got.TQQQ.length} TQQQ and ${got.SQQQ.length} SQQQ trades -> ${SECONDS_PER_SESSION} seconds each`);
  }
  console.log(`Recorded ${wrote} day(s) into public/${SECONDS_DIR}/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
