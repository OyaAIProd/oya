/**
 * Planner tests with a fake model (no network). Covers: emit -> check ->
 * execute; static re-emit on a bad plan; replan on a runtime failure; replan-
 * budget exhaustion; and the P4 guarantee that the replan prompt the planner
 * builds contains no OPAQUE value.
 */

import { describe, expect, it } from "bun:test";

import { Catalog, Planner, type LLMClient } from "../src/index.js";

const SENTINEL = "do-not-leak-7f3a";

class FakeLLM implements LLMClient {
  prompts: { system: string; user: string }[] = [];
  constructor(private readonly responder: (system: string, user: string) => string) {}
  complete({ system, user }: { system: string; user: string }): string {
    this.prompts.push({ system, user });
    return this.responder(system, user);
  }
}

function catFetch(): Catalog {
  const cat = new Catalog("t");
  cat.register({ name: "parse", version: 1, inputSig: { mission: "str" }, outputSig: { key: "str" } })(() => "K1");
  cat.register({ name: "fetch", version: 1, inputSig: { key: "str" }, outputSig: { doc: "Doc" }, pure: true })((args) => ({
    id: args.key,
    body: "hello " + SENTINEL,
  }));
  return cat;
}

function catReplan(): Catalog {
  const cat = new Catalog("t");
  cat.register({ name: "seed", version: 1, inputSig: {}, outputSig: { secret: "str" } })(() => SENTINEL);
  cat.register({ name: "boom", version: 1, inputSig: { secret: "str" }, outputSig: { out: "str" } })(() => {
    throw new Error("kaboom");
  });
  cat.register({ name: "safe", version: 1, inputSig: { secret: "str" }, outputSig: { out: "str" } })(() => "OK");
  return cat;
}

const FETCH_PLAN = {
  plan_id: "P",
  handles: [
    { name: "key", type: "str", projection: "OPAQUE", origin: "n0" },
    { name: "doc", type: "Doc", projection: "OPAQUE", origin: "n1" },
  ],
  nodes: [
    { id: "n0", kind: "extract", skill: "parse@1", inputs: ["mission"], outputs: ["key"] },
    { id: "n1", kind: "skill", skill: "fetch@1", inputs: ["key"], outputs: ["doc"] },
  ],
  exits: ["doc"],
};

// Statically invalid via an unknown skill ref — a failure the planner cannot
// auto-repair (unlike under-declared projections, which normalizeProjections fixes).
const BAD_PLAN = {
  plan_id: "bad",
  handles: [{ name: "key", type: "str", projection: "OPAQUE", origin: "n0" }],
  nodes: [{ id: "n0", kind: "skill", skill: "nonexistent@1", inputs: ["mission"], outputs: ["key"] }],
  exits: ["key"],
};

function planWith(skillRef: string): Record<string, unknown> {
  return {
    plan_id: skillRef,
    handles: [
      { name: "secret", type: "str", projection: "OPAQUE", origin: "s" },
      { name: "out", type: "str", projection: "OPAQUE", origin: "o" },
    ],
    nodes: [
      { id: "s", kind: "skill", skill: "seed@1", inputs: [], outputs: ["secret"] },
      { id: "o", kind: "skill", skill: skillRef, inputs: ["secret"], outputs: ["out"] },
    ],
    exits: ["out"],
  };
}

describe("planner", () => {
  it("happy path emits and executes", async () => {
    const llm = new FakeLLM((system) =>
      system.includes("executing a single") ? JSON.stringify({ key: "K1" }) : JSON.stringify(FETCH_PLAN),
    );
    const res = await new Planner(catFetch(), llm).run("fetch document K1");
    expect(res.ok).toBe(true);
    expect(res.emitRetries).toBe(0);
    expect(res.replans).toBe(0);
    expect((res.execution!.exits.doc as { id: string }).id).toBe("K1");
  });

  it("re-emits on a statically bad plan", async () => {
    const state = { n: 0 };
    const llm = new FakeLLM((system) => {
      if (system.includes("executing a single")) return JSON.stringify({ key: "K1" });
      state.n += 1;
      return JSON.stringify(state.n === 1 ? BAD_PLAN : FETCH_PLAN);
    });
    const res = await new Planner(catFetch(), llm).run("fetch K1");
    expect(res.ok).toBe(true);
    expect(res.emitRetries).toBe(1); // first emit failed the skill-availability check
  });

  it("replans on a runtime failure", async () => {
    const llm = new FakeLLM((_system, user) =>
      JSON.stringify(user.includes("A node failed") ? planWith("safe@1") : planWith("boom@1")),
    );
    const res = await new Planner(catReplan(), llm, { maxReplans: 3 }).run("do the thing");
    expect(res.ok).toBe(true);
    expect(res.replans).toBe(1);
    expect(res.execution!.exits.out).toBe("OK");
  });

  it("replan prompt never contains an OPAQUE value", async () => {
    const llm = new FakeLLM((_system, user) =>
      JSON.stringify(user.includes("A node failed") ? planWith("safe@1") : planWith("boom@1")),
    );
    const res = await new Planner(catReplan(), llm).run("do the thing");
    expect(res.ok).toBe(true);
    // P4: the OPAQUE `secret` produced before the failure must not appear in any
    // prompt the planner sent — not even on the replan turn.
    for (const { system, user } of llm.prompts) {
      expect(system).not.toContain(SENTINEL);
      expect(user).not.toContain(SENTINEL);
    }
  });

  it("exhausts the replan budget", async () => {
    const llm = new FakeLLM(() => JSON.stringify(planWith("boom@1")));
    const res = await new Planner(catReplan(), llm, { maxReplans: 2 }).run("do the thing");
    expect(res.ok).toBe(false);
    expect(res.replans).toBe(2);
    expect(res.error ?? "").toContain("budget");
  });
});
