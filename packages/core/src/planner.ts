/**
 * The planner: the model emits a plan once, the runtime executes it.
 *
 * Ported from `oya_planner/planner.py`. The planner model is engaged to (a) emit
 * a Plan IR for a mission, (b) run `extract` / `summarise` nodes scoped to a
 * single node, and (c) emit a replacement plan on a failure. It is never handed
 * an OPAQUE value — replan re-engagement sees only the projected handle table
 * (P4).
 *
 * The model is abstracted behind `LLMClient` so the runtime has no hard network
 * dependency; provider bridges (Anthropic / OpenAI / Google) land in a later
 * phase. Tests inject a fake client.
 */

import { check } from "./checker.js";
import { Executor, type ExecutionResult } from "./executor.js";
import { Mission, type Node, Plan } from "./ir.js";
import type { ModelResponse, ModelStreamChunk } from "./model.js";
import { Projection } from "./projection/level.js";
import type { Sandbox } from "./sandbox.js";
import type { Catalog } from "./skills.js";
import type { OyaEvent } from "./stream.js";
import { plannerView } from "./view.js";

/** Token totals across all model calls in a planner run. */
export interface PlannerUsage {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
}

/** The disclosure a node kind forces on the handles it reads (it must see them). */
const NODE_MIN_PROJECTION: Record<string, Projection> = {
  extract: Projection.TRANSPARENT,
  summarise: Projection.TRANSPARENT,
  branch: Projection.SUMMARY,
  for_each: Projection.SUMMARY,
};

/**
 * Raise handle projections to the level their consumer provably requires.
 *
 * A handle read by an `extract` / `summarise` node must be TRANSPARENT (the node
 * feeds it to the model); a handle a `branch` / `for_each` reads must be >=
 * SUMMARY. Planner models frequently under-declare these and the plan then fails
 * the projection check. The required level is deterministic, so set it here
 * rather than rejecting the plan. This never *lowers* a level and discloses
 * nothing the consuming node was not already going to read, so the
 * OPAQUE-by-default guarantee for non-consumed handles is unaffected.
 */
export function normalizeProjections(plan: Plan): void {
  const required = new Map<string, Projection>();
  for (const node of plan.nodes) {
    const level = NODE_MIN_PROJECTION[node.kind];
    if (level === undefined) continue;
    for (const hname of node.inputHandles()) {
      const prev = required.get(hname) ?? Projection.OPAQUE;
      required.set(hname, level > prev ? level : prev);
    }
  }
  if (required.size === 0) return;
  const byName = new Map(plan.handles.map((h) => [h.name, h]));
  for (const [hname, level] of required) {
    const handle = byName.get(hname);
    if (handle && handle.projection < level) handle.projection = level;
  }
}

export interface LLMClient {
  complete(req: { system: string; user: string }): string | ModelResponse | Promise<string | ModelResponse>;
  stream?(req: { system: string; user: string }): AsyncIterable<ModelStreamChunk>;
}

export class PlannerResult {
  ok: boolean;
  execution: ExecutionResult | null = null;
  plan: Plan | null = null;
  emitRetries = 0;
  replans = 0;
  error: string | null = null;
  usage: PlannerUsage = { inputTokens: 0, outputTokens: 0, modelCalls: 0 };

  constructor(ok: boolean) {
    this.ok = ok;
  }
}

