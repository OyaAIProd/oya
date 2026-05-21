/**
 * The Plan IR data model.
 *
 * Ported from `oya_planner/ir.py` — a faithful encoding of spec/plan-ir.md §3, a
 * typed dataflow DAG of named handles that a planner model can emit in one
 * structured-output call and the runtime can analyse and execute
 * deterministically.
 *
 * Every node exposes `inputHandles()` / `outputHandles()` so the static checker
 * and executor can build the dataflow graph uniformly, whatever the node kind.
 *
 * The IR tolerates the shapes real planner models emit: inputs/outputs as a
 * `{param: handle}` map, `null` entries for optional parameters the planner left
 * unfilled (kept positionally), and the `else` key for a branch's otherwise arm.
 */

import { Projection, parseProjection, projectionName } from "./projection/level.js";

/** The mission text is an implicit, always-present TRANSPARENT handle. */
export const MISSION_HANDLE = "mission";

const SKILL_REF_RE = /^([A-Za-z_][\w-]*)@(\d+)$/;

/** Inputs accepted on a param node: a name-keyed map or a positional list. */
export type Inputs = Record<string, string | null> | (string | null)[];
type HandleListArg = (string | null)[] | Record<string, string | null>;

function asHandleList(v: HandleListArg | null | undefined): (string | null)[] {
  // Planner models often emit inputs/outputs as a {name: handle} map; accept
  // that and keep the handle names in order.
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  return Object.values(v);
}

/** The real handle names referenced by an inputs value (map or list). */
function handleNames(inputs: Inputs): string[] {
  const values = Array.isArray(inputs) ? inputs : Object.values(inputs);
  return values.filter((h): h is string => Boolean(h));
}

/** Drop null / empty entries — the graph and static checks only see real handles. */
function present(handles: (string | null)[]): string[] {
  return handles.filter((h): h is string => Boolean(h));
}

// --- skill references -----------------------------------------------------

/** A `name@version` reference. Versions are required and immutable. */
export class SkillRef {
  constructor(
    readonly name: string,
    readonly version: number,
  ) {}

  static parse(ref: string): SkillRef {
    const m = SKILL_REF_RE.exec(ref.trim());
    if (!m) {
      throw new Error(`bad skill ref ${JSON.stringify(ref)}; expected 'name@version'`);
    }
    return new SkillRef(m[1], parseInt(m[2], 10));
  }

  toString(): string {
    return `${this.name}@${this.version}`;
  }
}

// --- handles --------------------------------------------------------------

export interface HandleInit {
  name: string;
  type: string;
  projection?: Projection | string;
  origin?: string | null;
}

/** A named, typed edge value with a fixed projection level. */
export class Handle {
  name: string;
  type: string;
  projection: Projection;
  origin: string | null;

  constructor(init: HandleInit) {
    this.name = init.name;
    this.type = init.type;
    this.projection =
      init.projection === undefined ? Projection.OPAQUE : parseProjection(init.projection);
    this.origin = init.origin ?? null;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      projection: projectionName(this.projection),
      origin: this.origin,
    };
  }
}

// --- nodes ----------------------------------------------------------------

export type NodeKind =
  | "skill"
  | "extract"
  | "branch"
  | "for_each"
  | "summarise"
  | "replan"
  | "subplan";

export abstract class NodeBase {
  abstract readonly kind: NodeKind;
  id: string;

  constructor(id: string) {
    this.id = id;
  }

  inputHandles(): string[] {
    return [];
  }

  /** Inputs with null placeholders preserved, for positional param binding. */
  positionalInputs(): (string | null)[] {
    return this.inputHandles();
  }

  outputHandles(): string[] {
    return [];
  }

  /** Node ids this node may hand control to (branch arms, loop body). */
  controlTargets(): string[] {
    return [];
  }

  abstract toJSON(): Record<string, unknown>;
}

interface ParamNodeInit {
  id: string;
  inputs?: Inputs;
  args?: Record<string, unknown>;
  outputs?: HandleListArg;
}

/** A node that binds skill parameters from handle inputs + literal args. */
abstract class ParamNode extends NodeBase {
  inputs: Inputs;
  /**
   * Literal constant arguments keyed by parameter name (e.g.
   * `{action: "create", file_path: "report.pdf"}`) — values the skill needs that
   * no upstream node produces. They never become handles and are never disclosed
   * back to the planner.
   */
  args: Record<string, unknown>;
  outputs: (string | null)[];

  constructor(init: ParamNodeInit) {
    super(init.id);
    this.inputs = init.inputs ?? [];
    this.args = init.args ?? {};
    this.outputs = asHandleList(init.outputs ?? []);
  }

