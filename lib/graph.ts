import type { NewsItem } from "./types";

export type GraphEdge = { source: string; target: string };
export type Point = { x: number; y: number };

export function undirectedEdges(items: NewsItem[]): GraphEdge[] {
  const ids = new Set(items.map((item) => item.id));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const item of items) {
    for (const related of item.related_ids) {
      if (!ids.has(related) || related === item.id) continue;
      const source = item.id < related ? item.id : related;
      const target = item.id < related ? related : item.id;
      const key = `${source}|${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target });
    }
  }
  return edges;
}

export function layoutForce(ids: string[], edges: GraphEdge[], width: number, height: number): Map<string, Point> {
  const count = ids.length;
  const positions = new Map<string, Point>();
  if (count === 0) return positions;
  const cols = Math.ceil(Math.sqrt(count * (width / height)));
  const nodes = ids.map((id, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rows = Math.ceil(count / cols);
    return {
      id,
      x: ((col + 0.5) / cols) * width,
      y: ((row + 0.5) / rows) * height,
      vx: 0,
      vy: 0,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pairs = edges.flatMap((edge) => {
    const a = byId.get(edge.source);
    const b = byId.get(edge.target);
    return a && b ? ([[a, b]] as const) : [];
  });
  const margin = 46;
  const k = Math.sqrt((width * height) / count);
  const iterations = 360;
  for (let iter = 0; iter < iterations; iter += 1) {
    const temperature = (1 - iter / iterations) * Math.min(width, height) * 0.06;
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.1) {
          dx = (i % 5) - 2 || 0.5;
          dy = (j % 5) - 2 || -0.5;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        a.vx += (dx / dist) * force;
        a.vy += (dy / dist) * force;
        b.vx -= (dx / dist) * force;
        b.vy -= (dy / dist) * force;
      }
    }
    for (const [a, b] of pairs) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 0.1;
      const force = (dist * dist) / k;
      a.vx -= (dx / dist) * force;
      a.vy -= (dy / dist) * force;
      b.vx += (dx / dist) * force;
      b.vy += (dy / dist) * force;
    }
    for (const node of nodes) {
      const disp = Math.hypot(node.vx, node.vy) || 1;
      node.x += (node.vx / disp) * Math.min(disp, temperature);
      node.y += (node.vy / disp) * Math.min(disp, temperature);
      node.x = Math.max(margin, Math.min(width - margin, node.x));
      node.y = Math.max(margin, Math.min(height - margin, node.y));
      node.vx = 0;
      node.vy = 0;
    }
  }
  const minDist = 34;
  for (let pass = 0; pass < 50; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 0.1) {
          dx = (j % 5) - 2 || 1;
          dy = (i % 5) - 2 || -1;
          dist = Math.hypot(dx, dy);
        }
        const push = (minDist - dist) / 2;
        a.x -= (dx / dist) * push;
        a.y -= (dy / dist) * push;
        b.x += (dx / dist) * push;
        b.y += (dy / dist) * push;
      }
    }
    for (const node of nodes) {
      node.x = Math.max(margin, Math.min(width - margin, node.x));
      node.y = Math.max(margin, Math.min(height - margin, node.y));
    }
  }
  for (const node of nodes) positions.set(node.id, { x: node.x, y: node.y });
  return positions;
}

export function edgeKey(edge: GraphEdge): string {
  return edge.source < edge.target ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`;
}
