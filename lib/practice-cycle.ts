export const CYCLE_KEY = "snc-practice-cycle:v1";

export type CycleFile = { v: 1; generation: number; dates: string[] };

export function emptyCycle(): CycleFile {
  return { v: 1, generation: 0, dates: [] };
}

export function parseCycle(raw: string | null): CycleFile {
  if (!raw) return emptyCycle();
  try {
    const parsed = JSON.parse(raw) as Partial<CycleFile>;
    const dates = Array.isArray(parsed.dates) ? parsed.dates.filter((date): date is string => typeof date === "string" && date.length > 0) : [];
    return {
      v: 1,
      generation: Number.isFinite(parsed.generation) ? Math.max(0, Math.floor(Number(parsed.generation))) : 0,
      dates: [...new Set(dates)],
    };
  } catch {
    return emptyCycle();
  }
}

/** Uniform index in `[0, span)`. Rejects values that would favor the ends. */
export function uniformIndex(span: number, nextUint: () => number): number {
  if (span <= 1) return 0;
  const limit = Math.floor(0x1_0000_0000 / span) * span;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const roll = nextUint() >>> 0;
    if (roll < limit) return roll % span;
  }
  return (nextUint() >>> 0) % span;
}

export function cryptoUint(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}

/** Fisher–Yates. Not a seeded sequence, and neither end of the list is favored. */
export function shuffle<T>(items: readonly T[], nextUint: () => number = cryptoUint): T[] {
  const copy = items.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = uniformIndex(index + 1, nextUint);
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

function knownDates(book: readonly string[], dates: readonly string[]): string[] {
  const known = new Set(book);
  return [...new Set(dates.filter((date) => known.has(date)))];
}

/** Dates she should not be dealt again in this cycle. Generation 0 also reads every saved game. */
export function blockedDates(book: readonly string[], historyDates: readonly string[], cycle: CycleFile): string[] {
  const reserved = knownDates(book, cycle.dates);
  if (cycle.generation > 0) return reserved;
  return [...new Set([...knownDates(book, historyDates), ...reserved])];
}

export function freshCount(book: readonly string[], historyDates: readonly string[], cycle: CycleFile): number {
  const blocked = new Set(blockedDates(book, historyDates, cycle));
  return book.filter((date) => !blocked.has(date)).length;
}

/** Days still new this cycle, counting the one on screen before she plays it. */
export function freshLeft(book: readonly string[], historyDates: readonly string[], cycle: CycleFile, current = ""): number {
  const open = freshCount(book, historyDates, cycle);
  const blocked = new Set(blockedDates(book, historyDates, cycle));
  return Math.min(book.length, open + (current && blocked.has(current) ? 1 : 0));
}

/**
 * Deal one session she has not had this cycle.
 * History supplies the first cycle. When that deck is empty, the next deal starts a new cycle.
 */
export function drawSession(
  book: readonly string[],
  historyDates: readonly string[],
  cycle: CycleFile,
  avoid = "",
  nextUint: () => number = cryptoUint,
): { date: string; cycle: CycleFile; fresh: number } {
  if (book.length === 0) return { date: "", cycle, fresh: 0 };
  let generation = cycle.generation;
  let reserved = knownDates(book, cycle.dates);
  let blocked = new Set(generation > 0 ? reserved : [...knownDates(book, historyDates), ...reserved]);
  let open = book.filter((date) => !blocked.has(date));
  if (open.length === 0) {
    generation += 1;
    reserved = [];
    open = avoid && book.length > 1 ? book.filter((date) => date !== avoid) : book.slice();
  }
  const date = shuffle(open, nextUint)[0] ?? book[0];
  const dates = [...new Set([...reserved, date])];
  const next: CycleFile = { v: 1, generation, dates };
  return { date, cycle: next, fresh: freshCount(book, historyDates, next) };
}
