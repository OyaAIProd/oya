/**
 * Pure, bounded `SUMMARY` projection functions.
 *
 * Ported from `oya_planner/projection/projector.py` (spec/projection-types.md
 * §2.2). A projection function takes a full-fidelity value and returns a small,
 * bounded object the planner model is allowed to branch on — never the value
 * itself.
 *
 * The functions here are:
 *   - **pure** — no side effects, deterministic.
 *   - **bounded** — output size is capped and they do not recurse into nested
 *     fields, so a projection can never smuggle the full value back into the
 *     planner's context.
 *
 * Custom nominal types register their own projector via `register`.
 */

export type Projector = (value: unknown) => Record<string, unknown>;

/** Cap on the number of element-derived strings any projection may expose. */
const MAX_ITEMS = 16;
/** Cap on the length of any single string a projection may expose. */
const MAX_STR = 64;

const REGISTRY = new Map<string, Projector>();

/** Register a projection function for a nominal type. */
export function register(typeName: string, fn: Projector): void {
  REGISTRY.set(typeName, fn);
}

/** Reset the registry (test helper). */
export function _resetRegistry(): void {
  REGISTRY.clear();
}

/** The JS analogue of Python's `type(value).__name__`, for the kinds we expose. */
function typeName(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "float";
  if (typeof value === "bigint") return "int";
  if (typeof value === "string") return "str";
  if (isBytes(value)) return "bytes";
  if (Array.isArray(value) || value instanceof Set) return "list";
  if (value instanceof Map || isPlainObject(value)) return "dict";
  return (value as object).constructor?.name ?? "object";
}

function isBytes(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Set) &&
    !(value instanceof Map) &&
    !isBytes(value)
  );
}

function byteLength(value: ArrayBufferView | ArrayBuffer): number {
  return value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
}

/** Built-in projections for stdlib values (see the table in §2.2). */
function summaryForValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number") {
    return { kind: Number.isInteger(value) ? "int" : "float" };
  }
  if (typeof value === "bigint") return { kind: "int" };
  if (typeof value === "string") {
    // We never expose string *contents* in a summary, only their length.
    return { kind: "str", len: value.length };
  }
  if (isBytes(value)) return { kind: "bytes", len: byteLength(value) };
  if (Array.isArray(value) || value instanceof Set) {
    const arr = Array.isArray(value) ? value : [...value];
    const firstKind = arr.length ? typeName(arr[0]) : null;
    return { kind: "list", count: arr.length, first_item_kind: firstKind };
  }
  if (value instanceof Map) {
    const keys = [...value.keys()].slice(0, MAX_ITEMS).map((k) => String(k));
    return { kind: "dict", size: value.size, keys };
  }
  if (isPlainObject(value)) {
    const allKeys = Object.keys(value);
    const keys = allKeys.slice(0, MAX_ITEMS).map((k) => String(k));
    return { kind: "dict", size: allKeys.length, keys };
  }
  // Unknown object: expose its type name only.
  return { kind: typeName(value) };
}

/**
 * Compute the bounded `SUMMARY` of `value`.
 *
 * If `typeName` has a registered projector it is used; otherwise a built-in
 * structural projection is applied. The result is defensively bounded.
 */
export function project(
  value: unknown,
  typeName?: string | null,
): Record<string, unknown> {
  let out: Record<string, unknown>;
  if (typeName != null && REGISTRY.has(typeName)) {
    out = REGISTRY.get(typeName)!(value);
  } else {
    out = summaryForValue(value);
  }
  return bound(out);
}

/** Defensively cap a projection's output so a custom projector cannot leak. */
function bound(out: Record<string, unknown>): Record<string, unknown> {
  const bounded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(out).slice(0, MAX_ITEMS)) {
    if (typeof v === "string") {
      bounded[k] = v.slice(0, MAX_STR);
    } else if (Array.isArray(v)) {
      bounded[k] = v
        .slice(0, MAX_ITEMS)
        .map((item) => (typeof item === "string" ? item.slice(0, MAX_STR) : item));
    } else {
      bounded[k] = v;
    }
  }
  return bounded;
}
