/**
 * The IR tolerates the shapes real planner models emit:
 *   - `null` placeholders in a skill node's `inputs` for optional parameters the
 *     planner left unfilled (kept positionally so the provided handles still line
 *     up with the right parameters);
 *   - `extract` nodes with no catalogue `skill` (the runtime runs them with the
 *     planner model);
 *   - name-keyed `inputs` plus literal `args` on dispatcher skills.
 */

import { describe, expect, it } from "bun:test";

import {
  Catalog,
  ExtractNode,
  Executor,
  Handle,
  Plan,
  Projection,
  SkillNode,
  SummariseNode,
  check,
  normalizeProjections,
} from "../src/index.js";

describe("LLM output tolerance", () => {
  it("null inputs bind positionally and use defaults", async () => {
    const cat = new Catalog("t");
    cat.register({ name: "seed", version: 1, inputSig: { mission: "str" }, outputSig: { x: "str" } })(() => "VALUE");
    cat.register({ name: "act", version: 1, inputSig: { primary: "str", opt: "str" }, outputSig: { out: "str" } })(
      (args) => `${args.primary as string}/${(args.opt as string) ?? "DEFAULT"}`,
    );

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "x", type: "str", projection: Projection.OPAQUE, origin: "n0" }),
        new Handle({ name: "out", type: "str", projection: Projection.TRANSPARENT, origin: "n1" }),
      ],
      nodes: [
        new SkillNode({ id: "n0", skill: "seed@1", inputs: ["mission"], outputs: ["x"] }),
        // The planner filled only the first param; the optional one is null.
        new SkillNode({ id: "n1", skill: "act@1", inputs: ["x", null], outputs: ["out"] }),
      ],
      exits: ["out"],
    });

    const n1 = plan.node("n1")!;
    expect(n1.inputHandles()).toEqual(["x"]); // graph view drops the null
    expect(n1.positionalInputs()).toEqual(["x", null]); // binding view keeps it

    expect(check(plan).ok).toBe(true);

    const run = await new Executor(cat).run(plan);
    expect(run.ok).toBe(true);
    expect(run.exits.out).toBe("VALUE/DEFAULT"); // the unfilled optional used its default
  });

  it("an extract node without a skill is valid", () => {
    const cat = new Catalog("t");
    cat.register({ name: "use", version: 1, inputSig: { q: "str" }, outputSig: { out: "str" } })((args) => args.q);

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "q", type: "str", projection: Projection.TRANSPARENT, origin: "e0" }),
        new Handle({ name: "out", type: "str", projection: Projection.TRANSPARENT, origin: "n1" }),
      ],
      nodes: [
        new ExtractNode({ id: "e0", inputs: ["mission"], outputs: ["q"] }), // no `skill`
        new SkillNode({ id: "n1", skill: "use@1", inputs: ["q"], outputs: ["out"] }),
      ],
      exits: ["out"],
    });

    expect((plan.node("e0") as ExtractNode).skill).toBe("");
    expect(check(plan).ok).toBe(true);
  });

  it("name-keyed inputs and literal args execute", async () => {
    const cat = new Catalog("t");
    cat.register({ name: "seed", version: 1, inputSig: { mission: "str" }, outputSig: { x: "str" } })(() => "PAGE");
    cat.register({
      name: "build",
      version: 1,
      inputSig: { action: "str", content: "str", name: "str" },
      outputSig: { out: "str" },
    })((args) => `${args.action as string}:${args.name as string}:${args.content as string}`);

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "x", type: "str", projection: Projection.OPAQUE, origin: "n0" }),
        new Handle({ name: "out", type: "str", projection: Projection.TRANSPARENT, origin: "n1" }),
      ],
      nodes: [
        new SkillNode({ id: "n0", skill: "seed@1", inputs: ["mission"], outputs: ["x"] }),
        new SkillNode({
          id: "n1",
          skill: "build@1",
          inputs: { content: "x" }, // name-keyed handle binding
          args: { action: "create", name: "report" }, // literal constants
          outputs: ["out"],
        }),
      ],
      exits: ["out"],
    });

    const n1 = plan.node("n1") as SkillNode;
    expect(n1.inputBindings()).toEqual({ content: "x" });
    expect(n1.inputHandles()).toEqual(["x"]); // only the handle, not the literals

    expect(check(plan).ok).toBe(true);

    const run = await new Executor(cat).run(plan);
    expect(run.ok).toBe(true);
    expect(run.exits.out).toBe("create:report:PAGE");
  });

  it("normalizeProjections promotes handles read by model nodes", () => {
    const cat = new Catalog("t");
    cat.register({ name: "fetch", version: 1, inputSig: { mission: "str" }, outputSig: { data: "str" } })(() => "DATA");

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [
        new Handle({ name: "data", type: "str", projection: Projection.OPAQUE, origin: "n0" }),
        new Handle({ name: "answer", type: "str", projection: Projection.TRANSPARENT, origin: "s1" }),
      ],
      nodes: [
        new SkillNode({ id: "n0", skill: "fetch@1", inputs: ["mission"], outputs: ["data"] }),
        new SummariseNode({ id: "s1", inputs: ["data"], outputs: ["answer"] }),
      ],
      exits: ["answer"],
    });

    expect(check(plan).ok).toBe(false); // summarise reads OPAQUE 'data' -> inconsistent
    normalizeProjections(plan);
    expect(plan.handle("data")!.projection).toBe(Projection.TRANSPARENT);
    expect(check(plan).ok).toBe(true);
  });

  it("rejects an unknown arg", () => {
    const cat = new Catalog("t");
    cat.register({ name: "s", version: 1, inputSig: { a: "str" }, outputSig: { o: "str" } })((args) => args.a);

    const plan = new Plan({
      catalogSnapshot: cat.snapshot(),
      handles: [new Handle({ name: "o", type: "str", projection: Projection.TRANSPARENT, origin: "n0" })],
      nodes: [new SkillNode({ id: "n0", skill: "s@1", args: { a: "x", bogus: "y" }, outputs: ["o"] })],
      exits: ["o"],
    });
    const res = check(plan);
    expect(res.ok).toBe(false);
    expect(res.codes()).toContain("unknown_arg");
  });
});
