/**
 * The high-level surface: `skill()` type inference and an end-to-end `Agent`
 * run driven by a fake model. The agent hides the IR entirely; this also checks
 * that an OPAQUE value a skill produces never reaches the model.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { Agent, skill, type LanguageModel } from "../src/index.js";

describe("skill()", () => {
  it("infers IR signatures from a zod schema", () => {
    const s = skill({
      name: "fetch",
      description: "Fetch a URL",
      input: z.object({ url: z.string(), retries: z.number().optional() }),
      output: z.string(),
      run: ({ url }) => `body of ${url}`,
    });
    expect(s.name).toBe("fetch");
    expect(s.version).toBe(1);
    expect(s.inputSig).toEqual({ url: "str", retries: "Optional[float]" });
    expect(Object.keys(s.outputSig).length).toBe(1);
  });

  it("derives a name from the description when omitted", () => {
    const s = skill({ description: "Draft an email", input: z.object({}), run: () => "ok" });
    expect(s.name).toBe("draft_an_email");
  });

  it("parses input and runs", async () => {
    const s = skill({ name: "echo", input: z.object({ x: z.string() }), run: ({ x }) => x.toUpperCase() });
    expect(await s.fn({ x: "hi" })).toBe("HI");
  });
});

const SECRET = "leak-me-not-9q";

function fakeModel(
  responder: (system: string, user: string) => string,
): LanguageModel & { prompts: { system: string; user: string }[] } {
  const prompts: { system: string; user: string }[] = [];
  return {
    provider: "fake",
    modelId: "fake",
    prompts,
    async complete({ system, user }) {
      prompts.push({ system, user });
      return responder(system, user);
    },
  };
}

const PLAN = {
  plan_id: "p",
  handles: [
    { name: "rec", type: "Any", projection: "OPAQUE", origin: "n0" },
    { name: "answer", type: "str", projection: "TRANSPARENT", origin: "n1" },
  ],
  nodes: [
    { id: "n0", kind: "skill", skill: "lookup@1", inputs: ["mission"], outputs: ["rec"] },
    { id: "n1", kind: "summarise", inputs: ["mission"], outputs: ["answer"] },
  ],
  exits: ["answer", "rec"],
};

describe("Agent", () => {
  const lookup = skill({
    name: "lookup",
    input: z.object({ q: z.string() }),
    run: () => ({ secret: SECRET, name: "Ada" }),
  });

  it("runs end-to-end and returns the user-facing output", async () => {
    const model = fakeModel((system) =>
      system.includes("executing a single")
        ? JSON.stringify({ answer: "Here is your summary." })
        : JSON.stringify(PLAN),
    );
    const agent = new Agent({ model, skills: [lookup] });
    const res = await agent.run("look up the lead");

    expect(res.ok).toBe(true);
    expect(res.output).toBe("Here is your summary.");
    // the OPAQUE record was produced server-side and is available as an exit...
    expect((res.outputs.rec as { secret: string }).secret).toBe(SECRET);
    // ...but the model never saw it, on any prompt.
    expect(model.prompts.length).toBeGreaterThan(0);
    for (const { system, user } of model.prompts) {
      expect(system).not.toContain(SECRET);
      expect(user).not.toContain(SECRET);
    }
  });

  it("reports token usage when the model provides it", async () => {
    const model: LanguageModel = {
      provider: "fake",
      modelId: "fake",
      async complete({ system }) {
        const text = system.includes("executing a single")
          ? JSON.stringify({ answer: "ok" })
          : JSON.stringify(PLAN);
        return { text, usage: { inputTokens: 100, outputTokens: 20 } };
      },
    };
    const res = await new Agent({ model, skills: [lookup] }).run("look up the lead");
    expect(res.usage.modelCalls).toBe(2); // plan + summarise
    expect(res.usage.inputTokens).toBe(200);
    expect(res.usage.outputTokens).toBe(40);
  });
});
