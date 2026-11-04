import { formatMove, formatPrice, formatShort } from "./format";
import type { NewsItem, StockCaution } from "./types";

export type Brief = {
  lead: string;
  bullets: string[];
};

export type BriefBeat = {
  id: string;
  date: string;
  title: string;
  summary: string;
  keyNumber: string;
  unverified: boolean;
};

const LONG_SUMMARY = 220;

const LEVEL_LABEL = { high: "High", medium: "Medium", low: "Watch" } as const;

export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tooSimilar(a: string, b: string): boolean {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.7) return true;
  const words = right.split(" ").filter((word) => word.length > 2);
  if (words.length === 0) return false;
  const titleWords = new Set(left.split(" "));
  const hits = words.filter((word) => titleWords.has(word)).length;
  return hits / words.length >= 0.6;
}

function isBareDate(fact: string): boolean {
  return /^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[.]?\s+\d{1,2}(?:,\s+\d{4})?[.]?$/i.test(
    fact.trim(),
  );
}

function finish(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function joinTitleFact(title: string, fact: string): string {
  const head = title.trim();
  const detail = fact.trim();
  if (!detail || isBareDate(detail) || tooSimilar(head, detail)) return finish(head);
  const glued = /[.!?]$/.test(head) ? `${head} ${detail}` : `${head}. ${detail}`;
  return finish(glued);
}

export function itemBrief(item: { title: string; summary: string; key_number: string }): string | null {
  const summary = item.summary.trim();
  if (!summary) return null;
  const parts = sentences(summary);
  const first = parts[0] ?? "";
  const long = summary.length >= LONG_SUMMARY || parts.length >= 3;
  if (long && parts.length >= 2 && first.length >= 40 && summary.length - first.length >= 40) return first;
  const key = item.key_number.trim();
  if (long && key && key.length + 40 < summary.length && !tooSimilar(first || summary, key)) return key;
  return null;
}

function score(item: NewsItem): number {
  let value = 0;
  if (item.move_pct != null) value += 4;
  if (item.price_mentioned) value += 3;
  if (item.key_number.trim()) value += 3;
  if (item.tickers.length > 0) value += 2;
  if (item.status === "upcoming") value += 2;
  if (item.status === "developing") value += 1;
  return value;
}

function dayFact(item: NewsItem): string {
  const key = item.key_number.trim();
  if (key) return key;
  if (item.move_pct != null) {
    const move = formatMove(item.move_pct);
    const price = item.price_mentioned;
    return price ? `${move}, ${price.ticker} ${formatPrice(price.price)}` : move;
  }
  if (item.price_mentioned) return `${item.price_mentioned.ticker} ${formatPrice(item.price_mentioned.price)}`;
  return "";
}

function dayBullet(item: NewsItem): string {
  const tag = item.status === "upcoming" ? "Ahead" : item.status === "developing" ? "Still open" : "Happened";
  const who = item.tickers.slice(0, 3).join(", ") || item.industry;
  return `${tag}. ${who}: ${joinTitleFact(item.title, dayFact(item))}`;
}

function countPhrase(items: NewsItem[]): string {
  const ahead = items.filter((item) => item.status === "upcoming").length;
  const open = items.filter((item) => item.status === "developing").length;
  const done = items.length - ahead - open;
  const parts: string[] = [];
  if (done) parts.push(`${done} happened`);
  if (open) parts.push(`${open} still open`);
  if (ahead) parts.push(`${ahead} coming up`);
  return parts.join(", ");
}

export function dayBrief(items: NewsItem[]): Brief | null {
  const visible = items.filter((item) => !item.graph_only && item.title.trim());
  if (visible.length === 0) return null;
  const ranked = [...visible].sort((a, b) => {
    const diff = score(b) - score(a);
    if (diff) return diff;
    const move = Math.abs(b.move_pct ?? 0) - Math.abs(a.move_pct ?? 0);
    if (move) return move;
    return a.title.localeCompare(b.title);
  });
  const limit = Math.min(5, ranked.length);
  const happened = ranked.filter((item) => item.status !== "upcoming");
  const ahead = ranked.filter((item) => item.status === "upcoming");
  const picked: NewsItem[] = [];
  if (happened.length > 0 && ahead.length > 0 && limit > 1) {
    const aheadSlots = Math.min(2, ahead.length, limit - 1);
    const pastSlots = Math.min(happened.length, limit - aheadSlots);
    picked.push(...happened.slice(0, pastSlots), ...ahead.slice(0, aheadSlots));
  }
  for (const item of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  const ordered = [
    ...picked.filter((item) => item.status !== "upcoming"),
    ...picked.filter((item) => item.status === "upcoming"),
  ];
  const more = visible.length > ordered.length ? ` Calling out ${ordered.length} of ${visible.length}.` : "";
  return {
    lead: `${countPhrase(visible)}.${more}`,
    bullets: ordered.map(dayBullet),
  };
}

function beatFact(beat: BriefBeat): string {
  const key = beat.keyNumber.trim();
  if (key) return key;
  const first = sentences(beat.summary)[0] ?? "";
  if (first && first.length <= 180) return first;
  return "";
}

function beatLine(kind: "Past" | "Ahead", beat: BriefBeat): string {
  const when = formatShort(beat.date);
  const flag = beat.unverified ? " Not confirmed." : "";
  return `${kind}, ${when}: ${joinTitleFact(beat.title, beatFact(beat))}${flag}`;
}

function cautionLine(caution: StockCaution): string {
  const first = sentences(caution.reason)[0] ?? caution.reason.trim();
  const reason = first.length <= 180 ? first : "";
  const level = LEVEL_LABEL[caution.level];
  return `Risk, ${level}: ${joinTitleFact(caution.title, reason)}`;
}

export function stockBrief(input: {
  ticker: string;
  history: BriefBeat[];
  coming: BriefBeat[];
  cautions: StockCaution[];
}): Brief | null {
  const { ticker, history, coming, cautions } = input;
  if (history.length === 0 && coming.length === 0 && cautions.length === 0) return null;
  const past = history.slice(0, 2).map((beat) => beatLine("Past", beat));
  const ahead = coming.slice(0, 2).map((beat) => beatLine("Ahead", beat));
  const risks = [...cautions]
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.level] - rank[b.level] || a.title.localeCompare(b.title);
    })
    .slice(0, 2)
    .map(cautionLine);
  const picked: string[] = [];
  for (const bucket of [past, ahead, risks]) {
    if (bucket[0]) picked.push(bucket[0]);
  }
  for (const bucket of [past, ahead, risks]) {
    for (const line of bucket.slice(1)) {
      if (picked.length >= 5) break;
      picked.push(line);
    }
  }
  const pastLabel = history.length === 1 ? "1 dated event on file" : `${history.length} dated events on file`;
  const aheadLabel = coming.length === 1 ? "1 dated event ahead" : `${coming.length} dated events ahead`;
  const riskLabel = cautions.length === 1 ? "1 outside caution" : `${cautions.length} outside cautions`;
  return {
    lead: `${ticker}: ${pastLabel}, ${aheadLabel}, ${riskLabel}.`,
    bullets: picked.slice(0, 5),
  };
}

export function sameIds(stored: string[], current: string[]): boolean {
  if (stored.length !== current.length) return false;
  const left = [...stored].sort();
  const right = [...current].sort();
  return left.every((id, index) => id === right[index]);
}
