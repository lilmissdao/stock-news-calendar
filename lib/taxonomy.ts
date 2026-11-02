import type { LinkKind, Reliance, Story } from "./types";

export const INDUSTRY_COLORS: Record<string, string> = {
  Semiconductors: "#0f8f86",
  "AI/Cloud": "#5b6cff",
  "Pharma/Biotech": "#d4537e",
  "Biotech / rare disease": "#9a3d78",
  Energy: "#e07a3d",
  Defense: "#3d7ec9",
  Macro: "#8a8175",
  Policy: "#8b6cc4",
  Financials: "#2f9e6b",
  Consumer: "#c4922a",
  Telecom: "#3aa0c9",
  Autos: "#d35a48",
  Space: "#7a6adf",
  Geopolitics: "#c44b4b",
};

const FALLBACK = ["#0f8f86", "#5b6cff", "#d4537e", "#e07a3d", "#3d7ec9", "#8b6cc4", "#2f9e6b", "#c4922a"];

export function industryColor(industry: string): string {
  if (INDUSTRY_COLORS[industry]) return INDUSTRY_COLORS[industry];
  let hash = 0;
  for (const char of industry) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK[hash % FALLBACK.length];
}

const EVENT_LABELS: Record<string, string> = {
  earnings: "Earnings",
  fda: "FDA",
  trial: "Trial",
  fed: "Fed",
  macro_data: "Macro data",
  policy: "Policy",
  deal: "Deal",
  ipo: "IPO",
  lockup: "Lockup",
  analyst: "Analyst",
  market_move: "Market move",
  geopolitics: "Geopolitics",
  other: "Other",
};

const EVENT_ORDER = Object.keys(EVENT_LABELS);

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.replaceAll("_", " ");
}

export function sortEventTypes(types: string[]): string[] {
  return [...types].sort((a, b) => {
    const ai = EVENT_ORDER.indexOf(a);
    const bi = EVENT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

export const STATUS_LABELS = {
  happened: "Happened",
  upcoming: "Upcoming",
  developing: "Developing",
} as const;

export const RELIANCE_LABELS: Record<Reliance, string> = {
  very_high: "Very high · only product",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const LINK_LABELS: Record<LinkKind, string> = {
  rival: "Rival drug",
  generic_threat: "Generic threat",
  royalty: "Royalty or license",
  unverified: "Unverified link",
};

export const STORIES: Story[] = [
  {
    id: "drug-rivalries",
    title: "Biotech drug rivalries",
    blurb:
      "As of Oct 31, 2026. Each bubble is a company and a drug. Bigger means the company relies on that drug more, with a nudge from any market cap that was stated. A solid line is a rival drug, a dashed line is a generic threat, a dotted line is a royalty, and a faint dashed line was not verified. Dated decisions sit on the calendar. Filter to Biotech / rare disease to see only this set.",
    columns: [],
  },
  {
    id: "capex",
    title: "Meta capex → NVDA → CoreWeave → rates",
    blurb: "Recorded links: Meta’s cash burn and stock raise, Nvidia’s $3B investment and backstops, CoreWeave and the other neoclouds, OpenAI’s funding shortfall, Oracle’s Friday close, bond yields, and the Fed.",
    columns: [
      ["2026-10-22-meta-q3", "2026-10-26-meta-raise"],
      ["2026-10-23-nvda-drop", "2026-10-26-nvda-backstops", "2026-10-27-nvda-meta-3b"],
      ["2026-10-23-crwv-drop", "2026-10-22-dc-debt-frozen", "2026-10-26-neoclouds", "2026-10-26-spcx-gpu-debt", "2026-10-30-openai-shortfall", "2026-10-30-orcl-close"],
      ["2026-10-22-bond-yields"],
      ["2026-10-28-fed-decision"],
    ],
  },
  {
    id: "iran",
    title: "Iran / oil → airlines & defense",
    blurb: "Recorded links: the oil shock, the Oct 26 pullback, the Oct 27 highs and the Nov 2 drop on an Iran-Qatar draft, reported Iran strikes and the Tehran talks, JetBlue, Boeing, Lockheed, the FY27 defense request, energy earnings, and the Fed.",
    columns: [
      ["2026-10-22-futures-iran-oil", "2026-10-26-oil-pullback", "2026-10-27-oil-iran", "2026-11-02-oil-iran"],
      ["2026-11-03-iran-strikes-plan", "2026-10-26-tehran-talks", "2026-10-27-israel-election"],
      ["2026-10-26-jblu-earnings", "2026-10-22-lmt-earnings", "2026-10-27-lmt-f35", "2026-11-02-defense-budget", "2026-10-27-ba-earnings", "2026-10-30-energy-earnings"],
      ["2026-10-28-fed-decision"],
    ],
  },
];
