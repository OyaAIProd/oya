/**
 * The oya runner. Note how closely this mirrors `weather-mastra.ts` — same
 * `createTool`, same `Agent({ name, instructions, model, tools }).generate()`. The
 * only differences are the imports (oya instead of @mastra/core + @ai-sdk/anthropic)
 * and that token usage comes from `result.usage` directly. Requires
 * ANTHROPIC_API_KEY.
 */

import { Agent, createTool } from "oya";
import { anthropic } from "oya/anthropic"; // = "oya/anthropic"
import { z } from "zod";

import { MISSION, generatePdf, generateWebpage, getWeather } from "./task.js";
import type { Metrics } from "./metrics.js";

const tools = {
  get_weather: createTool({
    id: "get_weather",
    description: "Look up the current weather for a city",
    inputSchema: z.object({ city: z.string() }),
    outputSchema: z.any(),
    execute: async (input: { city: string }) => getWeather(input),
  }),
  generate_pdf: createTool({
    id: "generate_pdf",
    description: "Render a report object into a PDF file",
    inputSchema: z.object({ report: z.any() }),
    outputSchema: z.any(),
    execute: async (input: { report?: unknown }) => generatePdf(input),
  }),
  generate_webpage: createTool({
    id: "generate_webpage",
    description: "Render a report object into an HTML page",
    inputSchema: z.object({ report: z.any() }),
    outputSchema: z.any(),
    execute: async (input: { report?: unknown }) => generateWebpage(input),
  }),
};

export async function runOya(modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
  const agent = new Agent({
    id: "weather-bot",
    name: "WeatherBot",
    instructions:
      "You are a helpful weather assistant. Use the tools to look up the weather and produce " +
      "a PDF and a web page, then reply with a concise summary. Always use the tools.",
    model: anthropic(modelId),
    tools,
  });

  const start = performance.now();
  const res = await agent.generate(MISSION);
  const latencyMs = performance.now() - start;
  if (!res.ok) throw new Error(`oya run failed: ${res.error}`);

  // Map executed node ids to a readable label (skill name, or node kind).
  const plan = res.result.plan;
  const label = (id: string) => {
    const n = plan?.node(id);
    if (!n) return id;
    const skill = (n as { skill?: string }).skill;
    return skill ? skill.split("@")[0] : n.kind;
  };

  return {
    framework: "oya",
    roundTrips: res.usage.modelCalls,
    inputTokens: res.usage.inputTokens,
    outputTokens: res.usage.outputTokens,
    latencyMs,
    sequence: (res.result.execution?.executed ?? []).map(label),
    output: res.text,
  };
}
