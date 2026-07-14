/**
 * The skill substrate.
 *
 * Ported from `oya_planner/skills.py` (spec/plan-ir.md §6). A skill is a
 * deterministic unit the runtime executes in isolation. Skills declare typed
 * I/O, purity (pure skills are cacheable), a cost annotation used by the static
 * budget check, and optional SUMMARY projection functions for their output types.
 *
 * A `Catalog` is the planner's procedural memory: it holds skills and emits a
 * `CatalogSnapshot` the planner reasons over.
 *
 * Skill functions take a single object of named parameters and may be async - a
 * deliberate divergence from the synchronous Python reference, since real skills
 * do I/O.
 */

import { createHash } from "node:crypto";

import type { z, ZodType, ZodTypeAny } from "zod";

import { CatalogSnapshot, SkillEntry } from "./ir.js";
import * as projector from "./projection/projector.js";
import type { Projector } from "./projection/projector.js";

export type SkillFn = (args: Record<string, unknown>) => unknown | Promise<unknown>;

/** A deterministic JSON encoding with sorted object keys (json.dumps sort_keys). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

function sha256hex(s: string, n = 16): string {
  return createHash("sha256").update(s).digest("hex").slice(0, n);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export interface SkillInit {
  name: string;
  version: number;
  fn: SkillFn;
  inputSig: Record<string, string>;
  outputSig: Record<string, string>;
  pure?: boolean;
  costMaxTokens?: number;
  costMaxSeconds?: number;
  /**
   * Model-facing usage doc shown to the planner: what the skill does and the
   * allowed values (enums) for its parameters - without this the planner guesses
   * `args` (e.g. action="create" vs "create_pdf").
   */
  description?: string;
  /** output type name -> bounded projection function (registered globally too) */
  projectors?: Record<string, Projector>;
}

export class Skill {
  name: string;
  version: number;
  fn: SkillFn;
  inputSig: Record<string, string>;
  outputSig: Record<string, string>;
  pure: boolean;
  costMaxTokens: number;
  costMaxSeconds: number;
  description: string;
  projectors: Record<string, Projector>;

  constructor(init: SkillInit) {
    this.name = init.name;
    this.version = init.version;
    this.fn = init.fn;
    this.inputSig = init.inputSig;
    this.outputSig = init.outputSig;
    this.pure = init.pure ?? false;
    this.costMaxTokens = init.costMaxTokens ?? 0;
    this.costMaxSeconds = init.costMaxSeconds ?? 0;
    this.description = init.description ?? "";
    this.projectors = init.projectors ?? {};
  }

  get ref(): string {
    return `${this.name}@${this.version}`;
  }

  sigHash(): string {
    return sha256hex(stableStringify({ in: this.inputSig, out: this.outputSig }));
  }

  toEntry(): SkillEntry {
    return new SkillEntry({
      name: this.name,
      version: this.version,
      inputSig: { ...this.inputSig },
      outputSig: { ...this.outputSig },
      sigHash: this.sigHash(),
      pure: this.pure,
      costMaxTokens: this.costMaxTokens,
      costMaxSeconds: this.costMaxSeconds,
      description: this.description,
    });
  }

  /**
   * Map a skill's return value onto its declared output handles.
   *
   * A single-output skill returns the value directly (even when that value is
   * itself an object). A multi-output skill returns an object keyed by output
   * name, or a positional array.
   */
  normaliseResult(result: unknown): Record<string, unknown> {
    const names = Object.keys(this.outputSig);
    if (names.length === 1) {
      return { [names[0]]: result };
    }
    if (isPlainObject(result)) {
      const missing = names.filter((n) => !(n in result));
      if (missing.length) {
        throw new Error(`${this.ref} did not return outputs ${JSON.stringify(missing)}`);
      }
      return Object.fromEntries(names.map((n) => [n, result[n]]));
    }
    if (Array.isArray(result) && result.length === names.length) {
      return Object.fromEntries(names.map((n, i) => [n, result[i]]));
    }
    throw new Error(
      `${this.ref} returned ${typeof result}; expected object or ${names.length}-tuple ` +
        `for outputs ${JSON.stringify(names)}`,
    );
  }
}

/** A registry of skills + the snapshot the planner sees. */
export class Catalog {
  private readonly hash: string;
  private readonly skills = new Map<string, Skill>();

  constructor(hash = "catalog") {
    this.hash = hash;
  }

  /** Decorator-style registration: `catalog.register(init)(fn)` returns the skill. */
  register(init: Omit<SkillInit, "fn">): (fn: SkillFn) => Skill {
    return (fn: SkillFn): Skill => {
      const skill = new Skill({ ...init, fn });
      this.add(skill);
      return skill;
    };
  }

  add(skill: Skill): void {
    for (const [typeName, fn] of Object.entries(skill.projectors)) {
      projector.register(typeName, fn);
    }
    this.skills.set(skill.ref, skill);
  }

  get(ref: string): Skill | undefined {
    return this.skills.get(ref);
  }

