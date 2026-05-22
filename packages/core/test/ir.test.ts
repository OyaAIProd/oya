import { describe, expect, it } from "bun:test";

import {
  BranchNode,
  MISSION_HANDLE,
  Plan,
  Projection,
  SkillRef,
  nodeFromJSON,
} from "../src/index.js";

describe("Plan IR", () => {
  it("round-trips a skill ref", () => {
    const sr = SkillRef.parse("lookup_lead@3");
    expect(sr.name).toBe("lookup_lead");
    expect(sr.version).toBe(3);
    expect(sr.toString()).toBe("lookup_lead@3");
  });

  it("requires a version on skill refs", () => {
    expect(() => SkillRef.parse("lookup_lead")).toThrow();
    expect(() => SkillRef.parse("lookup_lead@latest")).toThrow();
  });

  it("mission handle is implicit and TRANSPARENT", () => {
    const plan = new Plan();
    const h = plan.handle(MISSION_HANDLE);
    expect(h).not.toBeNull();
    expect(h!.projection).toBe(Projection.TRANSPARENT);
  });

  it("handles default to OPAQUE", () => {
    const plan = Plan.fromJSON({
      handles: [{ name: "lead", type: "CRMRecord" }],
      nodes: [],
    });
    expect(plan.handle("lead")!.projection).toBe(Projection.OPAQUE);
  });

  it("accepts the `else` alias on a branch", () => {
    const node = nodeFromJSON({
      id: "n3",
      kind: "branch",
      predicate: "x",
      inputs: ["x"],
      then: ["n4"],
      else: ["n5"],
    }) as BranchNode;
    expect(node.then).toEqual(["n4"]);
    expect(node.otherwise).toEqual(["n5"]);
    expect(new Set(node.controlTargets())).toEqual(new Set(["n4", "n5"]));
  });

  it("parses from the JSON shape", () => {
    const plan = Plan.fromJSON({
      plan_id: "p1",
      mission: { kind: "user_request", content: "follow up" },
      catalog_snapshot: { hash: "h", skills: [] },
      handles: [{ name: "lead", type: "CRMRecord", projection: "OPAQUE", origin: "node:1" }],
      nodes: [
        {
          id: "node:1",
          kind: "skill",
          skill: "lookup_lead@3",
          inputs: ["lead_id"],
          outputs: ["lead"],
        },
      ],
      exits: ["lead"],
    });
    expect(plan.nodes[0].kind).toBe("skill");
    expect(plan.nodes[0].outputHandles()).toEqual(["lead"]);
  });

  it("serialises projection to its name and round-trips", () => {
    const plan = Plan.fromJSON({
      handles: [{ name: "s", type: "X", projection: "SUMMARY" }],
      nodes: [],
    });
    const dumped = plan.toJSON() as { handles: { projection: string }[] };
    expect(dumped.handles[0].projection).toBe("SUMMARY");
    const again = Plan.fromJSON(dumped as unknown as Record<string, unknown>);
    expect(again.handle("s")!.projection).toBe(Projection.SUMMARY);
  });
});
