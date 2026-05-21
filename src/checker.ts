/**
 * The static checker.
 *
 * Ported from `oya_planner/checker.py`. Runs the eight checks of spec/plan-ir.md
 * §4 over a `Plan` before any execution begins. A plan that fails any check is
 * rejected with a structured error and the planner is asked to re-emit.
 *
 *     1. acyclic              5. projection consistency
 *     2. all handles produced 6. skill availability
 *     3. all handles consumed 7. boundedness
 *     4. type correctness     8. cost budget
 */

import { MISSION_HANDLE, type Node, type Plan } from "./ir.js";
import * as validation from "./projection/validation.js";
import { isSubtypeStr } from "./types.js";

export class CheckError {
  constructor(
    readonly code: string,
    readonly message: string,
  ) {}
}

export class CheckResult {
  errors: CheckError[] = [];

  get ok(): boolean {
    return this.errors.length === 0;
  }

  codes(): string[] {
    return this.errors.map((e) => e.code);
  }
}

/** The `name@version` ref this node invokes, or null (non-skill / unfilled). */
function nodeSkillRef(node: Node): string | null {
  const s = (node as { skill?: unknown }).skill;
  return typeof s === "string" && s ? s : null;
}

function nodeBindings(node: Node): Record<string, string> {
  const fn = (node as { inputBindings?: () => Record<string, string> }).inputBindings;
  return typeof fn === "function" ? fn.call(node) : {};
}

function nodeArgs(node: Node): Record<string, unknown> {
  return (node as { args?: Record<string, unknown> }).args ?? {};
}

export function check(plan: Plan): CheckResult {
  const res = new CheckResult();
  const producers = computeProducers(plan);
  checkHandlesProduced(plan, producers, res);
  checkHandlesConsumed(plan, res);
  checkAcyclic(plan, producers, res);
  checkSkillAvailability(plan, res);
  checkTypes(plan, res);
  checkProjection(plan, res);
  checkBoundedness(plan, res);
  checkCost(plan, res);
  return res;
}

/** Map handle name -> producing node id (`mission` is external). */
function computeProducers(plan: Plan): Map<string, string> {
  const out = new Map<string, string>([[MISSION_HANDLE, "mission"]]);
  for (const node of plan.nodes) {
    for (const h of node.outputHandles()) {
      if (!out.has(h)) out.set(h, node.id);
    }
  }
  return out;
}

function checkHandlesProduced(
  plan: Plan,
  producers: Map<string, string>,
  res: CheckResult,
): void {
  const seen = new Map<string, number>();
  for (const node of plan.nodes) {
    for (const h of node.outputHandles()) {
      seen.set(h, (seen.get(h) ?? 0) + 1);
    }
  }
  for (const [name, n] of seen) {
    if (n > 1) {
      res.errors.push(
        new CheckError("handle_multiple_producers", `handle ${JSON.stringify(name)} produced by ${n} nodes`),
      );
    }
  }
  // Every declared handle must have a producer.
  for (const h of plan.handles) {
    if (!producers.has(h.name)) {
      res.errors.push(
        new CheckError("handle_no_producer", `handle ${JSON.stringify(h.name)} has no producing node`),
      );
    }
  }
  // Every consumed handle must exist.
  for (const node of plan.nodes) {
    for (const h of node.inputHandles()) {
      if (!producers.has(h) && plan.handle(h) === null) {
        res.errors.push(
          new CheckError("handle_undefined", `node ${JSON.stringify(node.id)} reads undefined handle ${JSON.stringify(h)}`),
        );
      }
    }
  }
}

function checkHandlesConsumed(plan: Plan, res: CheckResult): void {
  const consumed = new Set<string>(plan.exits);
  for (const node of plan.nodes) {
    for (const h of node.inputHandles()) consumed.add(h);
  }
  for (const node of plan.nodes) {
    for (const h of node.outputHandles()) {
      if (!consumed.has(h)) {
        res.errors.push(
          new CheckError("handle_unconsumed", `handle ${JSON.stringify(h)} is neither consumed nor an exit`),
        );
      }
    }
  }
}

function checkAcyclic(plan: Plan, producers: Map<string, string>, res: CheckResult): void {
  // Edge producer(node) -> consumer(node) for each input handle.
  const deps = new Map<string, Set<string>>();
  for (const n of plan.nodes) deps.set(n.id, new Set());
  for (const node of plan.nodes) {
    for (const h of node.inputHandles()) {
      const src = producers.get(h);
      if (src && src !== "mission" && deps.has(src)) {
        deps.get(node.id)!.add(src);
      }
    }
  }
  // Kahn's algorithm.
  const indeg = new Map<string, number>();
  for (const [nid, ds] of deps) indeg.set(nid, ds.size);
  const queue: string[] = [];
  for (const [nid, d] of indeg) if (d === 0) queue.push(nid);
  let visited = 0;
  while (queue.length) {
    const cur = queue.pop()!;
    visited += 1;
    for (const [nid, ds] of deps) {
      if (ds.has(cur)) {
        indeg.set(nid, indeg.get(nid)! - 1);
        if (indeg.get(nid) === 0) queue.push(nid);
      }
    }
  }
  if (visited !== deps.size) {
    res.errors.push(new CheckError("not_acyclic", "dataflow graph contains a cycle"));
  }
}