  override inputHandles(): string[] {
    return handleNames(this.inputs);
  }

  override positionalInputs(): (string | null)[] {
    // Positional binding applies only to the list form.
    return Array.isArray(this.inputs) ? [...this.inputs] : [];
  }

  /** `{param: handle}` when inputs is name-keyed, else `{}`. */
  inputBindings(): Record<string, string> {
    if (Array.isArray(this.inputs)) return {};
    const out: Record<string, string> = {};
    for (const [p, h] of Object.entries(this.inputs)) {
      if (h) out[p] = h;
    }
    return out;
  }

  override outputHandles(): string[] {
    return present(this.outputs);
  }

  protected paramJSON(): Record<string, unknown> {
    return { inputs: this.inputs, args: this.args, outputs: this.outputs };
  }
}

export interface SkillNodeInit extends ParamNodeInit {
  skill: string;
  failureProjection?: Projection | string;
}

export class SkillNode extends ParamNode {
  readonly kind = "skill" as const;
  skill: string;
  failureProjection: Projection;

  constructor(init: SkillNodeInit) {
    super(init);
    this.skill = init.skill;
    this.failureProjection =
      init.failureProjection === undefined
        ? Projection.OPAQUE
        : parseProjection(init.failureProjection);
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      skill: this.skill,
      failure_projection: projectionName(this.failureProjection),
      ...this.paramJSON(),
    };
  }
}

export interface ExtractNodeInit extends ParamNodeInit {
  skill?: string;
}

/**
 * Model-implemented typed extraction from a TRANSPARENT input. `skill` is
 * optional: when omitted (or not a catalogue skill) the runtime runs the
 * extraction with the planner model scoped to this node.
 */
export class ExtractNode extends ParamNode {
  readonly kind = "extract" as const;
  skill: string;

  constructor(init: ExtractNodeInit) {
    super(init);
    this.skill = init.skill ?? "";
  }

  toJSON(): Record<string, unknown> {
    return { id: this.id, kind: this.kind, skill: this.skill, ...this.paramJSON() };
  }
}

export interface BranchNodeInit {
  id: string;
  predicate: string;
  inputs?: HandleListArg;
  then?: string[];
  otherwise?: string[];
}

export class BranchNode extends NodeBase {
  readonly kind = "branch" as const;
  predicate: string;
  inputs: (string | null)[];
  then: string[];
  otherwise: string[];

  constructor(init: BranchNodeInit) {
    super(init.id);
    this.predicate = init.predicate;
    this.inputs = asHandleList(init.inputs ?? []);
    this.then = init.then ?? [];
    this.otherwise = init.otherwise ?? [];
  }

  override inputHandles(): string[] {
    return present(this.inputs);
  }

  override controlTargets(): string[] {
    return [...this.then, ...this.otherwise];
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      predicate: this.predicate,
      inputs: this.inputs,
      then: this.then,
      else: this.otherwise,
    };
  }
}

export interface ForEachNodeInit {
  id: string;
  over: string;
  body?: string[];
  bound?: number | string | null;
}

export class ForEachNode extends NodeBase {
  readonly kind = "for_each" as const;
  over: string;
  body: string[];
  bound: number | string | null;

  constructor(init: ForEachNodeInit) {
    super(init.id);
    this.over = init.over;
    this.body = init.body ?? [];
    this.bound = init.bound ?? null;
  }

  override inputHandles(): string[] {
    return [this.over];
  }

  override controlTargets(): string[] {
    return [...this.body];
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      kind: this.kind,
      over: this.over,
      body: this.body,
      bound: this.bound,
    };
  }
}

export interface SummariseNodeInit {
  id: string;
  inputs?: HandleListArg;
  outputs?: HandleListArg;
}

/** Produces a TRANSPARENT summary of handles for the user (model node). */
export class SummariseNode extends NodeBase {
  readonly kind = "summarise" as const;
  inputs: (string | null)[];
  outputs: (string | null)[];

  constructor(init: SummariseNodeInit) {
    super(init.id);
    this.inputs = asHandleList(init.inputs ?? []);
    this.outputs = asHandleList(init.outputs ?? []);
  }

  override inputHandles(): string[] {
    return present(this.inputs);
  }

  override outputHandles(): string[] {
    return present(this.outputs);
  }

  toJSON(): Record<string, unknown> {
    return { id: this.id, kind: this.kind, inputs: this.inputs, outputs: this.outputs };
  }
}

/** Runtime-inserted on a drift/failure event. Never emitted by the planner. */
export class ReplanNode extends NodeBase {
  readonly kind = "replan" as const;

  toJSON(): Record<string, unknown> {
    return { id: this.id, kind: this.kind };
  }
}

