# Creating an Agent

An oya `Agent` has the same shape as Mastra: a model, a set of tools, and some
instructions. What's different is underneath - the agent emits a typed plan once
and executes it, instead of looping the model on every tool call.

```ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

const agent = new Agent({
  name: "WeatherBot",
  instructions: "Answer weather questions, then reply with a short summary.",
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: { get_weather: getWeather },
});

const { text } = await agent.generate("How's the weather in NYC?");
```

## Defining tools

A tool is an `id`, a `description`, a zod `inputSchema`, and an `execute`
function. Types flow from the schema - `execute`'s argument is inferred, no casts.

```ts
const getWeather = createTool({
  id: "get_weather",
  description: "Look up the current weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const r = await fetch(`https://api.weather.example/${city}`);
    return r.json(); // { tempF, condition, humidity, ... }
  },
});
```

The `description` is what the planner reads when it decides whether and how to use
the tool - write it for the model. The **return value is `OPAQUE` by default**: it
flows to the next tool by reference and is never shown to the model. You annotate
nothing to get this.

## Multiple tools that hand off

The planner wires one tool's output into the next tool's input by name - the value
never round-trips through the model. Give the agent the tools and describe the
task; it composes them.

```ts
const agent = new Agent({
  name: "Reporter",
  instructions: "Use the tools to complete the task, then summarise what you did.",
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: {
    get_weather: getWeather,
    generate_pdf: generatePdf,       // takes the weather report, returns a file
    generate_webpage: generateWebpage,
  },
});

await agent.generate("Get the NYC weather, then publish it as a PDF and a web page.");
```

`get_weather`'s result reaches `generate_pdf` byte-for-byte - the model never
re-types it, so a URL, id, or payload can't drift.

## Choosing a model

Providers are thin functions that return a `LanguageModel`. Pick the provider
import that matches your key:

```ts
import { anthropic } from "oyadotai/anthropic";
import { openai }    from "oyadotai/openai";
import { google }    from "oyadotai/google";

anthropic("claude-haiku-4-5-20251001");
openai("gpt-5-2025-08-07");
google("gemini-3-pro");
```

The model here is the **planner** - it emits the plan. It is called once per run
(plus a call per `extract` / `summarise` node), not once per tool. Set the API key
via the provider's standard environment variable (e.g. `ANTHROPIC_API_KEY`).

## `generate` vs `stream`

`generate(prompt)` runs to completion and returns `{ text, ... }`:

```ts
const { text } = await agent.generate("…");
```

`stream(prompt)` returns structured events as the plan executes - ideal for a UI:

```ts
for await (const e of agent.stream("…").fullStream) {
  switch (e.type) {
    case "plan":        console.log("plan:", e.plan.nodes.length, "nodes"); break;
    case "node-start":  console.log("→", e.skill ?? e.kind); break;
    case "node-finish": /* e.handles: each output at its projection level */ break;
    case "text-delta":  process.stdout.write(e.delta); break;
    case "finish":      console.log("\nusage:", e.usage); break;
  }
}
```

Use `.textStream` if you only want the final answer's text deltas. These are the
same events [oya Studio](./studio.md) renders live.

## Inspecting the plan

`generate` and `stream` both expose the full planner result for observability -
the plan that was emitted, the execution trace, and token usage - so you can log
or assert on exactly what ran.

```ts
const res = await agent.stream("…").result;   // resolves when the run completes
console.log(res.plan);                          // the typed Plan IR
console.log(res.usage.modelCalls);              // how many times the model was called
```

## Next

- [Sandbox](./sandbox.md) - control how and where a tool's `execute` runs.
- [Projection Types](../concepts/projection-types.md) - the `OPAQUE` / `SUMMARY` /
  `TRANSPARENT` discipline that keeps tool output away from the model.