function checkSkillAvailability(plan: Plan, res: CheckResult): void {
  for (const node of plan.nodes) {
    const ref = nodeSkillRef(node);
    if (!ref) continue; // null or "" (e.g. an extract node run by the model)
    if (plan.catalogSnapshot.resolve(ref) === null) {
      res.errors.push(
        new CheckError("skill_unavailable", `node ${JSON.stringify(node.id)}: skill ${JSON.stringify(ref)} not in catalogue snapshot`),
      );
    }
  }
}

function checkTypes(plan: Plan, res: CheckResult): void {
  const handleType = new Map<string, string>([[MISSION_HANDLE, "str"]]);
  for (const h of plan.handles) handleType.set(h.name, h.type);

  const checkEdge = (node: Node, hname: string, expected: string): void => {
    const actual = handleType.get(hname);
    if (actual === undefined) return;
    let ok: boolean;
    try {
      ok = isSubtypeStr(actual, expected);
    } catch (exc) {
      res.errors.push(new CheckError("type_parse", `node ${JSON.stringify(node.id)}: ${(exc as Error).message}`));
      return;
    }
    if (!ok) {
      res.errors.push(
        new CheckError(
          "type_mismatch",
          `node ${JSON.stringify(node.id)}: input ${JSON.stringify(hname)} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        ),
      );
    }
  };

  for (const node of plan.nodes) {
    const ref = nodeSkillRef(node);
    if (!ref) continue;
    const entry = plan.catalogSnapshot.resolve(ref);
    if (entry === null) continue; // availability check already reported this
    const sig = entry.inputSig; // {param: type}
    const bindings = nodeBindings(node);
    if (Object.keys(bindings).length) {
      // name-keyed {param: handle}
      for (const [param, hname] of Object.entries(bindings)) {
        if (!(param in sig)) {
          res.errors.push(
            new CheckError("unknown_input", `node ${JSON.stringify(node.id)}: input ${JSON.stringify(param)} not a parameter of ${JSON.stringify(ref)}`),
          );
          continue;
        }
        checkEdge(node, hname, sig[param]);
      }
    } else {
      // positional list
      const sigInputs = Object.values(sig);
      const positional = (node as { positionalInputs?: () => (string | null)[] }).positionalInputs;
      const inputs = typeof positional === "function" ? positional.call(node) : [];
      for (let i = 0; i < inputs.length; i++) {
        const hname = inputs[i];
        if (hname === null) continue; // an unfilled optional parameter; default applies
        if (i >= sigInputs.length) {
          res.errors.push(
            new CheckError("arity_mismatch", `node ${JSON.stringify(node.id)}: too many inputs for ${JSON.stringify(ref)}`),
          );
          break;
        }
        checkEdge(node, hname, sigInputs[i]);
      }
    }
    // Literal args must name real parameters of the skill.
    for (const param of Object.keys(nodeArgs(node))) {
      if (!(param in sig)) {
        res.errors.push(
          new CheckError("unknown_arg", `node ${JSON.stringify(node.id)}: arg ${JSON.stringify(param)} not a parameter of ${JSON.stringify(ref)}`),
        );
      }
    }
  }
}

function checkProjection(plan: Plan, res: CheckResult): void {
  for (const err of validation.check(plan)) {
    res.errors.push(new CheckError("projection_inconsistent", err.toString()));
  }
}

function checkBoundedness(plan: Plan, res: CheckResult): void {
  for (const node of plan.nodes) {
    if (node.kind !== "for_each") continue;
    const bound = node.bound;
    if (typeof bound === "number" && Number.isInteger(bound) && bound >= 0) continue;
    if (typeof bound === "string") {
      // Must be "<handle>.count" referencing a SUMMARY/known field.
      const base = bound.split(".", 1)[0];
      if (plan.handle(base) !== null) continue;
    }
    res.errors.push(
      new CheckError("unbounded_loop", `for_each ${JSON.stringify(node.id)} has no statically known bound`),
    );
  }
}

function checkCost(plan: Plan, res: CheckResult): void {
  let totalTokens = 0;
  let totalSeconds = 0;
  for (const node of plan.nodes) {
    const ref = nodeSkillRef(node);
    if (!ref) continue;
    const entry = plan.catalogSnapshot.resolve(ref);
    if (entry === null) continue;
    totalTokens += entry.costMaxTokens;
    totalSeconds += entry.costMaxSeconds;
  }
  if (totalTokens > plan.budget.maxTokens) {
    res.errors.push(
      new CheckError("over_budget_tokens", `plan worst-case ${totalTokens} tokens > budget ${plan.budget.maxTokens}`),
    );
  }
  if (totalSeconds > plan.budget.maxSeconds) {
    res.errors.push(
      new CheckError("over_budget_seconds", `plan worst-case ${totalSeconds}s > budget ${plan.budget.maxSeconds}s`),
    );
  }
}
