/**
 * The high-level agent surface - Mastra-compatible.
 *
 * `new Agent({ name, instructions, model, tools }).generate(prompt)` mirrors
 * `@mastra/core`'s Agent so a Mastra app migrates by swapping imports. Under the
 * hood it runs oya's `Planner` (emit → static check → execute, plan-don't-react)
 * and returns a Mastra-shaped result (`{ text }`). The oya-native `skills` config
 * and `run()` method are also supported.
 */

import { Projection } from "./projection/level.js";
import { Planner, type PlannerResult, type PlannerUsage } from "./planner.js";
import type { LanguageModel } from "./model.js";
import type { Sandbox } from "./sandbox.js";
import { Catalog, type Skill } from "./skills.js";
import { EventStream, type StreamResult } from "./stream.js";

export interface AgentOptions {
  /** Cosmetic identifiers (Mastra parity). */
  id?: string;
  name?: string;
  /** Agent persona / guidance, woven into planning (Mastra parity). */
  instructions?: string;
  model: LanguageModel;
  /** Mastra-style: a name→tool map (from `createTool`). */
  tools?: Record<string, Skill>;
  /** oya-native: skills as an array or a name→skill map. */
  skills?: Skill[] | Record<string, Skill>;
  maxReplans?: number;
  maxEmitRetries?: number;
  sandbox?: Sandbox;
}

export interface AgentResult {
  ok: boolean;
  /** The user-facing answer: the TRANSPARENT exit(s) of the executed plan. */
  output: unknown;
  /** Every exit value (full fidelity, server-side). */
  outputs: Record<string, unknown>;
  /** Token totals across all model calls (Mastra parity). */
  usage: PlannerUsage;
  error: string | null;
  /** The full planner result, for inspection / observability. */
  result: PlannerResult;
}

/** Mastra-shaped result of `agent.generate()`. `text` is the headline field. */
export interface GenerateResult extends AgentResult {
  text: string;
}

type Messages = string | { role: string; content: string }[];

export class Agent {
  private readonly catalog = new Catalog();
  private readonly opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
    for (const s of collectSkills(opts.skills)) this.catalog.add(s);
    for (const s of Object.values(opts.tools ?? {})) this.catalog.add(s);
  }

  /** oya-native: run a mission and return the projected outputs. */
  async run(prompt: string): Promise<AgentResult> {
    const planner = new Planner(this.catalog, this.opts.model, this.opts);
    const result = await planner.run(prompt);
    const outputs = result.execution?.exits ?? {};
    return {
      ok: result.ok,
      output: pickOutput(result, outputs),
      outputs,
      usage: result.usage,
      error: result.error,
      result,
    };
  }

  /** Mastra-compatible: `await agent.generate(prompt)` → `{ text }`. */
  async generate(messages: Messages, _options?: Record<string, unknown>): Promise<GenerateResult> {
    const res = await this.run(toPrompt(messages));
    const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output ?? "");
    return { ...res, text };
  }

  /**
   * Mastra-compatible streaming. Returns `{ fullStream, textStream, text, result }`
   * - `fullStream` carries structured events (plan, node-start/finish with
   * projected handles, text deltas, finish); `textStream` yields just the answer
   * deltas. The run executes in the background as you consume.
   */
  stream(messages: Messages, _options?: Record<string, unknown>): StreamResult {
    const prompt = toPrompt(messages);
    const es = new EventStream();
    const planner = new Planner(this.catalog, this.opts.model, {
      ...this.opts,
      onEvent: (e) => es.push(e),
    });

    const result = (async (): Promise<AgentResult> => {
      try {
        const pres = await planner.run(prompt);
        const outputs = pres.execution?.exits ?? {};
        const res: AgentResult = {
          ok: pres.ok,
          output: pickOutput(pres, outputs),
          outputs,
          usage: pres.usage,
          error: pres.error,
          result: pres,
        };
        // The finish event is wire-safe: TRANSPARENT output only, never the raw
        // exit values or the handle table.
        es.push({
          type: "finish",
          ok: pres.ok,
          output: transparentOutput(pres, outputs),
          usage: pres.usage,
          error: pres.error,
        });
        return res;
      } catch (e) {
        es.push({ type: "error", error: (e as Error).message });
        throw e;
      } finally {
        es.end();
      }
    })();

    const textStream = (async function* () {
      for await (const e of es) if (e.type === "text-delta") yield e.delta;
    })();
    const text = result.then((r) => (typeof r.output === "string" ? r.output : JSON.stringify(r.output ?? "")));
    text.catch(() => {}); // avoid unhandled rejection if result rejects

    return { fullStream: es, textStream, text, result };
  }
}

function collectSkills(skills: AgentOptions["skills"]): Skill[] {
  if (!skills) return [];
  return Array.isArray(skills) ? skills : Object.values(skills);
}

function toPrompt(messages: Messages): string {
  if (typeof messages === "string") return messages;
  return messages.map((m) => m.content).join("\n");
}

/** The user-facing answer is the plan's TRANSPARENT exit(s); fall back to all. */
function pickOutput(result: PlannerResult, outputs: Record<string, unknown>): unknown {
  const plan = result.plan;
  const transparent = plan
    ? plan.exits.filter((e) => plan.handle(e)?.projection === Projection.TRANSPARENT)
    : [];
  const names = transparent.length ? transparent : Object.keys(outputs);
  if (names.length === 0) return undefined;
  if (names.length === 1) return outputs[names[0]];
  return Object.fromEntries(names.map((n) => [n, outputs[n]]));
}

/** Strictly the TRANSPARENT exit(s) - never falls back to OPAQUE values. */
function transparentOutput(result: PlannerResult, outputs: Record<string, unknown>): unknown {
  const plan = result.plan;
  const names = plan
    ? plan.exits.filter((e) => plan.handle(e)?.projection === Projection.TRANSPARENT)
    : [];
  if (names.length === 0) return undefined;
  if (names.length === 1) return outputs[names[0]];
  return Object.fromEntries(names.map((n) => [n, outputs[n]]));
}
