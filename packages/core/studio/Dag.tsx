import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import clsx from "clsx";
import { Wrench, Scissors, Sparkles, GitBranch, Repeat, RefreshCw, Layers, Circle, Loader2, Check, type LucideIcon } from "lucide-react";
import type { NodeState } from "../src/react/index.js";

type RawNode = { id: string; kind: string; skill?: string; inputs?: unknown; outputs?: string[] };
export type RawPlan = { nodes: RawNode[] };

type Status = "pending" | "running" | "done";
type NodeData = { label: string; sub: string; kind: string; status: Status };

const KIND: Record<string, { icon: LucideIcon; hue: number }> = {
  skill: { icon: Wrench, hue: 250 },
  extract: { icon: Scissors, hue: 300 },
  summarise: { icon: Sparkles, hue: 300 },
  branch: { icon: GitBranch, hue: 65 },
  for_each: { icon: Repeat, hue: 65 },
  replan: { icon: RefreshCw, hue: 30 },
  subplan: { icon: Layers, hue: 200 },
};

const NW = 194;
const NH = 60;

function inputsOf(n: RawNode): string[] {
  const x = n.inputs;
  if (!x) return [];
  if (Array.isArray(x)) return x.filter((h): h is string => typeof h === "string");
  return Object.values(x as Record<string, unknown>).filter((v): v is string => typeof v === "string");
}

function OyaNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const meta = KIND[data.kind] ?? { icon: Circle, hue: 250 };
  const Icon = meta.icon;
  const { status } = data;
  return (
    <div
      style={{ width: NW, height: NH }}
      className={clsx(
        "glass flex items-center gap-2.5 rounded-xl border px-3 transition-all",
        status === "pending" && "border-line opacity-55",
        status === "running" && "border-brand glow animate-breathe",
        status === "done" && "border-transp/60",
        selected && "ring-2 ring-brand ring-offset-2 ring-offset-bg",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <span
        className="grid h-8 w-8 flex-none place-items-center rounded-lg"
        style={{ background: `oklch(0.6 0.15 ${meta.hue} / 0.18)`, color: `oklch(0.78 0.15 ${meta.hue})` }}
      >
        <Icon size={15} strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[12px] font-bold text-fg">{data.label}</span>
        <span className="mono block truncate text-[10px] text-muted">{data.sub}</span>
      </span>
      {status === "running" ? (
        <Loader2 size={13} className="flex-none animate-spin text-brand" />
      ) : status === "done" ? (
        <Check size={13} className="flex-none text-transp" />
      ) : (
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-opaque" />
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { oya: OyaNode };

export function Dag({
  plan,
  nodes,
  selected,
  onSelect,
}: {
  plan: RawPlan;
  nodes: NodeState[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const statusOf = (id: string): Status => (nodes.find((n) => n.nodeId === id)?.status as Status) ?? "pending";

  const { rfNodes, rfEdges } = useMemo(() => {
    const ns = plan.nodes ?? [];
    const prod: Record<string, string> = {};
    ns.forEach((n) => (n.outputs ?? []).forEach((o) => o && (prod[o] = n.id)));
    const edges: { from: string; to: string }[] = [];
    ns.forEach((n) => inputsOf(n).forEach((h) => prod[h] && edges.push({ from: prod[h], to: n.id })));

    const layer: Record<string, number> = {};
    ns.forEach((n) => (layer[n.id] = 0));
    for (let p = 0; p < ns.length; p++) edges.forEach((e) => (layer[e.to] = Math.max(layer[e.to], layer[e.from] + 1)));

    const byLayer: Record<number, RawNode[]> = {};
    ns.forEach((n) => (byLayer[layer[n.id]] = byLayer[layer[n.id]] ?? []).push(n));
    const rows = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
    const maxCount = Math.max(1, ...rows.map((k) => byLayer[k].length));
    const GX = 40;
    const GY = 82;
    const totalW = maxCount * NW + (maxCount - 1) * GX;

    const rfNodes: Node<NodeData>[] = [];
    rows.forEach((k, row) => {
      const arr = byLayer[k];
      const rowW = arr.length * NW + (arr.length - 1) * GX;
      const x0 = (totalW - rowW) / 2;
      arr.forEach((n, i) => {
        rfNodes.push({
          id: n.id,
          type: "oya",
          position: { x: x0 + i * (NW + GX), y: row * (NH + GY) },
          data: { label: n.id, sub: n.skill ?? n.kind, kind: n.kind, status: statusOf(n.id) },
          draggable: false,
        });
      });
    });

    const rfEdges: Edge[] = edges.map((e, i) => {
      const live = statusOf(e.from) === "done";
      return {
        id: `e${i}`,
        source: e.from,
        target: e.to,
        type: "smoothstep",
        animated: live && statusOf(e.to) === "running",
        style: { stroke: live ? "var(--color-brand)" : "var(--color-line)", strokeWidth: live ? 2 : 1.6 },
      };
    });

    return { rfNodes, rfEdges };
  }, [plan, nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rfNodes.length) return <div className="p-8 text-center text-sm text-faint">waiting for the plan…</div>;

  return (
    <ReactFlow
      nodes={rfNodes.map((n) => ({ ...n, selected: n.id === selected }))}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_e, n) => onSelect(n.id)}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-line)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
