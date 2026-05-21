/**
 * Static projection-consistency checking.
 *
 * Ported from `oya_planner/projection/validation.py` (spec/projection-types.md
 * §4). A node may only read a handle at a disclosure level it is entitled to.
 * The rule depends on *who* the consumer is:
 *
 *   - a `skill` / `subplan` node runs in the runtime with full fidelity, so it
 *     imposes no disclosure requirement on its inputs (OPAQUE is fine);
 *   - a `branch` predicate is evaluated by the planner, so the handle it reads
 *     must be at least SUMMARY;
 *   - a `for_each` needs the planner to know the iteration count, so the
 *     enumerable must be at least SUMMARY;
 *   - `extract` and `summarise` feed the value to the model, so their inputs must
 *     be TRANSPARENT.
 *
 * If a `summarise` node is fed an OPAQUE handle, the plan is malformed and is
 * rejected before execution (the canonical example in §4).
 */

import type { Plan } from "../ir.js";
import { Projection, projectionName, subsumes } from "./level.js";

/** Minimum disclosure level each node kind requires of the handles it reads. */
export const REQUIRED: Record<string, Projection> = {
  skill: Projection.OPAQUE,
  subplan: Projection.OPAQUE,
  branch: Projection.SUMMARY,
  for_each: Projection.SUMMARY,
  extract: Projection.TRANSPARENT,
  summarise: Projection.TRANSPARENT,
};

export class ProjectionError {
  constructor(
    readonly nodeId: string,
    readonly handle: string,
    readonly have: Projection,
    readonly need: Projection,
  ) {}

  toString(): string {
    return (
      `node ${JSON.stringify(this.nodeId)} reads handle ${JSON.stringify(this.handle)} ` +
      `which is ${projectionName(this.have)} but the ${projectionName(this.need)} level is required`
    );
  }
}

/** Return the projection-consistency violations in `plan` (empty == valid). */
export function check(plan: Plan): ProjectionError[] {
  const errors: ProjectionError[] = [];
  for (const node of plan.nodes) {
    const need = REQUIRED[node.kind] ?? Projection.OPAQUE;
    if (need === Projection.OPAQUE) continue; // no disclosure constraint to check
    for (const handleName of node.inputHandles()) {
      const handle = plan.handle(handleName);
      if (handle === null) continue; // produced/consumed check reports the dangling ref
      if (!subsumes(handle.projection, need)) {
        errors.push(new ProjectionError(node.id, handleName, handle.projection, need));
      }
    }
  }
  return errors;
}
