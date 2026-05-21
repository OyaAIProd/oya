/**
 * Streaming: structured events (plan, node lifecycle, text deltas, finish) and
 * the Mastra-shaped `textStream` / `text`. Also checks that an OPAQUE handle
 * discloses nothing in any streamed event.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { Agent, createTool, type LanguageModel, type OyaEvent } from "../src/index.js";

const SECRET = "stream-secret-xyz";
const DELTAS = ["It's ", "72°F ", "and sunny ", "in NYC."];

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

function streamingModel(): LanguageModel {
  return {
    provider: "fake",
    modelId: "fake",
    async complete() {
      return JSON.stringify(PLAN);
    },
    async *stream() {
      for (const d of DELTAS) yield { textDelta: d };
    },
  };
}

const lookup = createTool({
  id: "lookup",
  inputSchema: z.object({ q: z.string() }),
  execute: async () => ({ secret: SECRET, tempF: 72 }),
});

describe("streaming", () => {
  it("emits structured events and streams the answer text", async () => {
    const agent = new Agent({ name: "wb", model: streamingModel(), tools: { lookup } });
    const events: OyaEvent[] = [];
    for await (const e of agent.stream("How's the weather?").fullStream) events.push(e);

    const types = events.map((e) => e.type);
    expect(types).toContain("plan");
    expect(types).toContain("node-start");
    expect(types).toContain("node-finish");
    expect(types).toContain("text-delta");
    expect(types[types.length - 1]).toBe("finish");

    const text = events
      .filter((e): e is Extract<OyaEvent, { type: "text-delta" }> => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe(DELTAS.join(""));

    // The OPAQUE record never discloses its value in any streamed event.
    expect(JSON.stringify(events)).not.toContain(SECRET);

    const finish = events.find((e) => e.type === "finish") as Extract<OyaEvent, { type: "finish" }>;
    expect(finish.ok).toBe(true);
    expect(finish.output).toBe(DELTAS.join(""));
  });

  it("exposes Mastra-shaped textStream / text / result", async () => {
    const agent = new Agent({ name: "wb", model: streamingModel(), tools: { lookup } });
    const s = agent.stream("How's the weather?");
    const chunks: string[] = [];
    for await (const c of s.textStream) chunks.push(c);
    expect(chunks.join("")).toBe(DELTAS.join(""));
    expect(await s.text).toBe(DELTAS.join(""));
    expect((await s.result).ok).toBe(true);
  });
});
