/**
 * The three-level projection lattice.
 *
 * Ported from `oya_planner/projection/level.py` (spec/projection-types.md §2).
 * The lattice is ordered by how much of a handle's value is disclosed to the
 * planner model:
 *
 *     TRANSPARENT     full value
 *         |
 *      SUMMARY        bounded, runtime-generated projection
 *         |
 *      OPAQUE         type + provenance only   (the default)
 *
 * Higher means more disclosure. Promotion (moving up) is an explicit, audited
 * choice recorded in the plan; demotion (moving down) is free — the standard
 * lattice subsumption rule (P2).
 */

/** A projection level. Numeric so the lattice order is just `>=`. */
export enum Projection {
  OPAQUE = 0,
  SUMMARY = 1,
  TRANSPARENT = 2,
}

/** The default level for any handle whose projection is not explicitly raised. */
export const DEFAULT = Projection.OPAQUE;

/** The canonical name of a level ("OPAQUE" / "SUMMARY" / "TRANSPARENT"). */
export function projectionName(p: Projection): string {
  return Projection[p];
}

/** Parse a projection level from its name (case-insensitive) or pass through. */
export function parseProjection(value: string | Projection): Projection {
  if (typeof value === "number") return value;
  const key = value.trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(Projection, key)) {
    return (Projection as unknown as Record<string, Projection>)[key];
  }
  throw new Error(
    `unknown projection level ${JSON.stringify(value)}; ` +
      `expected one of OPAQUE, SUMMARY, TRANSPARENT`,
  );
}

/**
 * True if a handle disclosed at `have` satisfies a consumer needing `need`.
 *
 * The lattice subsumption rule (P2): a consumer that needs to read a handle at
 * level `need` is satisfied by any handle disclosed at `need` or higher, because
 * the consumer may always downgrade its view.
 */
export function subsumes(have: Projection, need: Projection): boolean {
  return have >= need;
}
