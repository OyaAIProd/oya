/**
 * The baseline, with the genuine Vercel AI SDK — a real token loop.
 *
 * `generateText` with three tools and multi-step: the model picks a tool, sees
 * the raw result, picks the next, until it answers. Every tool result flows back
 * into the context on the next step. Requires ANTHROPIC_API_KEY.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { MISSION, generatePdf, generateWebpage, getWeather } from "./task.js";
import type { Metrics } from "./metrics.js";

export async function runVercel(modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
  const start = performance.now();
  const result = await generateText({
    model: anthropic(modelId),
    stopWhen: stepCountIs(8),
    prompt: MISSION,
    tools: {
      get_weather: tool({
        description: "Look up the current weather for a city",
        inputSchema: z.object({ city: z.string() }),
        execute: async ({ city }) => getWeather({ city }),
      }),
      generate_pdf: tool({
        description: "Render a report object into a PDF file",
        inputSchema: z.object({ report: z.any() }),
        execute: async ({ report }) => generatePdf({ report }),
      }),
      generate_webpage: tool({
        description: "Render a report object into an HTML page",
        inputSchema: z.object({ report: z.any() }),
        execute: async ({ report }) => generateWebpage({ report }),
      }),
    },
  });
  const latencyMs = performance.now() - start;

  const u = result.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  const sequence = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
  return {
    framework: "Vercel AI SDK",
    roundTrips: result.steps.length,
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    latencyMs,
    sequence: [...sequence, "final"],
    output: result.text,
  };
}
