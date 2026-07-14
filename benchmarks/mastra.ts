/** The Mastra runner - a token loop on the AI SDK. Loosely typed (Mastra generics). */

import { anthropic } from "@ai-sdk/anthropic";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import type { Metrics } from "./metrics.js";
import type { Task } from "./tasks.js";

export async function runMastra(task: Task, modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
  const tools: Record<string, unknown> = {};
  for (const t of task.tools) {
    tools[t.id] = createTool({
      id: t.id,
      description: t.description,
      inputSchema: t.inputSchema as never,
      outputSchema: z.any(),
      execute: async (input: unknown) => t.execute(input),
    });
  }
  const agent = new Agent({
    id: "bench",
    name: "Bench",
    instructions: "Use the tools to complete the task, then reply with a short summary. Always use the tools.",
    model: anthropic(modelId),
    tools: tools as never,
  });
  const start = performance.now();
  const result: any = await (agent.generate as any)(task.mission, { maxSteps: 16 });
  const latencyMs = performance.now() - start;
  const u = (result.usage ?? {}) as { inputTokens?: number; outputTokens?: number; promptTokens?: number; completionTokens?: number };
  const steps: any[] = result.steps ?? [];
  const sequence = steps.flatMap((s) => (s.toolCalls ?? []).map((c: any) => c.payload?.toolName ?? c.toolName ?? "tool"));
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
