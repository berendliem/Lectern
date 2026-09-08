"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw, Waypoints } from "lucide-react";

type ConceptNode = { id: string; label: string; group: number };
type ConceptEdge = { from: string; to: string; label: string };
type ConceptMap = { nodes: ConceptNode[]; edges: ConceptEdge[] };

const W = 800;
const H = 600;
const CX = W / 2;
const CY = H / 2;

// Soft fill / ink text per group, using the app's palette tokens.
const GROUP_COLORS = [
  { fill: "var(--color-brand-soft)", text: "var(--color-brand)", stroke: "var(--color-brand-border)" },
  { fill: "var(--color-sky-soft)", text: "var(--color-sky-ink)", stroke: "var(--color-sky-soft)" },
  { fill: "var(--color-moss-soft)", text: "var(--color-moss-ink)", stroke: "var(--color-moss-soft)" },
  { fill: "var(--color-coral-soft)", text: "var(--color-coral-ink)", stroke: "var(--color-coral-soft)" },
  { fill: "var(--color-lavender-soft)", text: "var(--color-lavender-ink)", stroke: "var(--color-lavender-soft)" },
];

type PlacedNode = ConceptNode & { x: number; y: number; w: number; h: number };

/**
 * Deterministic layout without a physics engine: nodes are sorted by group and
 * placed around an ellipse, so members of a group sit in adjacent angular
 * sectors; the first node of group 0 (the central theme) goes in the middle.
 */
function layoutNodes(nodes: ConceptNode[]): PlacedNode[] {
  const sorted = [...nodes].sort((a, b) => a.group - b.group);
  const centerIndex = sorted.findIndex((n) => n.group === 0);
  const center = centerIndex >= 0 ? sorted[centerIndex] : null;
  const ring = center ? sorted.filter((_, i) => i !== centerIndex) : sorted;

  const placed: PlacedNode[] = [];
  const measure = (label: string) => ({ w: Math.max(70, label.length * 7.2 + 28), h: 32 });

  if (center) {
    const { w, h } = measure(center.label);
    placed.push({ ...center, x: CX, y: CY, w, h });
  }
  const rx = W / 2 - 110;
  const ry = H / 2 - 70;
  ring.forEach((node, i) => {
    // Start at the top and go clockwise; slight radius jitter by parity keeps
    // adjacent labels from overlapping on dense maps.
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring.length);
    const jitter = i % 2 === 0 ? 1 : 0.78;
    const { w, h } = measure(node.label);
    placed.push({
      ...node,
      x: CX + rx * jitter * Math.cos(angle),
      y: CY + ry * jitter * Math.sin(angle),
      w,
      h,
    });
  });
  return placed;
}

export function ConceptMapTab({ pageId, hasMaterial }: { pageId: string; hasMaterial: boolean }) {
  const [map, setMap] = useState<ConceptMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${pageId}/concept-map`, { method: "POST" });
      if (res.ok) {
        const { conceptMap } = await res.json();
        setMap(conceptMap);
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not generate the concept map. Try again.");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  const placed = useMemo(() => (map ? layoutNodes(map.nodes) : []), [map]);
  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);

  const neighborIds = useMemo(() => {
    if (!hovered || !map) return null;
    const ids = new Set<string>([hovered]);
    for (const e of map.edges) {
      if (e.from === hovered) ids.add(e.to);
      if (e.to === hovered) ids.add(e.from);
    }
    return ids;
  }, [hovered, map]);

  if (!hasMaterial) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong px-4 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Waypoints className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">Nothing to map yet</p>
          <p className="mt-1 text-[13px] text-muted-2">
            Transcribe the lecture first — then generate a map of how its concepts connect.
          </p>
        </div>
      </div>
    );
  }

  if (!map) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-line/80 bg-surface px-4 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Waypoints className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink-soft">See how the ideas connect</p>
          <p className="mt-1 text-[13px] text-muted-2">
            AI extracts the lecture&apos;s key concepts and draws the relationships between them.
          </p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Waypoints className="h-4 w-4" strokeWidth={2.2} />}
          {loading ? "Mapping concepts…" : "Generate concept map"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">
          Hover a concept to spotlight its connections. Click Regenerate for a fresh take.
        </p>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />}
          Regenerate
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-line/80 bg-surface">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHovered(null)}>
          {/* Edges under nodes */}
          {map.edges.map((edge, i) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            if (!a || !b) return null;
            const dim = neighborIds ? !(neighborIds.has(edge.from) && neighborIds.has(edge.to) && (edge.from === hovered || edge.to === hovered)) : false;
            const mx = (a.x + b.x) / 2;
            const my = (a.y + b.y) / 2;
            // Bow each edge slightly toward the center so parallel edges separate.
            const qx = mx + (CX - mx) * 0.18;
            const qy = my + (CY - my) * 0.18;
            return (
              <g key={i} opacity={dim ? 0.15 : 1} className="transition-opacity duration-150">
                <path
                  d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`}
                  fill="none"
                  stroke="#d4d4d8"
                  strokeWidth={1.5}
                />
                {edge.label && (
                  <text
                    x={(a.x + 2 * qx + b.x) / 4}
                    y={(a.y + 2 * qy + b.y) / 4 - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#a1a1aa"
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {placed.map((node) => {
            const color = GROUP_COLORS[node.group % GROUP_COLORS.length];
            const dim = neighborIds ? !neighborIds.has(node.id) : false;
            const isHovered = node.id === hovered;
            return (
              <g
                key={node.id}
                opacity={dim ? 0.25 : 1}
                className="cursor-pointer transition-opacity duration-150"
                onMouseEnter={() => setHovered(node.id)}
              >
                <rect
                  x={node.x - node.w / 2}
                  y={node.y - node.h / 2}
                  width={node.w}
                  height={node.h}
                  rx={node.h / 2}
                  fill={color.fill}
                  stroke={isHovered ? color.text : color.stroke}
                  strokeWidth={isHovered ? 2 : 1}
                />
                <text
                  x={node.x}
                  y={node.y + 4}
                  textAnchor="middle"
                  fontSize={12.5}
                  fontWeight={600}
                  fill={color.text}
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
