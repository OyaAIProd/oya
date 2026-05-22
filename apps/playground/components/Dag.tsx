"use client";

import type { NodeState } from "oya/react";

type RawNode = { id: string; kind: string; skill?: string; inputs?: unknown; outputs?: string[] };
export type RawPlan = { nodes: RawNode[] };

function inputsOf(n: RawNode): string[] {
  const x = n.inputs;
  if (!x) return [];
  if (Array.isArray(x)) return x.filter((h): h is string => typeof h === "string");
  return Object.values(x as Record<string, unknown>).filter((v): v is string => typeof v === "string");
}

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
  const ns = plan.nodes ?? [];
  if (!ns.length) return <div className="muted">waiting for the plan…</div>;
  const stateOf = (id: string) => nodes.find((n) => n.nodeId === id)?.status ?? "pending";

  const prod: Record<string, string> = {};
  ns.forEach((n) => (n.outputs ?? []).forEach((o) => (prod[o] = n.id)));
  const edges: { from: string; to: string }[] = [];
  ns.forEach((n) => inputsOf(n).forEach((h) => prod[h] && edges.push({ from: prod[h], to: n.id })));

  const layer: Record<string, number> = {};
  ns.forEach((n) => (layer[n.id] = 0));
  for (let p = 0; p < ns.length; p++) {
    edges.forEach((e) => (layer[e.to] = Math.max(layer[e.to], layer[e.from] + 1)));
  }

  const NW = 170, NH = 52, GX = 26, GY = 50, PAD = 24;
  const byLayer: Record<number, RawNode[]> = {};
  ns.forEach((n) => (byLayer[layer[n.id]] = byLayer[layer[n.id]] ?? []).push(n));
  const rows = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
  const maxCount = Math.max(1, ...rows.map((k) => byLayer[k].length));
  const totalW = maxCount * NW + (maxCount - 1) * GX;
  const pos: Record<string, { x: number; y: number }> = {};
  rows.forEach((k, row) => {
    const arr = byLayer[k];
    const rowW = arr.length * NW + (arr.length - 1) * GX;
    const x0 = PAD + (totalW - rowW) / 2;
    arr.forEach((n, i) => (pos[n.id] = { x: x0 + i * (NW + GX), y: PAD + row * (NH + GY) }));
  });
  const W = PAD * 2 + totalW;
  const H = PAD * 2 + rows.length * NH + (rows.length - 1) * GY;

  return (
    <svg className="dag" viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      {edges.map((e, i) => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = (y1 + y2) / 2;
        const live = stateOf(e.from) === "done" && stateOf(e.to) !== "pending";
        return <path key={i} className={"edge" + (live ? " live" : "")} d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`} />;
      })}
      {ns.map((n) => {
        const p = pos[n.id], st = stateOf(n.id);
        return (
          <g key={n.id} className={"node " + st + (selected === n.id ? " sel" : "")} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(n.id)}>
            <rect width={NW} height={NH} rx={10} />
            <circle className={"ndot " + st} cx={16} cy={NH / 2} r={4} />
            <text className="id" x={32} y={22}>{n.id}</text>
            <text className="knd" x={32} y={38}>{n.skill ?? n.kind}</text>
          </g>
        );
      })}
    </svg>
  );
}
