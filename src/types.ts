/**
 * A small structural type system for the Plan IR.
 *
 * Ported from `oya_planner/types.py` (spec/plan-ir.md §3.5). Types are written
 * as strings in the IR (e.g. `"List[CRMRecord]"`, `"Optional[URL]"`,
 * `"Result[int, str]"`) and parsed here into a tiny AST so the static checker
 * can verify that every dataflow edge is well-typed (spec/plan-ir.md §4, check 4).
 *
 * The system is intentionally minimal:
 *   - primitives: `str int float bool bytes null`
 *   - structural: `List[T] Dict[K, V] Tuple[T, ...] Optional[T] Result[T, E]`
 *   - nominal: any other bare identifier (e.g. `URL`, `CRMRecord`); nominal
 *     types are subtypes only of themselves and `Any`.
 *
 * Subtyping is shallow and conservative — enough to catch wiring mistakes, not a
 * full type theory. `Any` is top; `null` is a subtype of every `Optional`.
 */

/** A parsed type node: a head constructor plus ordered type arguments. */
export class Type {
  readonly head: string;
  readonly args: readonly Type[];

  constructor(head: string, args: readonly Type[] = []) {
    this.head = head;
    this.args = args;
  }

  toString(): string {
    if (this.args.length === 0) return this.head;
    return `${this.head}[${this.args.map((a) => a.toString()).join(", ")}]`;
  }
}

export const PRIMITIVES = new Set([
  "str",
  "int",
  "float",
  "bool",
  "bytes",
  "null",
  "Any",
]);

const STRUCTURAL_ARITY: Record<string, number> = {
  List: 1,
  Optional: 1,
  Dict: 2,
  Result: 2,
};

/** Parse a type string into a `Type`. Throws on junk. */
export function parseType(text: string): Type {
  const toks = tokenize(text);
  const [node, rest] = parse(toks);
  if (rest.length) {
    throw new Error(`trailing tokens in type ${JSON.stringify(text)}: ${rest}`);
  }
  return node;
}

function tokenize(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "[" || ch === "]" || ch === ",") {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      if (ch !== ",") out.push(ch);
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parse(toks: string[]): [Type, string[]] {
  if (toks.length === 0) throw new Error("empty type");
  const [head, ...tail] = toks;
  let rest = tail;
  if (head === "[" || head === "]") {
    throw new Error(`unexpected bracket ${JSON.stringify(head)}`);
  }
  if (rest.length && rest[0] === "[") {
    const args: Type[] = [];
    rest = rest.slice(1);
    while (rest.length && rest[0] !== "]") {
      const [arg, next] = parse(rest);
      args.push(arg);
      rest = next;
    }
    if (!rest.length || rest[0] !== "]") {
      throw new Error(`unbalanced brackets after ${JSON.stringify(head)}`);
    }
    rest = rest.slice(1); // drop ']'
    // Structural constructors have a declared arity; Tuple is variadic.
    if (head in STRUCTURAL_ARITY && args.length !== STRUCTURAL_ARITY[head]) {
      throw new Error(
        `${head} expects ${STRUCTURAL_ARITY[head]} args, got ${args.length}`,
      );
    }
    return [new Type(head, args), rest];
  }
  return [new Type(head), rest];
}

/** True if a value of type `a` is acceptable where `b` is expected. */
export function isSubtype(a: Type, b: Type): boolean {
  if (b.head === "Any") return true;
  // `Any` is also unconstrained on the source side: a value whose type we did
  // not pin (e.g. an inferred skill output) is accepted anywhere. This keeps the
  // high-level `skill()` API free of type-wiring friction while explicit nominal
  // types still get strict checking.
  if (a.head === "Any") return true;
  // null inhabits any Optional.
  if (a.head === "null" && b.head === "Optional") return true;
  // T <: Optional[T]  (a present value is an acceptable optional)
  if (b.head === "Optional" && a.head !== "Optional") {
    return isSubtype(a, b.args[0]);
  }
  if (a.head === "Optional" && b.head === "Optional") {
    return isSubtype(a.args[0], b.args[0]);
  }
  if (a.head !== b.head) return false;
  if (a.args.length !== b.args.length) return false;
  // Covariant in all arguments (conservative but safe for plan wiring).
  return a.args.every((x, i) => isSubtype(x, b.args[i]));
}

/** Convenience wrapper over `parseType` + `isSubtype`. */
export function isSubtypeStr(a: string, b: string): boolean {
  return isSubtype(parseType(a), parseType(b));
}