/** Parse a JSON object out of a model response, tolerating code fences. */
export function parseJSON(text: string): Record<string, unknown> {
  let s = text.trim();
  if (s.startsWith("```")) {
    const fences = (s.match(/```/g) ?? []).length;
    s = fences >= 2 ? (s.split("```")[1] ?? s) : s.replace(/`/g, "");
    if (s.trimStart().toLowerCase().startsWith("json")) s = s.trimStart().slice(4);
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`no JSON object in LLM response: ${JSON.stringify(text.slice(0, 200))}`);
  }
  return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
}

export interface PlannerOptions {
  sandbox?: Sandbox;
  maxReplans?: number;
  maxEmitRetries?: number;
  /** Agent persona / guidance, woven into the planning system prompt. */
  instructions?: string;
  /** Streaming sink: receives plan / node / text-delta events as they happen. */
  onEvent?: (e: OyaEvent) => void;
}

export class Planner {
  private readonly sandbox?: Sandbox;
  private readonly maxReplans: number;
  private readonly maxEmitRetries: number;
  private readonly instructions?: string;
  private readonly onEvent?: (e: OyaEvent) => void;
  private currentUsage: PlannerUsage | null = null;

  constructor(
    private readonly catalog: Catalog,
    private readonly llm: LLMClient,
    opts: PlannerOptions = {},
  ) {
    this.sandbox = opts.sandbox;
    this.maxReplans = opts.maxReplans ?? 3;
    this.maxEmitRetries = opts.maxEmitRetries ?? 2;
    this.instructions = opts.instructions;
    this.onEvent = opts.onEvent;
  }

  // -- public ----------------------------------------------------------------

  async run(mission: string): Promise<PlannerResult> {
    const result = new PlannerResult(false);
    this.currentUsage = result.usage; // accumulate token usage across all calls
    let plan: Plan;
    try {
      plan = await this.emitPlan(mission, result);
    } catch (exc) {
      result.error = errMessage(exc);
      return result;
    }

    const executor = new Executor(this.catalog, {
      sandbox: this.sandbox,
      llmRunner: (node, kwargs) => this.nodeRunner(node, kwargs),
      onNode: this.onEvent
        ? (e) =>
            this.onEvent?.(
              e.phase === "start"
                ? { type: "node-start", nodeId: e.nodeId, kind: e.kind, skill: e.skill }
                : { type: "node-finish", nodeId: e.nodeId, kind: e.kind, handles: e.handles ?? {} },
            )
        : undefined,
    });

    while (true) {
      this.onEvent?.({ type: "plan", plan });
      const execution = await executor.run(plan);
      result.execution = execution;
      result.plan = plan;
      if (execution.ok) {
        result.ok = true;
        return result;
      }
      if (result.replans >= this.maxReplans) {
        result.error = `replan budget (${this.maxReplans}) exhausted`;
        return result;
      }
      result.replans += 1;
      try {
        plan = await this.emitReplan(plan, execution, mission, result);
      } catch (exc) {
        result.error = errMessage(exc);
        return result;
      }
    }
  }

  // -- LLM engagements -------------------------------------------------------

  /** One model call, normalising `string | ModelResponse` and tallying usage. */
  private async ask(system: string, user: string): Promise<string> {
    const r = await this.llm.complete({ system, user });
    if (this.currentUsage) this.currentUsage.modelCalls += 1;
    if (typeof r === "string") return r;
    if (this.currentUsage && r.usage) {
      this.currentUsage.inputTokens += r.usage.inputTokens;
      this.currentUsage.outputTokens += r.usage.outputTokens;
    }
    return r.text;
  }

  private async emitPlan(mission: string, result: PlannerResult): Promise<Plan> {
    const snapshot = this.catalog.snapshot();
    let priorErrors: string[] = [];
    for (let attempt = 0; attempt <= this.maxEmitRetries; attempt++) {
      const system = planningSystem(snapshot, priorErrors, this.instructions);
      const user = `Mission: "${mission}"\nEmit the Plan IR as a single JSON object.`;
      const raw = await this.ask(system, user);
      let plan: Plan;
      try {
        plan = this.materialise(raw, mission);
      } catch (exc) {
        // Malformed / truncated plan JSON: retry with the parse error fed back,
        // same as a static-check failure — don't abort the whole run on one bad emit.
        priorErrors = [`invalid_plan_json: ${errMessage(exc)}`];
        result.emitRetries = attempt + 1;
        continue;
      }
      const fatal = fatalErrors(check(plan));
      if (fatal.length === 0) return plan;
      priorErrors = fatal.map((e) => `${e.code}: ${e.message}`);
      result.emitRetries = attempt + 1;
    }
    throw new Error(`plan failed emit checks after retries: ${JSON.stringify(priorErrors)}`);
  }

  private async emitReplan(
    plan: Plan,
    execution: ExecutionResult,
    mission: string,
    _result: PlannerResult,
  ): Promise<Plan> {
    // P4: the planner sees only the projected handle table + the typed error.
    const projected = plannerView(plan, execution.table);
    const err = execution.error ? execution.error.projected() : { event: "Unknown" };
    const snapshot = this.catalog.snapshot();
    const system = planningSystem(snapshot, [], this.instructions);
    const user =
      "A node failed. Emit a corrected Plan IR (full replacement) reusing the still-valid handles.\n" +
      `Mission: "${mission}"\n` +
      `Failure: ${JSON.stringify(err)}\n` +
      `Projected state so far: ${JSON.stringify(projected)}`;
    const raw = await this.ask(system, user);
    const next = this.materialise(raw, mission);
    const fatal = fatalErrors(check(next));
    if (fatal.length) {
      throw new Error(`replan failed static checks: ${JSON.stringify(fatal.map((e) => e.code))}`);
    }
    return next;
  }

  /** Run an `extract` / `summarise` node via the model, scoped to the node. */
  private async nodeRunner(node: Node, kwargs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const outputs = node.outputHandles();
    // When streaming, a single-output summarise is the user-facing answer: stream
    // it as prose and emit text deltas instead of returning JSON.
    if (node.kind === "summarise" && this.onEvent && this.llm.stream && outputs.length === 1) {
      const system =
        "You are writing the final answer for the user. Read the inputs and reply in plain prose. No JSON.";
      const user = JSON.stringify({ node: node.id, inputs: kwargs });
      let acc = "";
      for await (const chunk of this.llm.stream({ system, user })) {
        acc += chunk.textDelta;
        this.onEvent({ type: "text-delta", delta: chunk.textDelta });
      }
      if (this.currentUsage) this.currentUsage.modelCalls += 1;
      return { [outputs[0]]: acc };
    }
    const system =
      `You are executing a single '${node.kind}' node. Read the inputs and ` +
      `return ONLY a JSON object mapping each output handle to its value. ` +
      `Output handles: ${JSON.stringify(outputs)}.`;
    const user = JSON.stringify({ node: node.id, inputs: kwargs });
    return parseJSON(await this.ask(system, user));
  }

  // -- helpers ---------------------------------------------------------------

  private materialise(raw: string, mission: string): Plan {
    const data = parseJSON(raw);
    const plan = Plan.fromJSON(data);
    // The planner — not the model — owns the catalogue snapshot and mission.
    plan.catalogSnapshot = this.catalog.snapshot();
    plan.mission = new Mission({ kind: plan.mission.kind, content: mission });
    normalizeProjections(plan);
    return plan;
  }
}

function errMessage(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc);
}

