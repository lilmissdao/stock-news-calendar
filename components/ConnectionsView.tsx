import { useEffect, useMemo, useRef, useState } from "react";
import { formatShort } from "@/lib/format";
import { edgeKey, layoutForce, undirectedEdges, type GraphEdge, type Point } from "@/lib/graph";
import { industryColor, STORIES } from "@/lib/taxonomy";
import type { NewsItem } from "@/lib/types";

const WORLD = { width: 1100, height: 680 };
const HOME = { x: 0, y: 0, w: WORLD.width, h: WORLD.height };

type Camera = { x: number; y: number; w: number; h: number };

export function ConnectionsView({
  items,
  byId,
  selectedId,
  onOpen,
}: {
  items: NewsItem[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const [storyId, setStoryId] = useState<string>("capex");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const edges = useMemo(() => undirectedEdges(items), [items]);
  const linkedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return [...ids];
  }, [edges]);
  const isolates = items.filter((item) => !linkedIds.includes(item.id));
  const story = STORIES.find((entry) => entry.id === storyId) ?? null;

  return (
    <div className="graph-view">
      <div className="graph-tools">
        <button type="button" aria-pressed={storyId === "all"} onClick={() => setStoryId("all")}>
          All links
        </button>
        {STORIES.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={storyId === entry.id} onClick={() => setStoryId(entry.id)}>
            {entry.title}
          </button>
        ))}
      </div>
      {story ? (
        <StoryGraph storyId={story.id} items={items} byId={byId} selectedId={selectedId} onOpen={onOpen} />
      ) : (
        <ForceGraph
          ids={linkedIds}
          edges={edges}
          byId={byId}
          selectedId={selectedId}
          hover={hover}
          onHover={setHover}
          onOpen={onOpen}
        />
      )}
      <Legend items={items} />
      {storyId === "all" && isolates.length > 0 ? (
        <section className="isolates">
          <h3>No links to other visible items</h3>
          <ul>
            {isolates.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpen(item.id)}>
                  <i style={{ background: industryColor(item.industry) }} aria-hidden="true" />
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {hover && byId.get(hover.id) ? (
        <div className="tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {byId.get(hover.id)?.title}
        </div>
      ) : null}
    </div>
  );
}

function StoryGraph({
  storyId,
  items,
  byId,
  selectedId,
  onOpen,
}: {
  storyId: string;
  items: NewsItem[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  onOpen: (id: string) => void;
}) {
  const story = STORIES.find((entry) => entry.id === storyId)!;
  const present = new Set(items.map((item) => item.id));
  const columns = story.columns.map((column) => column.filter((id) => present.has(id))).filter((column) => column.length > 0);
  const ids = columns.flat();
  const positions = new Map<string, Point>();
  const columnCount = columns.length;
  columns.forEach((column, index) => {
    const x = columnCount === 1 ? WORLD.width / 2 : 150 + (index * (WORLD.width - 300)) / (columnCount - 1);
    const gap = Math.min(150, (WORLD.height - 180) / Math.max(column.length, 1));
    const start = WORLD.height / 2 - (gap * (column.length - 1)) / 2;
    column.forEach((id, row) => positions.set(id, { x, y: start + row * gap }));
  });
  const edges = undirectedEdges(items.filter((item) => ids.includes(item.id)));
  const hidden = story.columns.flat().filter((id) => byId.has(id) && !present.has(id));

  if (ids.length === 0) {
    return <p className="empty">This chain is hidden by the current filters.</p>;
  }

  return (
    <div>
      <p className="story-blurb">{story.blurb}</p>
      <div className="graph-scroll">
      <svg className="graph" viewBox={`0 0 ${WORLD.width} ${WORLD.height}`} aria-label={story.title}>
        <ArrowDef />
        {edges.map((edge) => {
          const a = positions.get(edge.source);
          const b = positions.get(edge.target);
          if (!a || !b) return null;
          const start = boxEdge(a, b, 92, 36);
          const end = boxEdge(b, a, 92, 36);
          return (
            <line
              key={edgeKey(edge)}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className="link story-link"
              markerEnd="url(#arrow)"
            />
          );
        })}
        {ids.map((id) => {
          const item = byId.get(id);
          const point = positions.get(id);
          if (!item || !point) return null;
          return (
            <foreignObject key={id} x={point.x - 92} y={point.y - 36} width={184} height={72}>
              <button
                type="button"
                className={selectedId === id ? "node-card selected" : "node-card"}
                onClick={() => onOpen(id)}
              >
                <i style={{ background: industryColor(item.industry) }} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {formatShort(item.date)} · {item.industry}
                  </small>
                </span>
              </button>
            </foreignObject>
          );
        })}
      </svg>
      </div>
      <ol className="story-steps">
        {ids.map((id, index) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li key={id}>
              <button type="button" onClick={() => onOpen(id)}>
                <span>{index + 1}</span>
                {item.title}
              </button>
            </li>
          );
        })}
      </ol>
      {hidden.length > 0 ? <p className="chart-note">{hidden.length} item{hidden.length === 1 ? "" : "s"} in this chain are hidden by filters.</p> : null}
    </div>
  );
}

