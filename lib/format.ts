import type { NewsItem } from "./types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function toISODate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatPretty(iso: string): string {
  const date = parseISODate(iso);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export function formatShort(iso: string): string {
  const date = parseISODate(iso);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function formatMonth(year: number, month: number): string {
  return `${MONTHS_LONG[month]} ${year}`;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function daysBetween(earlier: string, later: string): number {
  const ms = parseISODate(later).getTime() - parseISODate(earlier).getTime();
  return Math.round(ms / 86_400_000);
}

export function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks: Date[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: Date[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  while (weeks.length > 4 && weeks[weeks.length - 1].every((date) => date.getMonth() !== month)) {
    weeks.pop();
  }
  return weeks;
}

export function formatPrice(price: number): string {
  const text = Number.isInteger(price) ? price.toLocaleString("en-US") : String(price);
  return `$${text}`;
}

export function formatMove(move: number): string {
  return move > 0 ? `+${move}%` : `${move}%`;
}

export function precisionLabel(item: NewsItem): string | null {
  if (item.date_precision === "day") return null;
  const date = parseISODate(item.date);
  if (item.date_precision === "month") {
    return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()} · month precision`;
  }
  if (item.date_precision === "quarter") {
    const quarter = Math.floor(date.getMonth() / 3) + 1;
    return `Q${quarter} ${date.getFullYear()} · quarter precision`;
  }
  return "Date uncertain";
}

export function inNextDays(iso: string, today: string, days = 14): boolean {
  const end = addDaysISO(today, days);
  return iso >= today && iso < end;
}
