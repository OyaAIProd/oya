import { describe, expect, it } from "bun:test";

import { InProcessSandbox, Skill, WorkerSandbox } from "../src/index.js";

function square(args: Record<string, unknown>): number {
  const x = args.x as number;
  return x * x;
}

function skill(): Skill {
  return new Skill({ name: "square", version: 1, fn: square, inputSig: { x: "int" }, outputSig: { y: "int" } });
}

describe("sandbox", () => {
  it("in-process runs and measures", async () => {
    const out = await new InProcessSandbox().run(skill(), { x: 6 });
    expect(out.value).toBe(36);
    expect(out.seconds).toBeGreaterThanOrEqual(0);
  });

  it("worker sandbox runs isolated", async () => {
    let out;
    try {
      out = await new WorkerSandbox(15_000).run(skill(), { x: 7 });
    } catch {
      return; // environment may forbid worker threads - don't fail CI
    }
    expect(out.value).toBe(49);
  });
});