export interface SubplanNodeInit extends ParamNodeInit {
  planId: string;
}

export class SubplanNode extends ParamNode {
  readonly kind = "subplan" as const;
  planId: string;

  constructor(init: SubplanNodeInit) {
    super(init);
    this.planId = init.planId;
  }

  toJSON(): Record<string, unknown> {
    return { id: this.id, kind: this.kind, plan_id: this.planId, ...this.paramJSON() };
  }
}

export type Node =
  | SkillNode
  | ExtractNode
  | BranchNode
  | ForEachNode
  | SummariseNode
  | ReplanNode
  | SubplanNode;

/** Build a node from its raw (LLM/JSON) form, dispatching on `kind`. */
export function nodeFromJSON(raw: Record<string, unknown>): Node {
  const kind = raw.kind as NodeKind;
  const id = raw.id as string;
  const inputs = raw.inputs as Inputs | undefined;
  const args = raw.args as Record<string, unknown> | undefined;
  const outputs = raw.outputs as HandleListArg | undefined;
  switch (kind) {
    case "skill":
      return new SkillNode({
        id,
        skill: raw.skill as string,
        inputs,
        args,
        outputs,
        failureProjection: raw.failure_projection as string | undefined,
      });
    case "extract":
      return new ExtractNode({ id, skill: raw.skill as string | undefined, inputs, args, outputs });
    case "branch":
      return new BranchNode({
        id,
        predicate: raw.predicate as string,
        inputs: raw.inputs as HandleListArg | undefined,
        then: raw.then as string[] | undefined,
        // Accept both the spec's `else` and the field name `otherwise`.
        otherwise: (raw.else ?? raw.otherwise) as string[] | undefined,
      });
    case "for_each":
      return new ForEachNode({
        id,
        over: raw.over as string,
        body: raw.body as string[] | undefined,
        bound: raw.bound as number | string | null | undefined,
      });
    case "summarise":
      return new SummariseNode({
        id,
        inputs: raw.inputs as HandleListArg | undefined,
        outputs: raw.outputs as HandleListArg | undefined,
      });
    case "replan":
      return new ReplanNode(id);
    case "subplan":
      return new SubplanNode({ id, planId: raw.plan_id as string, inputs, args, outputs });
    default:
      throw new Error(`unknown node kind ${JSON.stringify(kind)}`);
  }
}

// --- catalogue ------------------------------------------------------------

export interface SkillEntryInit {
  name: string;
  version: number;
  inputSig?: Record<string, string>;
  outputSig?: Record<string, string>;
  sigHash?: string | null;
  pure?: boolean;
  costMaxTokens?: number;
  costMaxSeconds?: number;
  description?: string;
}

export class SkillEntry {
  name: string;
  version: number;
  inputSig: Record<string, string>;
  outputSig: Record<string, string>;
  sigHash: string | null;
  pure: boolean;
  costMaxTokens: number;
  costMaxSeconds: number;
  description: string;

  constructor(init: SkillEntryInit) {
    this.name = init.name;
    this.version = init.version;
    this.inputSig = init.inputSig ?? {};
    this.outputSig = init.outputSig ?? {};
    this.sigHash = init.sigHash ?? null;
    this.pure = init.pure ?? false;
    this.costMaxTokens = init.costMaxTokens ?? 0;
    this.costMaxSeconds = init.costMaxSeconds ?? 0;
    this.description = init.description ?? "";
  }

  get ref(): string {
    return `${this.name}@${this.version}`;
  }

  static fromJSON(raw: Record<string, unknown>): SkillEntry {
    return new SkillEntry({
      name: raw.name as string,
      version: raw.version as number,
      inputSig: (raw.input_sig ?? raw.inputSig) as Record<string, string> | undefined,
      outputSig: (raw.output_sig ?? raw.outputSig) as Record<string, string> | undefined,
      sigHash: (raw.sig_hash ?? raw.sigHash) as string | null | undefined,
      pure: raw.pure as boolean | undefined,
      costMaxTokens: (raw.cost_max_tokens ?? raw.costMaxTokens) as number | undefined,
      costMaxSeconds: (raw.cost_max_seconds ?? raw.costMaxSeconds) as number | undefined,
      description: raw.description as string | undefined,
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      version: this.version,
      input_sig: this.inputSig,
      output_sig: this.outputSig,
      sig_hash: this.sigHash,
      pure: this.pure,
      cost_max_tokens: this.costMaxTokens,
      cost_max_seconds: this.costMaxSeconds,
      description: this.description,
    };
  }
}

export class CatalogSnapshot {
  hash: string;
  skills: SkillEntry[];