  snapshot(): CatalogSnapshot {
    const skills = [...this.skills.values()].map((s) => s.toEntry());
    const refs = skills.map((s) => `${s.ref}:${s.sigHash ?? ""}`).sort();
    const digest = sha256hex(JSON.stringify(refs));
    return new CatalogSnapshot({ hash: `${this.hash}:${digest}`, skills });
  }
}

// --- the ergonomic skill() helper -----------------------------------------

export interface SkillConfig<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  /** Stable identifier. If omitted, derived from `description`. */
  name?: string;
  /** What the skill does + allowed param values - shown to the planner. */
  description?: string;
  version?: number;
  /** Pure skills are memoised on (ref, inputs). */
  pure?: boolean;
  /** A zod schema for the named inputs; the IR signature is inferred from it. */
  input?: I;
  /** Optional zod schema for the return value (validated; type inferred). */
  output?: ZodType<O>;
  /** Bounded SUMMARY projections for nominal output types. */
  projectors?: Record<string, Projector>;
  run: (input: z.infer<I>) => O | Promise<O>;
}

/**
 * Define a skill with zero IR ceremony: types are inferred from the zod schema,
 * projection levels default to OPAQUE, the version defaults to 1. Returns a
 * `Skill` ready to hand to an `Agent`.
 */
export function skill<I extends ZodTypeAny = ZodTypeAny, O = unknown>(
  config: SkillConfig<I, O>,
): Skill {
  const name = config.name ?? slug(config.description ?? "");
  if (!name) {
    throw new Error("skill() requires a 'name' (or a 'description' to derive one)");
  }
  const inputSchema = config.input;
  const outputSchema = config.output;
  const fn: SkillFn = async (args) => {
    const parsed = inputSchema ? inputSchema.parse(args) : args;
    const result = await config.run(parsed as z.infer<I>);
    return outputSchema ? outputSchema.parse(result) : result;
  };
  return new Skill({
    name,
    version: config.version ?? 1,
    fn,
    inputSig: inputSchema ? sigFromObject(inputSchema) : {},
    outputSig: { out: outputSchema ? zodToType(outputSchema) : "Any" },
    pure: config.pure ?? false,
    description: config.description ?? "",
    projectors: config.projectors,
  });
}

// --- Mastra-compatible createTool() ---------------------------------------

/** Minimal Mastra-shaped execution context passed to a tool's `execute`. */
export interface ToolExecutionContext {
  runtimeContext: Record<string, unknown>;
}

export interface CreateToolOptions<I extends ZodTypeAny = ZodTypeAny, O = unknown> {
  id: string;
  description?: string;
  inputSchema?: I;
  outputSchema?: ZodType<O>;
  pure?: boolean;
  version?: number;
  projectors?: Record<string, Projector>;
  execute: (input: z.infer<I>, context?: ToolExecutionContext) => O | Promise<O>;
}

/**
 * Mastra-compatible tool builder. A drop-in for `@mastra/core`'s `createTool`:
 * the `id` becomes the skill name and `execute(input, context)` becomes the
 * skill's `run`. Returns an oya `Skill` you can pass to an `Agent` as a `tools`
 * map entry.
 */
export function createTool<I extends ZodTypeAny = ZodTypeAny, O = unknown>(
  opts: CreateToolOptions<I, O>,
): Skill {
  return skill<I, O>({
    name: opts.id,
    description: opts.description,
    version: opts.version,
    pure: opts.pure,
    input: opts.inputSchema,
    output: opts.outputSchema,
    projectors: opts.projectors,
    run: (input) => opts.execute(input, { runtimeContext: {} }),
  });
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .split("_")
    .filter(Boolean)
    .slice(0, 4)
    .join("_");
}

/** Build an IR input signature {param: type} from a zod object schema. */
function sigFromObject(schema: ZodTypeAny): Record<string, string> {
  const def = (schema as { _def?: { typeName?: string } })._def;
  if (def?.typeName === "ZodObject") {
    const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(shape)) out[k] = zodToType(v);
    return out;
  }
  // A non-object input becomes a single positional param.
  return { value: zodToType(schema) };
}

/** Map a zod schema onto the IR's small structural type system. */
function zodToType(schema: ZodTypeAny): string {
  const def = (schema as { _def?: Record<string, unknown> })._def ?? {};
  switch (def.typeName as string | undefined) {
    case "ZodString":
    case "ZodEnum":
      return "str";
    case "ZodNumber":
      return "float";
    case "ZodBoolean":
      return "bool";
    case "ZodLiteral": {
      const v = def.value;
      if (typeof v === "string") return "str";
      if (typeof v === "number") return "float";
      if (typeof v === "boolean") return "bool";
      return "Any";
    }
    case "ZodArray":
      return `List[${zodToType(def.type as ZodTypeAny)}]`;
    case "ZodOptional":
    case "ZodNullable":
      return `Optional[${zodToType(def.innerType as ZodTypeAny)}]`;
    case "ZodDefault":
      return zodToType(def.innerType as ZodTypeAny);
    default:
      return "Any";
  }
}
