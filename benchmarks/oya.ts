/** The oya runner — plan-don't-react, real Anthropic usage from result.usage. */

import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

import type { Metrics } from "./metrics.js";
import type { Task } from "./tasks.js";

export async function runOya(task: Task, modelId = "claude-haiku-4-5-20251001"): Promise<Metrics> {
  const tools: Record<string, ReturnType<typeof createTool>> = {};
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
    name: "Bench",
    instructions: "Use the tools to complete the task, then reply with a short summary.",
    model: anthropic(modelId),
    tools,
    // Heavy multi-source tasks occasionally yield a plan that fails static checks
    // (a mis-named handle); give the planner more repair attempts against the
    // checker feedback before it gives up, so a stray bad emit doesn't fail the run.
    maxEmitRetries: 4,
    maxReplans: 4,
  });
  const start = performance.now();
  const res = await agent.generate(task.mission);
  const latencyMs = performance.now() - start;
  if (!res.ok) throw new Error("oya run failed: " + res.error);
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
