/**
 * The Volcano-style executor.
 *
 * Ported from `oya_planner/executor.py` (spec/plan-ir.md §5). The executor runs
 * a checked plan operator-by-operator. State is piped between operators through a
 * full-fidelity handle table; the planner only ever sees the projected view
 * (`./view`). The model is re-engaged only at `extract` / `summarise` nodes -
 * never to pass an intermediate value from one skill to the next.
 *
 * Key properties this module realises:
 *   - Ordering by construction - nodes run in a topological order over data and
 *     control edges; inversion/skip/interleave are not reachable.
 *   - State preservation by construction - a skill receives the exact value an
 *     upstream skill produced, out of the handle table, never via the planner.
 *   - Projected errors (P3) - a failing skill yields a typed `SkillError`; any
 *     partial value it produced is dropped, never surfaced to the planner.
 *   - Caching - pure skills are memoised on (ref, inputs).
 *
 * Unlike the synchronous Python reference, node execution is async so skills may
 * perform I/O.
 */

import { createHash } from "node:crypto";

import { MISSION_HANDLE, type BranchNode, type ForEachNode, type Node, type Plan } from "./ir.js";
import { Projection } from "./projection/level.js";
import * as projector from "./projection/projector.js";
import { InProcessSandbox, type Sandbox } from "./sandbox.js";
import type { Catalog, Skill } from "./skills.js";
import { plannerView, projectHandle, type HandleTable } from "./view.js";

/** An `extract` / `summarise` node handler: (node, full-fidelity inputs) -> outputs. */
export type LLMRunner = (
  node: Node,
  kwargs: Record<string, unknown>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/** A top-level node lifecycle event (for streaming). */
export type NodeLifecycle = {
  phase: "start" | "finish";
  nodeId: string;
  kind: string;
  skill?: string;
  /** On finish: the handles this node sealed, each at its declared projection. */
  handles?: Record<string, unknown>;
};

export class SkillError extends Error {
  constructor(
    readonly skill: string,
    readonly nodeId: string,
    readonly errorClass: string,
    readonly retryable = false,
  ) {
    super(`${errorClass} in ${skill} (${nodeId})`);
    this.name = "SkillError";
  }

  /** The typed, value-free error the planner is allowed to see (P3). */
  projected(): Record<string, unknown> {
    return {
      event: "SkillError",
      skill: this.skill,
      node_id: this.nodeId,
      error_class: this.errorClass,
      retryable: this.retryable,
    };
  }
}

export class ExecutionResult {
  ok: boolean;
  exits: Record<string, unknown> = {};
  table: HandleTable;
  /** branch id -> "then" | "else" (the arm taken). */
  taken: Record<string, string> = {};
  error: SkillError | null = null;
  seconds = 0;
  skillInvocations = 0;
  cacheHits = 0;
  /** top-level node ids in the order they executed (for ordering checks). */
  executed: string[] = [];

  constructor(ok: boolean, table: HandleTable) {
    this.ok = ok;
    this.table = table;
  }

  /** The planner-facing projection of the final (or failed) state. */
  view(plan: Plan): Record<string, Record<string, unknown>> {
    return plannerView(plan, this.table);
  }
}

const COMPARATORS: Record<string, (a: unknown, b: unknown) => boolean> = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => (a as number) < (b as number),
  ">": (a, b) => (a as number) > (b as number),
  "<=": (a, b) => (a as number) <= (b as number),
  ">=": (a, b) => (a as number) >= (b as number),
};
const PRED_RE = /^\s*([\w.]+)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$/;

function errorClassOf(exc: unknown): string {
  if (exc instanceof Error) return exc.constructor.name;
  return typeof exc;
}

export class Executor {
  private readonly sandbox: Sandbox;
  private readonly llmRunner: LLMRunner | null;
  private readonly onNode: ((e: NodeLifecycle) => void) | null;
  private readonly cache = new Map<string, Record<string, unknown>>();

  constructor(
    private readonly catalog: Catalog,
    opts: { sandbox?: Sandbox; llmRunner?: LLMRunner | null; onNode?: (e: NodeLifecycle) => void } = {},
  ) {
    this.sandbox = opts.sandbox ?? new InProcessSandbox();
    this.llmRunner = opts.llmRunner ?? null;
    this.onNode = opts.onNode ?? null;
  }

  // -- public ----------------------------------------------------------------

  async run(plan: Plan, inputs?: Record<string, unknown>): Promise<ExecutionResult> {
    const table: HandleTable = { [MISSION_HANDLE]: plan.mission.content };
    if (inputs) Object.assign(table, inputs);
    const res = new ExecutionResult(true, table);

    const order = this.topoOrder(plan);
    const skipped = new Set<string>();
    const loopMembers = this.loopMembers(plan);

    for (const nodeId of order) {
      if (skipped.has(nodeId) || loopMembers.has(nodeId)) continue;
      const node = plan.node(nodeId)!;
      const skill = (node as { skill?: string }).skill;
      this.onNode?.({ phase: "start", nodeId, kind: node.kind, skill });
      try {
        await this.runNode(plan, node, table, res, skipped);
      } catch (err) {
        if (err instanceof SkillError) {
          res.ok = false;
          res.error = err;
          return res;
        }
        throw err;
      }
      if (this.onNode) {
        const handles: Record<string, unknown> = {};
        for (const h of node.outputHandles()) handles[h] = projectHandle(plan, h, table);
        this.onNode({ phase: "finish", nodeId, kind: node.kind, skill, handles });
      }
      res.executed.push(nodeId);
    }

    res.exits = {};
    for (const e of plan.exits) {
      if (e in table) res.exits[e] = table[e];
    }
    return res;
  }

