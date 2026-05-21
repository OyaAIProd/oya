/**
 * The Mastra runner — genuine `@mastra/core` Agent. Mastra's agent loop runs the
 * AI SDK tool-calling loop under the hood, so it's a token loop: each step
 * re-sends the conversation. Requires ANTHROPIC_API_KEY.
 *
 * Mastra's `generate` is heavily generic; the call/result are read loosely (the
 * code is genuine, the types are relaxed) so it compiles across versions.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
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

export async function runMastra(modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
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
  // Loosely typed: Mastra's generate overloads are highly generic.
  const result: any = await (agent.generate as any)(MISSION, { maxSteps: 8 });
  const latencyMs = performance.now() - start;

  const u = (result.usage ?? {}) as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number };
  const steps: any[] = result.steps ?? [];
  const sequence = steps.flatMap((s) =>
    (s.toolCalls ?? []).map((c: any) => c.toolName ?? c.payload?.toolName ?? "tool"),
  );
  return {
    framework: "Mastra",
    roundTrips: steps.length || 0,
    inputTokens: u.inputTokens ?? u.promptTokens ?? 0,
    outputTokens: u.outputTokens ?? u.completionTokens ?? 0,
    latencyMs,
    sequence: [...sequence, "final"],
    output: result.text,
  };
}