/**
 * Check codes that are advisory, not safety/correctness — a real model often
 * produces a plan with a stray unconsumed handle on a complex mission. Those are
 * wasteful, not invalid, so the runtime runs the plan anyway rather than failing.
 */
const WARNING_CODES = new Set(["handle_unconsumed"]);
function fatalErrors(res: { errors: { code: string; message: string }[] }) {
  return res.errors.filter((e) => !WARNING_CODES.has(e.code));
}

function planningSystem(
  snapshot: { skills: { name: string; version: number; inputSig: Record<string, string>; outputSig: Record<string, string>; description?: string }[] },
  priorErrors: string[],
  instructions?: string,
): string {
  const skills = snapshot.skills.map((s) => ({
    ref: `${s.name}@${s.version}`,
    in: s.inputSig,
    out: s.outputSig,
    ...(s.description ? { doc: s.description } : {}),
  }));
  // The example deliberately mirrors a multi-source task (search -> fetch several
  // pages -> combine -> report -> reply): that fan-in is exactly where naming
  // consistency breaks down, so the model has a correct pattern to copy.
  const example = {
    plan_id: "example",
    handles: [
      { name: "query", type: "str", projection: "TRANSPARENT", origin: "n0" },
      { name: "hits", type: "json", projection: "OPAQUE", origin: "n1" },
      { name: "page_1", type: "str", projection: "OPAQUE", origin: "n2" },
      { name: "page_2", type: "str", projection: "OPAQUE", origin: "n3" },
      { name: "report", type: "str", projection: "OPAQUE", origin: "n4" },
      { name: "pdf", type: "str", projection: "OPAQUE", origin: "n5" },
      { name: "answer", type: "str", projection: "TRANSPARENT", origin: "n6" },
    ],
    nodes: [
      { id: "n0", kind: "extract", inputs: ["mission"], outputs: ["query"] },
      { id: "n1", kind: "skill", skill: "search@1", inputs: { query: "query" }, outputs: ["hits"] },
      { id: "n2", kind: "skill", skill: "fetch_url@1", inputs: { url: "hits" }, outputs: ["page_1"] },
      { id: "n3", kind: "skill", skill: "fetch_url@1", inputs: { url: "hits" }, outputs: ["page_2"] },
      { id: "n4", kind: "skill", skill: "make_report@1", inputs: { sources: "page_1" }, outputs: ["report"] },
      { id: "n5", kind: "skill", skill: "make_pdf@1", inputs: { content: "report" }, outputs: ["pdf"] },
      { id: "n6", kind: "summarise", inputs: ["query"], outputs: ["answer"] },
    ],
    exits: ["answer", "pdf"],
  };
  const parts = [
    "You are a planner that emits ONE typed dataflow Plan IR as a JSON object. No prose, no markdown fences — start with { and end with }.",
    // The wiring invariant — stated first and bluntly, because handle_undefined and
    // handle_no_producer (mis-matched names) are the failures that abort plans.
    "WIRING INVARIANT — the plan is a graph wired ONLY by handle NAMES, so names must " +
      "match EXACTLY everywhere. (1) Every name you use in a node's 'inputs' MUST be the " +
      "exact 'outputs' name of some EARLIER node — copy it character-for-character; never " +
      "invent a new name on the consuming side, never reference a handle a node has not " +
      "produced yet. (2) Every handle in the top-level 'handles' array is produced by " +
      "exactly ONE node: its 'origin' is that node's id and the name appears in that " +
      "node's 'outputs'. (3) Every name in any node's 'outputs' MUST also appear once in " +
      "'handles'. If you write 'page_1' as an output, spell it 'page_1' in handles and in " +
      "every consumer — not 'page1', 'source_1', or 'pages'. Before finishing, re-read the " +
      "plan and confirm every inputs name resolves to an earlier outputs name.",
    "A skill node binds the skill's parameters two ways: 'inputs' = HANDLE references " +
      "(values PRODUCED by other nodes), 'args' = LITERAL constant values you supply " +
      "directly (strings/numbers/bools). Prefer the name-keyed form: " +
      '"inputs": {"<param>": "<handle>"} and "args": {"<param>": "<value>"}. Each ' +
      "parameter is filled by EITHER inputs OR args, never both. Use ONLY parameter names " +
      "that the skill declares in the catalogue below. NEVER put a literal value in " +
      "'inputs' (those are handle names, not values) and never put a handle name in " +
      "'args'. 'outputs' is an array of the handle names the node produces.",
    "Use kind 'skill' for EVERY catalogue skill below (deterministic). Use 'extract' " +
      "only to pull a value from a TRANSPARENT text input when NO catalogue skill does " +
      "it; 'summarise' only for a user-facing summary.",
    // Minimality — cuts the extract->extract->extract noise and the token/round-trip
    // variance it causes; also keeps the plan JSON short enough not to truncate.
    "Emit the MINIMAL plan: the fewest nodes that satisfy the mission — ideally ONE node " +
      "per catalogue action the mission names, plus one leading 'extract' only if a skill " +
      "needs a value pulled from the mission text, plus the final 'summarise'. Do NOT add " +
      "extra extract/summarise nodes, do NOT chain extract into extract, and do NOT " +
      "re-fetch or re-process a value you already have as a handle.",
    "Plan ALL of the actions the mission asks for: if it requests several things, emit " +
      "a node for EACH one and list each result in 'exits'. Do not drop requested steps.",
    "ALWAYS end with a 'summarise' node that writes the final natural-language reply to " +
      "the user as a TRANSPARENT handle, and include that handle in 'exits'. Even an " +
      "action-heavy mission needs a reply — never finish with only artifacts and no answer.",
    "Projection (disclosure to you, the planner): default EVERY handle to OPAQUE. Use " +
      "TRANSPARENT ONLY for the final user-facing outputs and for a handle that an " +
      "extract/summarise node must read. Use SUMMARY ONLY for a handle a branch " +
      "predicate reads. A value passed from one skill to another (a URL, id, document, " +
      "payload) MUST stay OPAQUE. 'mission' is an implicit TRANSPARENT input you may " +
      "read. branch/for_each inputs must be >= SUMMARY; extract/summarise inputs must " +
      "be TRANSPARENT.",
    "origin is the id of the node that produces the handle.",
    `Example plan (note how every inputs name matches an earlier outputs name exactly): ${JSON.stringify(example)}`,
    `Catalogue (use these exact name@version refs and ONLY their declared parameter names): ${JSON.stringify(skills)}`,
  ];
  if (instructions) {
    parts.unshift(`Agent instructions (persona / guidance): ${instructions}`);
  }
  if (priorErrors.length) {
    parts.push("Your previous plan failed these checks; fix them: " + JSON.stringify(priorErrors));
  }
  return parts.join("\n");
}
