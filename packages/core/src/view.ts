/**
 * The planner-facing projected view of the handle table.
 *
 * Ported from `oya_planner/view.py`. This is the one place the runtime decides
 * what the planner model may see. The runtime stores every handle at full
 * fidelity; `plannerView` exposes each handle only at its declared projection
 * level (spec/projection-types.md §5):
 *
 *   - OPAQUE      -> type + provenance only (no value, no summary)
 *   - SUMMARY     -> a bounded projection of the value
 *   - TRANSPARENT -> the full value
 *
 * Replan and error paths must project through here too (P3, P4): the planner
 * never sees an OPAQUE value, not even because something went wrong.
 */

import type { Plan } from "./ir.js";
import { Projection, projectionName } from "./projection/level.js";
import * as projector from "./projection/projector.js";

export type HandleTable = Record<string, unknown>;

export function projectHandle(
  plan: Plan,
  name: string,
  table: HandleTable,
): Record<string, unknown> {
  const h = plan.handle(name);
  if (h === null) return { name, state: "unknown" };
  const out: Record<string, unknown> = {
    name,
    type: h.type,
    projection: projectionName(h.projection),
    origin: h.origin,
  };
  if (!(name in table)) {
    out.state = "unset";
    return out;
  }
  const value = table[name];
  if (h.projection === Projection.TRANSPARENT) {
    out.value = value;
  } else if (h.projection === Projection.SUMMARY) {
    out.summary = projector.project(value, h.type);
  }
  // OPAQUE: deliberately nothing.
  return out;
}

/** Project the whole handle table to what the planner is entitled to see. */
export function plannerView(plan: Plan, table: HandleTable): Record<string, Record<string, unknown>> {
  const names = new Set<string>([...plan.handles.map((h) => h.name), ...Object.keys(table)]);
  const result: Record<string, Record<string, unknown>> = {};
  for (const name of [...names].sort()) {
    result[name] = projectHandle(plan, name, table);
  }
  return result;
}