function ForceGraph({
  ids,
  edges,
  byId,
  selectedId,
  hover,
  onHover,
  onOpen,
}: {
  ids: string[];
  edges: GraphEdge[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  hover: { id: string; x: number; y: number } | null;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  onOpen: (id: string) => void;
}) {
  const signature = `${ids.join("|")}#${edges.map(edgeKey).join("|")}`;
  const laidOut = useMemo(() => layoutForce(ids, edges, WORLD.width, WORLD.height), [signature, ids, edges]);
  const [pos, setPos] = useState<Map<string, Point>>(laidOut);
  const [cam, setCam] = useState<Camera>(HOME);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; moved: boolean } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  useEffect(() => {
    setPos(laidOut);
    setCam(HOME);
  }, [laidOut]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = (event.clientX - rect.left) / rect.width;
      const py = (event.clientY - rect.top) / rect.height;
      setCam((current) => zoomAt(current, event.deltaY > 0 ? 1.08 : 0.92, px, py));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [ids.length]);

  const neighborIds = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover.id]);
    for (const edge of edges) {
      if (edge.source === hover.id) set.add(edge.target);
      if (edge.target === hover.id) set.add(edge.source);
    }
    return set;
  }, [edges, hover]);

  function toWorld(event: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const current = camRef.current;
    return {
      x: current.x + ((event.clientX - rect.left) / rect.width) * current.w,
      y: current.y + ((event.clientY - rect.top) / rect.height) * current.h,
    };
  }

  if (ids.length === 0) return <p className="empty">No linked items match these filters.</p>;

  return (
    <div className="graph-frame">
      <div className="zoom">
        <button type="button" onClick={() => setCam((current) => zoomAt(current, 0.85, 0.5, 0.5))} aria-label="Zoom in">
          +
        </button>
        <button type="button" onClick={() => setCam((current) => zoomAt(current, 1.15, 0.5, 0.5))} aria-label="Zoom out">
          −
        </button>
        <button type="button" onClick={() => setCam(HOME)}>
          Fit
        </button>
      </div>
      <div className="graph-scroll">
      <svg
        ref={svgRef}
        className="graph"
        viewBox={`${cam.x} ${cam.y} ${cam.w} ${cam.h}`}
        aria-label="News items linked by related ids"
        onPointerDown={(event) => {
          const target = event.target as Element;
          const node = target.closest("[data-node]");
          const world = toWorld(event);
          if (node) {
            drag.current = { kind: "node", id: node.getAttribute("data-node") ?? "", x: world.x, y: world.y, moved: false };
          } else {
            drag.current = { kind: "pan", x: event.clientX, y: event.clientY, moved: false };
          }
          (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          if (current.kind === "pan") {
            const rect = svgRef.current!.getBoundingClientRect();
            const dx = ((event.clientX - current.x) / rect.width) * camRef.current.w;
            const dy = ((event.clientY - current.y) / rect.height) * camRef.current.h;
            if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3) current.moved = true;
            current.x = event.clientX;
            current.y = event.clientY;
            setCam((camera) => ({ ...camera, x: camera.x - dx, y: camera.y - dy }));
            return;
          }
          const world = toWorld(event);
          if (Math.hypot(world.x - current.x, world.y - current.y) > 3) current.moved = true;
          const id = current.id!;
          setPos((prev) => {
            const next = new Map(prev);
            const point = next.get(id);
            if (!point) return prev;
            next.set(id, { x: point.x + (world.x - current.x), y: point.y + (world.y - current.y) });
            return next;
          });
          current.x = world.x;
          current.y = world.y;
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          drag.current = null;
          if (current?.kind === "node" && current.id && !current.moved) onOpen(current.id);
          if (current?.kind === "node" && current.id) onHover({ id: current.id, x: event.clientX, y: event.clientY });
        }}
        onPointerLeave={() => onHover(null)}
      >
        {edges.map((edge) => {
          const a = pos.get(edge.source);
          const b = pos.get(edge.target);
          if (!a || !b) return null;
          const start = circleEdge(a, b, 16);
          const end = circleEdge(b, a, 16);
          const dim = neighborIds && !(neighborIds.has(edge.source) && neighborIds.has(edge.target));
          return <line key={edgeKey(edge)} x1={start.x} y1={start.y} x2={end.x} y2={end.y} className={dim ? "link dim" : "link"} />;
        })}
        {ids.map((id) => {
          const item = byId.get(id);
          const point = pos.get(id);
          if (!item || !point) return null;
          const dim = neighborIds ? !neighborIds.has(id) : false;
          return (
            <g
              key={id}
              data-node={id}
              className={dim ? "gnode dim" : "gnode"}
              onPointerEnter={(event) => onHover({ id, x: event.clientX, y: event.clientY })}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={selectedId === id ? 16 : 13}
                fill={industryColor(item.industry)}
                className={selectedId === id ? "selected" : ""}
              />
              <text x={point.x} y={point.y + 24} textAnchor="middle" className="node-label">
                {item.tickers[0] ?? item.industry}
              </text>
              <title>{item.title}</title>
            </g>
          );
        })}
      </svg>
      </div>
      <p className="chart-note">Drag the background to pan, drag a node to move it, and click a node for the write-up. {ids.length} linked items, {edges.length} links.</p>
    </div>
  );
}

function Legend({ items }: { items: NewsItem[] }) {
  const industries = [...new Set(items.map((item) => item.industry))].sort();
  return (
    <ul className="legend">
      {industries.map((industry) => (
        <li key={industry}>
          <i style={{ background: industryColor(industry) }} />
          {industry}
        </li>
      ))}
    </ul>
  );
}

function ArrowDef() {
  return (
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" className="arrow-head" />
      </marker>
    </defs>
  );
}

function boxEdge(from: Point, to: Point, halfW: number, halfH: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const t = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  const clamped = Math.min(0.92, t);
  return { x: from.x + dx * clamped, y: from.y + dy * clamped };
}

function circleEdge(from: Point, to: Point, radius: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / dist) * radius, y: from.y + (dy / dist) * radius };
}

function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
  const nextW = Math.min(2200, Math.max(420, camera.w * factor));
  const nextH = nextW * (HOME.h / HOME.w);
  const mx = camera.x + px * camera.w;
  const my = camera.y + py * camera.h;
  return { x: mx - px * nextW, y: my - py * nextH, w: nextW, h: nextH };
}
