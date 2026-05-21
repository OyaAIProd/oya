# Getting Started

## Install

```bash
bun add oya zod
```

## Your first agent

The API mirrors Mastra (`createTool` + `Agent.generate`):

```ts
import { Agent, createTool } from "oya";
import { anthropic } from "oya/anthropic";
import { z } from "zod";

const getWeather = createTool({
  id: "get_weather",
  description: "Look up the current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => fetchWeather(city),
});

const agent = new Agent({
  name: "WeatherBot",
  instructions: "You are a helpful weather assistant.",
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: { get_weather: getWeather },
});

const { text } = await agent.generate("How's the weather in NYC?");
console.log(text);
```

Types are inferred from the zod schema. Every value defaults to `OPAQUE`, so tool
outputs never reach the model — you write zero projection annotations. Migrating
from Mastra is just changing the imports (see the README).

There's also an oya-native form — `skill({ name, input, run })` and
`agent.run(prompt)` returning the projected outputs — if you prefer it.

> The rest of this page covers the **low-level runtime** underneath `Agent` —
> reach for it only to inspect or hand-build a plan.

## The shape of a run

1. A **planner** model emits a typed dataflow **Plan IR** — a DAG of named,
   typed **handles** produced and consumed by **nodes**.
2. The runtime runs **8 static checks** over the plan (acyclic, well-typed,
   projection-consistent, bounded, in-budget, …). A bad plan is rejected before
   anything executes.
3. The **executor** runs the DAG in topological order. State flows between skills
   through a full-fidelity handle table. The model is re-engaged only at
   `extract` / `summarise` nodes — never to pass a value from one skill to the
   next.
4. The planner only ever sees the **projected view** of the handle table: each
   handle at its declared level (`OPAQUE` / `SUMMARY` / `TRANSPARENT`).

## Build and run a plan directly

You can construct and execute a plan against a `Catalog` of skills with no model
in the loop — useful for tests and for understanding the runtime:

```ts
import { Catalog, Executor, Plan, Handle, Projection, SkillNode } from "oya";

const cat = new Catalog();
cat.register({
  name: "double", version: 1,
  inputSig: { x: "int" }, outputSig: { y: "int" },
  pure: true,
})(({ x }) => (x as number) * 2);

const plan = new Plan({
  catalogSnapshot: cat.snapshot(),
  handles: [
    new Handle({ name: "x", type: "int", projection: Projection.OPAQUE, origin: "seed" }),
    new Handle({ name: "y", type: "int", projection: Projection.OPAQUE, origin: "a" }),
  ],
  nodes: [new SkillNode({ id: "a", skill: "double@1", inputs: ["x"], outputs: ["y"] })],
  exits: ["y"],
});

const res = await new Executor(cat).run(plan, { x: 21 });
console.log(res.exits); // { y: 42 }
```

## Let a model emit the plan

Provide an `LLMClient` (the provider packages land soon; for now any object with a
`complete({ system, user })` method works) and the `Planner` handles emit →
check → execute, with automatic re-emit on a bad plan and replan on a runtime
failure:

```ts
import { Planner } from "oya";

const planner = new Planner(catalog, llmClient);
const result = await planner.run("Follow up with the lead at https://example.io/leads/abc123");

if (result.ok) {
  console.log(result.execution!.exits);
  // The URL never entered the planner's context.
}
```

See the [runnable example](https://github.com/oya-labs/oya/tree/main/examples) for
the full SDR follow-up plan, and [Projection Types](/concepts/projection-types)
for the discipline that makes it safe.
