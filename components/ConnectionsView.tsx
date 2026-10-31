import { useEffect, useMemo, useRef, useState } from "react";
import { formatMarketCap, formatShort } from "@/lib/format";
import { edgeKey, layoutForce, undirectedEdges, type GraphEdge, type Point } from "@/lib/graph";
import { bubbleRadius, layoutRivalry, legendRadius, rivalryEdges, type ClusterCaption } from "@/lib/rivalry";
import { industryColor, LINK_LABELS, RELIANCE_LABELS, STORIES } from "@/lib/taxonomy";
import type { LinkKind, NewsItem, Reliance } from "@/lib/types";

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
  const linkItems = useMemo(() => items.filter((item) => !item.graph_only), [items]);
  const edges = useMemo(() => undirectedEdges(linkItems), [linkItems]);
  const linkedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      ids.add(edge.source);
      ids.add(edge.target);
    }
    return [...ids];
  }, [edges]);
  const isolates = linkItems.filter((item) => !linkedIds.includes(item.id));
  const story = STORIES.find((entry) => entry.id === storyId) ?? null;
  const rivalryCount = items.filter((item) => item.graph_node).length;

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
      {story?.id === "drug-rivalries" ? (
        <RivalryGraph items={items} byId={byId} selectedId={selectedId} hover={hover} onHover={setHover} onOpen={onOpen} />
      ) : story ? (
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
      {story?.id === "drug-rivalries" ? null : <Legend items={linkItems} />}
      {storyId === "all" && rivalryCount > 0 ? (
        <p className="chart-note">Sized drug-rivalry bubbles are on Biotech drug rivalries. Bubble size is reliance on that drug.</p>
      ) : null}
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
          {tipText(byId.get(hover.id) as NewsItem)}
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
  preset,
  world = WORLD,
  captions = [],
  sized = false,
}: {
  ids: string[];
  edges: GraphEdge[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  hover: { id: string; x: number; y: number } | null;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  onOpen: (id: string) => void;
  preset?: Map<string, Point>;
  world?: { width: number; height: number };
  captions?: ClusterCaption[];
  sized?: boolean;
}) {
  const home = { x: 0, y: 0, w: world.width, h: world.height };
  const signature = `${ids.join("|")}#${edges.map(edgeKey).join("|")}#${world.width}x${world.height}#${sized ? "sized" : "plain"}`;
  const laidOut = useMemo(
    () => preset ?? layoutForce(ids, edges, world.width, world.height),
    [signature, ids, edges, preset, world.width, world.height],
  );
  const [pos, setPos] = useState<Map<string, Point>>(laidOut);
  const [cam, setCam] = useState<Camera>(home);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; x: number; y: number; moved: boolean } | null>(null);
  const camRef = useRef(cam);
  camRef.current = cam;

  useEffect(() => {
    setPos(laidOut);
    setCam(home);
  }, [laidOut, home.w, home.h]);

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
        <button type="button" onClick={() => setCam(home)}>
          Fit
        </button>
      </div>
      <div className="graph-scroll">
      <svg
        ref={svgRef}
        className="graph"
        viewBox={`${cam.x} ${cam.y} ${cam.w} ${cam.h}`}
        aria-label={sized ? "Drug rivalry map. Bubble size shows reliance on the drug." : "News items linked by related ids"}
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
        {captions.map((caption) => (
          <text key={caption.label} x={caption.x} y={caption.y} className="cluster-label">
            {caption.label}
          </text>
        ))}
        {edges.map((edge) => {
          const a = pos.get(edge.source);
          const b = pos.get(edge.target);
          if (!a || !b) return null;
          const start = circleEdge(a, b, sized ? drawRadius(byId.get(edge.source), false) : 16);
          const end = circleEdge(b, a, sized ? drawRadius(byId.get(edge.target), false) : 16);
          const dim = neighborIds && !(neighborIds.has(edge.source) && neighborIds.has(edge.target));
          const kindClass = edge.kind ? ` ${edge.kind}` : "";
          return (
            <line
              key={edgeKey(edge)}
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className={dim ? `link dim${kindClass}` : `link${kindClass}`}
            >
              {edge.kind ? <title>{LINK_LABELS[edge.kind]}</title> : null}
            </line>
          );
        })}
        {ids.map((id) => {
          const item = byId.get(id);
          const point = pos.get(id);
          if (!item || !point) return null;
          const dim = neighborIds ? !neighborIds.has(id) : false;
          const selected = selectedId === id;
          const radius = sized ? drawRadius(item, false) : selected ? 16 : 13;
          const color = industryColor(item.industry);
          const generic = item.graph_node?.generic === true;
          const unverified = item.graph_node?.unverified === true;
          const label = item.graph_node?.label ?? item.tickers[0] ?? item.industry;
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
                r={radius}
                fill={generic ? "var(--bg-elev)" : color}
                stroke={selected ? "var(--ink)" : generic || unverified ? color : "transparent"}
                strokeWidth={selected ? 3 : generic || unverified ? 2 : 0}
                strokeDasharray={!selected && unverified ? "4 3" : undefined}
                className={selected ? "selected" : ""}
              />
              <text x={point.x} y={point.y + (sized ? radius + 14 : 24)} textAnchor="middle" className="node-label">
                {label}
              </text>
              {sized && item.graph_node?.drug ? (
                <text x={point.x} y={point.y + radius + 26} textAnchor="middle" className="node-sub">
                  {item.graph_node.drug}
                </text>
              ) : null}
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

function drawRadius(item: NewsItem | undefined, _selected: boolean): number {
  if (item?.graph_node) return bubbleRadius(item.graph_node);
  return 15;
}

function tipText(item: NewsItem): string {
  const node = item.graph_node;
  if (!node) return item.title;
  const reliance = node.reliance ? RELIANCE_LABELS[node.reliance] : "Reliance not stated";
  const cap = node.market_cap_b != null ? `, ${formatMarketCap(node.market_cap_b)}` : "";
  return `${node.label} · ${node.drug} — ${reliance}${cap}`;
}

function RivalryGraph({
  items,
  byId,
  selectedId,
  hover,
  onHover,
  onOpen,
}: {
  items: NewsItem[];
  byId: Map<string, NewsItem>;
  selectedId: string | null;
  hover: { id: string; x: number; y: number } | null;
  onHover: (hover: { id: string; x: number; y: number } | null) => void;
  onOpen: (id: string) => void;
}) {
  const nodes = items.filter((item) => item.graph_node);
  const nodeSignature = nodes.map((item) => item.id).join("|");
  const layout = useMemo(() => layoutRivalry(nodes), [nodeSignature]);
  const edges = useMemo(() => rivalryEdges(nodes), [nodeSignature]);
  const hidden = [...byId.values()].filter((item) => item.graph_node && !nodes.some((node) => node.id === item.id)).length;

  if (nodes.length === 0) {
    return <p className="empty">This chain is hidden by the current filters.</p>;
  }

  return (
    <div>
      <p className="story-blurb">{STORIES.find((entry) => entry.id === "drug-rivalries")?.blurb}</p>
      <RivalryLegend />
      <ForceGraph
        ids={nodes.map((item) => item.id)}
        edges={edges}
        byId={byId}
        selectedId={selectedId}
        hover={hover}
        onHover={onHover}
        onOpen={onOpen}
        preset={layout.positions}
        world={{ width: WORLD.width, height: layout.height }}
        captions={layout.captions}
        sized
      />
      <p className="chart-note">
        Drag the background to pan, drag a bubble to move it, and click a bubble for the write-up. {nodes.length} companies, {edges.length} links.
        {hidden > 0 ? ` ${hidden} hidden by filters.` : ""}
      </p>
    </div>
  );
}

function RivalryLegend() {
  const sizes: { reliance: Reliance | null; label: string }[] = [
    { reliance: null, label: "Not stated" },
    { reliance: "low", label: "Low" },
    { reliance: "medium", label: "Medium" },
    { reliance: "high", label: "High" },
    { reliance: "very_high", label: "Very high" },
  ];
  const kinds: LinkKind[] = ["rival", "generic_threat", "royalty", "unverified"];
  return (
    <div className="rival-legend">
      <div>
        <h3>Bubble size</h3>
        <ul className="legend legend-bubbles">
          {sizes.map((entry) => {
            const radius = legendRadius(entry.reliance) * 0.42;
            return (
              <li key={entry.label}>
                <svg width={radius * 2 + 4} height={radius * 2 + 4} aria-hidden="true">
                  <circle cx={radius + 2} cy={radius + 2} r={radius} fill={industryColor("Biotech / rare disease")} />
                </svg>
                {entry.label}
              </li>
            );
          })}
        </ul>
        <p className="legend-note">
          Size is how much the company relies on the drug. Very high means it is the only product. A stated market cap makes the bubble a little larger or smaller inside that band. Hollow is a generic threat. A dashed outline was not verified.
        </p>
      </div>
      <div>
        <h3>Lines</h3>
        <ul className="legend">
          {kinds.map((kind) => (
            <li key={kind}>
              <span className={`edge-sample ${kind}`} />
              {LINK_LABELS[kind]}
            </li>
          ))}
          <li>
            <i style={{ background: industryColor("Biotech / rare disease") }} />
            Biotech / rare disease
          </li>
        </ul>
      </div>
    </div>
  );
}

function zoomAt(camera: Camera, factor: number, px: number, py: number): Camera {
  const nextW = Math.min(2800, Math.max(420, camera.w * factor));
  const nextH = nextW * (camera.h / camera.w);
  const mx = camera.x + px * camera.w;
  const my = camera.y + py * camera.h;
  return { x: mx - px * nextW, y: my - py * nextH, w: nextW, h: nextH };
}
