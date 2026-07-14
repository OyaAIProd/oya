/**
 * Mastra drop-in compatibility: the same code shape a Mastra user writes
 * (`createTool` + `new Agent({ name, instructions, model, tools }).generate()`)
 * runs on oya by changing only the imports.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { Agent, createTool, type LanguageModel } from "../src/index.js";

const SECRET = "leak-me-not-mastra";

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
    { id: "n0", kind: "skill", skill: "get_weather@1", inputs: ["mission"], outputs: ["rec"] },
    { id: "n1", kind: "summarise", inputs: ["mission"], outputs: ["answer"] },
  ],
  exits: ["answer", "rec"],
};

describe("Mastra compatibility", () => {
  // Exactly the shape a Mastra user wrote - only the imports changed.
  const getWeather = createTool({
    id: "get_weather",
    description: "Look up the current weather for a city",
    inputSchema: z.object({ city: z.string() }),
    execute: async (input) => ({ city: input.city, secret: SECRET, tempF: 72 }),
  });

  it("createTool builds a usable skill", () => {
    expect(getWeather.name).toBe("get_weather");
    expect(getWeather.inputSig).toEqual({ city: "str" });
  });

  it("Agent.generate returns { text }", async () => {
    const model = fakeModel((system) =>
      system.includes("executing a single")
        ? JSON.stringify({ answer: "It's 72°F and sunny in NYC." })
        : JSON.stringify(PLAN),
    );
    const agent = new Agent({
      name: "WeatherBot",
      instructions: "You are a helpful weather assistant. Always use the tools.",
      model,
      tools: { get_weather: getWeather },
    });

    const { text } = await agent.generate("How's the weather in NYC?");
    expect(text).toBe("It's 72°F and sunny in NYC.");

    // the agent instructions reached the planner...
    expect(model.prompts.some((p) => p.system.includes("weather assistant"))).toBe(true);
    // ...but the OPAQUE tool output never reached the model.
    for (const { system, user } of model.prompts) {
      expect(system).not.toContain(SECRET);
      expect(user).not.toContain(SECRET);
    }
  });
});