  // -- node dispatch ---------------------------------------------------------

  private async runNode(
    plan: Plan,
    node: Node,
    table: HandleTable,
    res: ExecutionResult,
    skipped: Set<string>,
  ): Promise<void> {
    const kind = node.kind;
    if (kind === "skill") {
      await this.runSkill(node, table, res);
    } else if (kind === "extract" && this.catalog.get(node.skill || "") !== undefined) {
      // An extract node backed by a real catalogue skill runs deterministically
      // (no model), preserving its inputs exactly.
      await this.runSkill(node, table, res);
    } else if (kind === "extract" || kind === "summarise") {
      await this.runLLMNode(node, table);
    } else if (kind === "branch") {
      this.runBranch(plan, node, table, res, skipped);
    } else if (kind === "for_each") {
      await this.runForEach(plan, node, table, res);
    } else if (kind === "subplan") {
      throw new SkillError(node.planId, node.id, "SubplanNotSupported", false);
    }
    // replan nodes are runtime-only; nothing to execute here.
  }

  private async runSkill(
    node: Node & { skill: string },
    table: HandleTable,
    res: ExecutionResult,
  ): Promise<void> {
    const skill = this.catalog.get(node.skill);
    if (skill === undefined) {
      throw new SkillError(node.skill, node.id, "SkillUnavailable");
    }
    const kwargs = this.gatherInputs(skill, node, table);
    const cacheKey = skill.pure ? this.cacheKey(skill, kwargs) : null;
    let outputs: Record<string, unknown>;
    if (cacheKey !== null && this.cache.has(cacheKey)) {
      outputs = this.cache.get(cacheKey)!;
      res.cacheHits += 1;
    } else {
      let value: unknown;
      let seconds: number;
      try {
        const outcome = await this.sandbox.run(skill, kwargs);
        value = outcome.value;
        seconds = outcome.seconds;
      } catch (exc) {
        // Boundary -> typed, projected error. Any partial value is dropped.
        throw new SkillError(skill.ref, node.id, errorClassOf(exc));
      }
      outputs = skill.normaliseResult(value);
      res.seconds += seconds;
      res.skillInvocations += 1;
      if (cacheKey !== null) this.cache.set(cacheKey, outputs);
    }
    // Map the skill's declared output names onto this node's handle names.
    const outNames = Object.keys(skill.outputSig);
    const handles = node.outputHandles();
    for (let i = 0; i < Math.min(handles.length, outNames.length); i++) {
      table[handles[i]] = outputs[outNames[i]];
    }
  }

  private async runLLMNode(node: Node, table: HandleTable): Promise<void> {
    if (this.llmRunner === null) {
      const ref = (node as { skill?: string }).skill || node.kind;
      throw new SkillError(ref, node.id, "NoLLMRunner");
    }
    // extract/summarise inputs are required TRANSPARENT, so passing full fidelity
    // is consistent with the projection contract.
    const kwargs: Record<string, unknown> = {};
    for (const name of node.inputHandles()) kwargs[name] = table[name];
    const outputs = await this.llmRunner(node, kwargs);
    for (const [name, value] of Object.entries(outputs)) table[name] = value;
  }

  private runBranch(
    plan: Plan,
    node: BranchNode,
    table: HandleTable,
    res: ExecutionResult,
    skipped: Set<string>,
  ): void {
    const taken = this.evalPredicate(plan, node, table);
    const loser = taken ? node.otherwise : node.then;
    // Record + skip the not-taken arm (recursively through nested control).
    this.skipSubtree(plan, loser, skipped);
    // Winners are simply left enabled; topo order runs them in turn.
    res.taken[node.id] = taken ? "then" : "else";
  }

  private async runForEach(
    plan: Plan,
    node: ForEachNode,
    table: HandleTable,
    res: ExecutionResult,
  ): Promise<void> {
    const bound = this.resolveBound(node, table);
    for (let i = 0; i < bound; i++) {
      for (const bodyId of this.topoSubset(plan, node.body)) {
        const bnode = plan.node(bodyId)!;
        await this.runNode(plan, bnode, table, res, new Set());
      }
    }
  }

  // -- helpers ---------------------------------------------------------------

