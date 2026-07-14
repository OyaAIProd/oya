/**
 * End-to-end executor tests. The centrepiece is the projection invariant: we
 * plant a sentinel string inside every OPAQUE value the SDR plan produces and
 * assert it never appears in the planner-facing view, while the plan still runs
 * to a correct result.
 */

import { describe, expect, it } from "bun:test";

import {
  BranchNode,
  Catalog,
  ExtractNode,
  Executor,
  Handle,
  Mission,
  Plan,
  Projection,
  SkillNode,
  check,
  type LLMRunner,
} from "../src/index.js";

const SENTINEL = "secret-email-do-not-leak@acme.test";
const LEAD_ID = "LEAD-d41d8cd9-9f00";

class RuntimeError extends Error {}

interface Lead {
  email: string;
  name: string;
  last_contact_days: number;
}

function makeCatalog(days: number): Catalog {
  const cat = new Catalog("sdr");

  // extract_lead_id is an extract node at run time, but it is backed by a real
  // catalogue skill so it runs deterministically (no model).
  cat.register({ name: "extract_lead_id", version: 1, inputSig: { mission: "str" }, outputSig: { lead_id: "LeadId" } })(
    () => LEAD_ID,
  );

  cat.register({ name: "lookup_lead", version: 3, inputSig: { lead_id: "LeadId" }, outputSig: { lead: "CRMRecord" }, pure: true })(
    () => ({ email: SENTINEL, name: "Ada", last_contact_days: days }),
  );

  cat.register({
    name: "check_recency",
    version: 2,
    inputSig: { lead: "CRMRecord" },
    outputSig: { status: "RecencyStatus" },
    projectors: { RecencyStatus: (v) => ({ kind: (v as { kind: string }).kind, days_since: (v as { days_since: number }).days_since }) },
  })((args) => {
    const d = (args.lead as Lead).last_contact_days;
    return { kind: d <= 30 ? "fresh" : "stale", days_since: d };
  });

  cat.register({ name: "draft_email", version: 2, inputSig: { lead: "CRMRecord", mission: "str" }, outputSig: { draft: "EmailDraft" } })(
    (args) => {
      const lead = args.lead as Lead;
      return { to: lead.email, body: `Hi ${lead.name} - re: ${args.mission as string}` };
    },
  );

  cat.register({ name: "show_to_user", version: 1, inputSig: { draft: "EmailDraft" }, outputSig: { ack: "Ack" } })(
    () => ({ shown: true }),
  );

  cat.register({ name: "ask_to_confirm", version: 1, inputSig: { status: "RecencyStatus" }, outputSig: { reply: "str" } })(
    () => "This lead looks stale - confirm before I send?",
  );

  return cat;
}

function buildPlan(cat: Catalog): Plan {
  return new Plan({
    planId: "SDR_FOLLOWUP",
    mission: new Mission({ content: "Follow up with the lead at https://example.io/leads/abc123" }),
    catalogSnapshot: cat.snapshot(),
    handles: [
      new Handle({ name: "lead_id", type: "LeadId", projection: Projection.OPAQUE, origin: "node:0" }),
      new Handle({ name: "lead", type: "CRMRecord", projection: Projection.OPAQUE, origin: "node:1" }),
      new Handle({ name: "status", type: "RecencyStatus", projection: Projection.SUMMARY, origin: "node:2" }),
      new Handle({ name: "draft", type: "EmailDraft", projection: Projection.OPAQUE, origin: "node:4" }),
      new Handle({ name: "ack", type: "Ack", projection: Projection.TRANSPARENT, origin: "node:5" }),
      new Handle({ name: "reply", type: "str", projection: Projection.TRANSPARENT, origin: "node:6" }),
    ],
    nodes: [
      new ExtractNode({ id: "node:0", skill: "extract_lead_id@1", inputs: ["mission"], outputs: ["lead_id"] }),
      new SkillNode({ id: "node:1", skill: "lookup_lead@3", inputs: ["lead_id"], outputs: ["lead"] }),
      new SkillNode({ id: "node:2", skill: "check_recency@2", inputs: ["lead"], outputs: ["status"] }),
      new BranchNode({ id: "node:3", predicate: "status.kind == 'fresh'", inputs: ["status"], then: ["node:4", "node:5"], otherwise: ["node:6"] }),
      new SkillNode({ id: "node:4", skill: "draft_email@2", inputs: ["lead", "mission"], outputs: ["draft"] }),
      new SkillNode({ id: "node:5", skill: "show_to_user@1", inputs: ["draft"], outputs: ["ack"] }),
      new SkillNode({ id: "node:6", skill: "ask_to_confirm@1", inputs: ["status"], outputs: ["reply"] }),
    ],
    exits: ["ack", "reply"],
  });
}