  constructor(init: { hash?: string; skills?: SkillEntry[] } = {}) {
    this.hash = init.hash ?? "";
    this.skills = init.skills ?? [];
  }

  resolve(ref: string): SkillEntry | null {
    const sr = SkillRef.parse(ref);
    for (const s of this.skills) {
      if (s.name === sr.name && s.version === sr.version) return s;
    }
    return null;
  }

  static fromJSON(raw: Record<string, unknown>): CatalogSnapshot {
    const skills = ((raw.skills as Record<string, unknown>[]) ?? []).map((s) =>
      SkillEntry.fromJSON(s),
    );
    return new CatalogSnapshot({ hash: raw.hash as string | undefined, skills });
  }

  toJSON(): Record<string, unknown> {
    return { hash: this.hash, skills: this.skills.map((s) => s.toJSON()) };
  }
}

export class Mission {
  kind: string;
  content: string;

  constructor(init: { kind?: string; content?: string } = {}) {
    this.kind = init.kind ?? "user_request";
    this.content = init.content ?? "";
  }

  toJSON(): Record<string, unknown> {
    return { kind: this.kind, content: this.content };
  }
}

export class CostBudget {
  maxTokens: number;
  maxSeconds: number;

  constructor(init: { maxTokens?: number; maxSeconds?: number } = {}) {
    this.maxTokens = init.maxTokens ?? 1_000_000;
    this.maxSeconds = init.maxSeconds ?? 1e9;
  }

  static fromJSON(raw: Record<string, unknown>): CostBudget {
    return new CostBudget({
      maxTokens: (raw.max_tokens ?? raw.maxTokens) as number | undefined,
      maxSeconds: (raw.max_seconds ?? raw.maxSeconds) as number | undefined,
    });
  }

  toJSON(): Record<string, unknown> {
    return { max_tokens: this.maxTokens, max_seconds: this.maxSeconds };
  }
}

export interface PlanInit {
  planId?: string;
  mission?: Mission;
  catalogSnapshot?: CatalogSnapshot;
  handles?: Handle[];
  nodes?: Node[];
  exits?: string[];
  budget?: CostBudget;
}

export class Plan {
  planId: string;
  mission: Mission;
  catalogSnapshot: CatalogSnapshot;
  handles: Handle[];
  nodes: Node[];
  exits: string[];
  budget: CostBudget;

  constructor(init: PlanInit = {}) {
    this.planId = init.planId ?? "";
    this.mission = init.mission ?? new Mission();
    this.catalogSnapshot = init.catalogSnapshot ?? new CatalogSnapshot();
    this.handles = init.handles ?? [];
    this.nodes = init.nodes ?? [];
    this.exits = init.exits ?? [];
    this.budget = init.budget ?? new CostBudget();
  }

  /** Look up a handle by name. `mission` is an implicit TRANSPARENT handle. */
  handle(name: string): Handle | null {
    if (name === MISSION_HANDLE) {
      return new Handle({
        name: MISSION_HANDLE,
        type: "str",
        projection: Projection.TRANSPARENT,
        origin: "mission",
      });
    }
    for (const h of this.handles) {
      if (h.name === name) return h;
    }
    return null;
  }

  node(nodeId: string): Node | null {
    for (const n of this.nodes) {
      if (n.id === nodeId) return n;
    }
    return null;
  }

  static fromJSON(raw: Record<string, unknown>): Plan {
    return new Plan({
      planId: (raw.plan_id ?? raw.planId) as string | undefined,
      mission: raw.mission
        ? new Mission(raw.mission as { kind?: string; content?: string })
        : undefined,
      catalogSnapshot:
        (raw.catalog_snapshot ?? raw.catalogSnapshot)
          ? CatalogSnapshot.fromJSON(
              (raw.catalog_snapshot ?? raw.catalogSnapshot) as Record<string, unknown>,
            )
          : undefined,
      handles: ((raw.handles as Record<string, unknown>[]) ?? []).map(
        (h) => new Handle(h as unknown as HandleInit),
      ),
      nodes: ((raw.nodes as Record<string, unknown>[]) ?? []).map((n) => nodeFromJSON(n)),
      exits: raw.exits as string[] | undefined,
      budget:
        (raw.budget as Record<string, unknown> | undefined) &&
        CostBudget.fromJSON(raw.budget as Record<string, unknown>),
    });
  }

  toJSON(): Record<string, unknown> {
    return {
      plan_id: this.planId,
      mission: this.mission.toJSON(),
      catalog_snapshot: this.catalogSnapshot.toJSON(),
      handles: this.handles.map((h) => h.toJSON()),
      nodes: this.nodes.map((n) => n.toJSON()),
      exits: this.exits,
      budget: this.budget.toJSON(),
    };
  }
}