  private gatherInputs(
    skill: Skill,
    node: Node,
    table: HandleTable,
  ): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {};
    const bindings =
      (node as { inputBindings?: () => Record<string, string> }).inputBindings?.call(node) ?? {};
    if (Object.keys(bindings).length) {
      for (const [param, hname] of Object.entries(bindings)) kwargs[param] = table[hname];
    } else {
      const params = Object.keys(skill.inputSig);
      const positional =
        (node as { positionalInputs?: () => (string | null)[] }).positionalInputs?.call(node) ?? [];
      for (let i = 0; i < Math.min(params.length, positional.length); i++) {
        const hname = positional[i];
        if (hname === null) continue; // an unfilled optional -> use the skill default
        kwargs[params[i]] = table[hname];
      }
    }
    const args = (node as { args?: Record<string, unknown> }).args ?? {};
    for (const [param, value] of Object.entries(args)) kwargs[param] = value;
    return kwargs;
  }

  private cacheKey(skill: Skill, kwargs: Record<string, unknown>): string {
    const blob = stableStringify(kwargs);
    return `${skill.ref}:${createHash("sha256").update(blob).digest("hex").slice(0, 16)}`;
  }

  private evalPredicate(plan: Plan, node: BranchNode, table: HandleTable): boolean {
    const resolve = (path: string): unknown => {
      const parts = path.split(".");
      const hname = parts[0];
      const fields = parts.slice(1);
      const handle = plan.handle(hname);
      if (handle === null || !(hname in table)) return null;
      // Branch reads at the handle's declared level; for SUMMARY the planner sees
      // the projection, so we evaluate against it.
      let cur: unknown =
        handle.projection === Projection.SUMMARY
          ? projector.project(table[hname], handle.type)
          : table[hname];
      for (const f of fields) {
        cur = typeof cur === "object" && cur !== null ? (cur as Record<string, unknown>)[f] : null;
      }
      return cur;
    };

    const m = PRED_RE.exec(node.predicate);
    if (!m) return Boolean(resolve(node.predicate.trim()));
    const [, lhs, op, rhs] = m;
    const left = resolve(lhs);
    let right: unknown;
    try {
      right = JSON.parse(rhs);
    } catch {
      right = rhs.trim().replace(/^['"]|['"]$/g, "");
    }
    return COMPARATORS[op](left, right);
  }

  private resolveBound(node: ForEachNode, table: HandleTable): number {
    const bound = node.bound;
    if (typeof bound === "number") return Math.max(0, Math.trunc(bound));
    if (typeof bound === "string") {
      const base = bound.split(".", 1)[0];
      const val = table[base];
      if (val != null) {
        if (typeof val === "string" || Array.isArray(val)) return val.length;
        if (typeof val === "object") return Object.keys(val).length;
      }
    }
    return 0;
  }

  private loopMembers(plan: Plan): Set<string> {
    const members = new Set<string>();
    for (const n of plan.nodes) {
      if (n.kind === "for_each") for (const m of n.body) members.add(m);
    }
    return members;
  }

  private skipSubtree(plan: Plan, nodeIds: string[], skipped: Set<string>): void {
    for (const nid of nodeIds) {
      if (skipped.has(nid)) continue;
      skipped.add(nid);
      const node = plan.node(nid);
      if (node !== null) this.skipSubtree(plan, node.controlTargets(), skipped);
    }
  }

  private topoSubset(plan: Plan, nodeIds: string[]): string[] {
    const wanted = new Set(nodeIds);
    return this.topoOrder(plan).filter((nid) => wanted.has(nid));
  }

  private topoOrder(plan: Plan): string[] {
    const producers = new Map<string, string>([[MISSION_HANDLE, "mission"]]);
    for (const n of plan.nodes) {
      for (const h of n.outputHandles()) if (!producers.has(h)) producers.set(h, n.id);
    }
    const ids = plan.nodes.map((n) => n.id);
    const deps = new Map<string, Set<string>>();
    for (const nid of ids) deps.set(nid, new Set());
    for (const n of plan.nodes) {
      for (const h of n.inputHandles()) {
        const src = producers.get(h);
        if (src && src !== "mission" && deps.has(src)) deps.get(n.id)!.add(src);
      }
      // control edges: a branch/for_each runs before its members.
      for (const tgt of n.controlTargets()) {
        if (deps.has(tgt)) deps.get(tgt)!.add(n.id);
      }
    }
    const order: string[] = [];
    const seen = new Set<string>();
    const indeg = new Map<string, number>();
    for (const [nid, ds] of deps) indeg.set(nid, ds.size);
    let queue = [...indeg].filter(([, d]) => d === 0).map(([nid]) => nid).sort();
    while (queue.length) {
      const cur = queue.shift()!;
      order.push(cur);
      seen.add(cur);
      const newly: string[] = [];
      for (const [nid, ds] of deps) {
        if (ds.has(cur) && !seen.has(nid)) {
          indeg.set(nid, indeg.get(nid)! - 1);
          if (indeg.get(nid) === 0) newly.push(nid);
        }
      }
      queue = [...queue, ...newly.sort()];
    }
    // Any leftover (shouldn't happen on a checked plan) appended stably.
    for (const nid of ids) if (!seen.has(nid)) order.push(nid);
    return order;
  }
}

/** A deterministic JSON encoding with sorted object keys (for cache keys). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}
