import type { GraphEdge, Point } from "./graph";
import type { GraphNode, LinkKind, NewsItem, Reliance } from "./types";

const RELIANCE_BAND: Record<Reliance, number> = {
  low: 18,
  medium: 26,
  high: 34,
  very_high: 44,
};

export const RIVALRY_CLUSTERS: { id: string; label: string }[] = [
  { id: "rrp", label: "Recurrent respiratory papillomatosis" },
  { id: "dmd", label: "Duchenne exon 51" },
  { id: "npc", label: "Niemann-Pick type C" },
  { id: "lems", label: "Lambert-Eaton myasthenic syndrome" },
  { id: "gpp", label: "Generalized pustular psoriasis" },
  { id: "epp", label: "Erythropoietic protoporphyria" },
  { id: "serd", label: "Oral SERDs · ER+ breast cancer" },
  { id: "monopoly", label: "No rival named yet" },
  { id: "pdufa", label: "First-ever-treatment PDUFAs" },
];

export type ClusterCaption = { label: string; x: number; y: number };

export function bubbleRadius(node: GraphNode): number {
  const base = node.reliance ? RELIANCE_BAND[node.reliance] : 15;
  if (node.market_cap_b == null || node.market_cap_b <= 0) return base;
  const scale = Math.min(1.2, Math.max(0.88, 1 + 0.22 * Math.log10(node.market_cap_b)));
  return Math.round(Math.min(50, Math.max(13, base * scale)));
}

export function legendRadius(reliance: Reliance | null): number {
  return reliance ? RELIANCE_BAND[reliance] : 15;
}

function slotWidth(node: GraphNode): number {
  const radius = bubbleRadius(node);
  const chars = Math.max(node.label.length, node.drug.length);
  return Math.max(radius * 2, chars * 6.6 + 12);
}

export function layoutRivalry(items: NewsItem[], width = 1100): {
  positions: Map<string, Point>;
  height: number;
  captions: ClusterCaption[];
} {
  const positions = new Map<string, Point>();
  const captions: ClusterCaption[] = [];
  let y = 22;
  const clusters = [
    ...RIVALRY_CLUSTERS,
    { id: "other", label: "Other" },
  ];
  for (const cluster of clusters) {
    const nodes = items
      .filter((item) => item.graph_node && (item.graph_node.cluster || "other") === cluster.id)
      .sort((a, b) => (a.graph_node?.order ?? 0) - (b.graph_node?.order ?? 0) || a.id.localeCompare(b.id));
    if (nodes.length === 0) continue;
    const radii = nodes.map((item) => bubbleRadius(item.graph_node as GraphNode));
    const slots = nodes.map((item) => slotWidth(item.graph_node as GraphNode));
    const maxR = Math.max(...radii);
    const gap = 28;
    const total = slots.reduce((sum, slot) => sum + slot, 0) + gap * (nodes.length - 1);
    let x = Math.max(36, (width - total) / 2);
    captions.push({ label: cluster.label, x: 28, y: y + 4 });
    const cy = y + 16 + maxR;
    nodes.forEach((item, index) => {
      positions.set(item.id, { x: x + slots[index] / 2, y: cy });
      x += slots[index] + gap;
    });
    y = cy + maxR + 48;
  }
  return { positions, height: Math.max(320, y + 16), captions };
}

const KIND_RANK: Record<LinkKind, number> = {
  rival: 1,
  royalty: 2,
  generic_threat: 3,
  unverified: 4,
};

export function rivalryEdges(items: NewsItem[]): GraphEdge[] {
  const ids = new Set(items.map((item) => item.id));
  const best = new Map<string, GraphEdge>();
  for (const item of items) {
    for (const [related, kind] of Object.entries(item.link_kinds)) {
      if (!kind || !ids.has(related) || related === item.id) continue;
      const source = item.id < related ? item.id : related;
      const target = item.id < related ? related : item.id;
      const key = `${source}|${target}`;
      const edge: GraphEdge = { source, target, kind };
      const prev = best.get(key);
      if (!prev || KIND_RANK[kind] > KIND_RANK[prev.kind ?? "rival"]) best.set(key, edge);
    }
  }
  return [...best.values()];
}
