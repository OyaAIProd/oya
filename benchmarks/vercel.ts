/** The Vercel AI SDK runner — a real token loop. */

import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";

import type { Metrics } from "./metrics.js";
import type { Task } from "./tasks.js";

export async function runVercel(task: Task, modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
  const tools = Object.fromEntries(
    task.tools.map((t) => [
      t.id,
      tool({ description: t.description, inputSchema: t.inputSchema as never, execute: async (a: unknown) => t.execute(a) }),
    ]),
  );
  const start = performance.now();
  const result = await generateText({ model: anthropic(modelId), stopWhen: stepCountIs(16), prompt: task.mission, tools });
  const latencyMs = performance.now() - start;
  const u = result.usage as { inputTokens?: number; outputTokens?: number };
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