const runner: LLMRunner = (node) => {
  if (node.id === "node:0") return { lead_id: LEAD_ID };
  throw new Error(`unexpected llm node ${node.id}`);
};

describe("executor", () => {
  it("the plan is statically valid", () => {
    expect(check(buildPlan(makeCatalog(3))).ok).toBe(true);
  });

  it("fresh path runs and preserves state opaquely", async () => {
    const plan = buildPlan(makeCatalog(3));
    const res = await new Executor(makeCatalog(3), { llmRunner: runner }).run(plan);

    expect(res.ok).toBe(true);
    expect("ack" in res.exits).toBe(true);
    expect("reply" in res.exits).toBe(false);

    // The draft skill *did* receive the real email (state preserved server-side).
    expect((res.table.draft as { to: string }).to).toBe(SENTINEL);

    // THE INVARIANT: nothing OPAQUE leaks into the planner's view.
    const view = res.view(plan);
    const blob = JSON.stringify(view);
    expect(blob).not.toContain(SENTINEL);
    expect(blob).not.toContain(LEAD_ID);
    expect(blob).not.toContain("Ada");
    expect("value" in view.lead || "summary" in view.lead).toBe(false);
    expect("value" in view.draft).toBe(false);
  });

  it("SUMMARY handle is visible for branching", async () => {
    const plan = buildPlan(makeCatalog(3));
    const res = await new Executor(makeCatalog(3), { llmRunner: runner }).run(plan);
    const view = res.view(plan);
    const summary = view.status.summary as { kind: string; days_since: number };
    expect(summary.kind).toBe("fresh");
    expect(summary.days_since).toBe(3);
  });

  it("TRANSPARENT handles are visible", async () => {
    const plan = buildPlan(makeCatalog(3));
    const res = await new Executor(makeCatalog(3), { llmRunner: runner }).run(plan);
    const view = res.view(plan);
    expect("value" in view.mission).toBe(true);
    expect("value" in view.ack).toBe(true);
  });

  it("stale path takes the other branch", async () => {
    const plan = buildPlan(makeCatalog(90));
    const res = await new Executor(makeCatalog(90), { llmRunner: runner }).run(plan);
    expect(res.ok).toBe(true);
    expect("reply" in res.exits).toBe(true);
    expect("ack" in res.exits).toBe(false);
  });

  it("caches a pure skill", async () => {
    const cat = new Catalog("c");
    const calls = { n: 0 };
    cat.register({ name: "double", version: 1, inputSig: { x: "int" }, outputSig: { y: "int" }, pure: true })((args) => {
      calls.n += 1;
      return (args.x as number) * 2;
    });

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "x", type: "int", projection: Projection.OPAQUE, origin: "seed" }),
        new Handle({ name: "y1", type: "int", projection: Projection.OPAQUE, origin: "a" }),
        new Handle({ name: "y2", type: "int", projection: Projection.OPAQUE, origin: "b" }),
      ],
      nodes: [
        new SkillNode({ id: "a", skill: "double@1", inputs: ["x"], outputs: ["y1"] }),
        new SkillNode({ id: "b", skill: "double@1", inputs: ["x"], outputs: ["y2"] }),
      ],
      exits: ["y1", "y2"],
    });
    const res = await new Executor(cat).run(plan, { x: 21 });
    expect(res.exits).toEqual({ y1: 42, y2: 42 });
    expect(calls.n).toBe(1); // second call served from cache
    expect(res.cacheHits).toBe(1);
  });

  it("a skill error is typed and does not leak", async () => {
    const cat = new Catalog("c");
    cat.register({ name: "boom", version: 1, inputSig: { x: "str" }, outputSig: { y: "str" } })(() => {
      // Build a partial OPAQUE value, then fail - it must never reach the planner.
      throw new RuntimeError(SENTINEL);
    });

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "x", type: "str", projection: Projection.OPAQUE, origin: "seed" }),
        new Handle({ name: "y", type: "str", projection: Projection.OPAQUE, origin: "a" }),
      ],
      nodes: [new SkillNode({ id: "a", skill: "boom@1", inputs: ["x"], outputs: ["y"] })],
      exits: ["y"],
    });
    const res = await new Executor(cat).run(plan, { x: "in" });
    expect(res.ok).toBe(false);
    expect(res.error).not.toBeNull();
    expect(res.error!.errorClass).toBe("RuntimeError");
    // P3: the projected error carries no value.
    expect(JSON.stringify(res.error!.projected())).not.toContain(SENTINEL);
    expect(JSON.stringify(res.view(plan))).not.toContain(SENTINEL);
  });
});
