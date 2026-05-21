/**
 * Static-checker tests. The happy-path fixture is the SDR_FOLLOWUP plan from
 * spec/projection-types.md §7. Each failure test mutates one thing and asserts
 * the corresponding check fires.
 */

import { describe, expect, it } from "bun:test";

import {
  BranchNode,
  CatalogSnapshot,
  CostBudget,
  ExtractNode,
  ForEachNode,
  Handle,
  Mission,
  Plan,
  Projection,
  SkillEntry,
  SkillNode,
  SummariseNode,
  check,
} from "../src/index.js";

function catalog(): CatalogSnapshot {
  return new CatalogSnapshot({
    hash: "cat-1",
    skills: [
      new SkillEntry({ name: "extract_lead_id", version: 1, inputSig: { mission: "str" }, outputSig: { lead_id: "LeadId" } }),
      new SkillEntry({ name: "lookup_lead", version: 3, inputSig: { lead_id: "LeadId" }, outputSig: { lead: "CRMRecord" } }),
      new SkillEntry({ name: "check_recency", version: 2, inputSig: { lead: "CRMRecord" }, outputSig: { status: "RecencyStatus" } }),
      new SkillEntry({ name: "draft_email", version: 2, inputSig: { lead: "CRMRecord", mission: "str" }, outputSig: { draft: "EmailDraft" } }),
      new SkillEntry({ name: "show_to_user", version: 1, inputSig: { draft: "EmailDraft" }, outputSig: { ack: "Ack" } }),
      new SkillEntry({ name: "ask_to_confirm", version: 1, inputSig: { status: "RecencyStatus" }, outputSig: { reply: "str" } }),
    ],
  });
}

function sdrFollowup(): Plan {
  return new Plan({
    planId: "SDR_FOLLOWUP",
    mission: new Mission({ content: "Follow up with the lead at https://example.io/leads/abc123" }),
    catalogSnapshot: catalog(),
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

describe("static checker", () => {
  it("accepts a valid plan", () => {
    const res = check(sdrFollowup());
    expect(res.ok).toBe(true);
  });

  it("rejects a branch reading an OPAQUE handle", () => {
    const plan = sdrFollowup();
    plan.handles[2].projection = Projection.OPAQUE; // demote `status`
    expect(check(plan).codes()).toContain("projection_inconsistent");
  });

  it("rejects a summarise fed an OPAQUE handle", () => {
    const plan = sdrFollowup();
    plan.nodes.push(new SummariseNode({ id: "node:7", inputs: ["lead"], outputs: ["summary"] }));
    plan.handles.push(new Handle({ name: "summary", type: "str", projection: Projection.TRANSPARENT, origin: "node:7" }));
    plan.exits.push("summary");
    expect(check(plan).codes()).toContain("projection_inconsistent");
  });

  it("detects a type mismatch", () => {
    const plan = sdrFollowup();
    plan.nodes[2] = new SkillNode({ id: "node:2", skill: "check_recency@2", inputs: ["draft"], outputs: ["status"] });
    expect(check(plan).codes()).toContain("type_mismatch");
  });

  it("detects an unavailable skill", () => {
    const plan = sdrFollowup();
    plan.nodes[1] = new SkillNode({ id: "node:1", skill: "lookup_lead@99", inputs: ["lead_id"], outputs: ["lead"] });
    expect(check(plan).codes()).toContain("skill_unavailable");
  });

  it("detects an unconsumed handle", () => {
    const plan = sdrFollowup();
    plan.nodes.push(new SkillNode({ id: "node:8", skill: "lookup_lead@3", inputs: ["lead_id"], outputs: ["orphan"] }));
    plan.handles.push(new Handle({ name: "orphan", type: "CRMRecord", origin: "node:8" }));
    expect(check(plan).codes()).toContain("handle_unconsumed");
  });

  it("detects a cycle", () => {
    const plan = new Plan({
      catalogSnapshot: new CatalogSnapshot({
        hash: "c",
        skills: [new SkillEntry({ name: "f", version: 1, inputSig: { x: "int" }, outputSig: { y: "int" } })],
      }),
      handles: [
        new Handle({ name: "a", type: "int", origin: "n1" }),
        new Handle({ name: "b", type: "int", origin: "n2" }),
      ],
      nodes: [
        new SkillNode({ id: "n1", skill: "f@1", inputs: ["b"], outputs: ["a"] }),
        new SkillNode({ id: "n2", skill: "f@1", inputs: ["a"], outputs: ["b"] }),
      ],
      exits: ["a", "b"],
    });
    expect(check(plan).codes()).toContain("not_acyclic");
  });

  it("detects an unbounded loop", () => {
    const plan = sdrFollowup();
    plan.nodes.push(new ForEachNode({ id: "node:9", over: "status", body: [], bound: null }));
    expect(check(plan).codes()).toContain("unbounded_loop");
  });

  it("accepts a bounded loop", () => {
    const plan = sdrFollowup();
    plan.nodes.push(new ForEachNode({ id: "node:9", over: "status", body: [], bound: 5 }));
    expect(check(plan).codes()).not.toContain("unbounded_loop");
  });

  it("detects an over-budget plan", () => {
    const plan = sdrFollowup();
    plan.catalogSnapshot.skills[1].costMaxTokens = 10_000;
    plan.budget = new CostBudget({ maxTokens: 100 });
    expect(check(plan).codes()).toContain("over_budget_tokens");
  });
});
