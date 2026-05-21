<div align="center">

# oya

**Agents that plan, instead of react.** The model writes a typed plan once; the runtime runs it; the model never reads state it shouldn't.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) · TypeScript · **early**

</div>

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
```

That's the whole API — and it's the **same shape as Mastra**, so migrating is just
changing imports (see below). No graphs, no handles, no projection annotations:
types are inferred from your zod schema, and tool outputs are **never** sent back
to the model. You did less work and it's injection-safe.

## Migrating from Mastra

`createTool` and `Agent` mirror `@mastra/core`. Change the imports; the code stays:

```diff
- import { Agent } from "@mastra/core/agent";
- import { createTool } from "@mastra/core/tools";
- import { anthropic } from "@ai-sdk/anthropic";
+ import { Agent, createTool } from "oya";
+ import { anthropic } from "oya/anthropic";
```

Your `createTool({ id, description, inputSchema, execute })` and
`new Agent({ name, instructions, model, tools }).generate(prompt)` keep working —
`generate()` returns `{ text }` as before. The difference is underneath: oya emits
a checked plan and executes it instead of running a token loop, so tool outputs
stay off the model's context.

## Why not just a token loop?

Every other agent SDK is a **token loop**: the model picks a tool, sees the raw
result, picks the next. Every URL, ID, and document flows back through the model.
Three bugs follow from that one choice:

```
fetched:    https://example.io/q3-report.pdf
downloaded: https://example.com/q3-report.pdf   ← the model "fixed" the URL
```
```
expected:  fetch → validate → download
observed:  fetch → download → validate (skipped)   ← the model reordered steps
```
```
$432 in tokens   ← re-reading every result through the model
 $51 in tokens   ← reading only what it needs to decide
```

Same root cause: **the model read state it didn't need.** `oya` makes that
unrepresentable. The model emits a plan, the runtime executes the DAG, and each
value is disclosed to the model only at the level the plan declares — `OPAQUE` by
default. An attacker can stuff a payload into any fetched page; the model never
reads that handle, so the injection has nowhere to land.

## How it works (you don't have to care)

1. Your prompt + skills → the model emits a typed **Plan IR** (a dataflow DAG).
2. **8 static checks** run before anything executes (acyclic, well-typed,
   projection-consistent, bounded, in-budget…). A bad plan is rejected and re-emitted.
3. The runtime executes the DAG. State flows skill→skill server-side; the model is
   re-engaged only to read text it must (a summary, an extraction, a recovery).
4. The model only ever sees the **projected** view of each value:

   | level | model sees | for |
   |---|---|---|
   | `OPAQUE` *(default)* | type + provenance only | URLs, IDs, docs, payloads, secrets |
   | `SUMMARY` | a bounded projection (e.g. `{count}`) | facts to branch on |
   | `TRANSPARENT` | the full value | the user's message, final answers |

You annotate none of this. Reach for the IR (`Plan`, `Catalog`, `Executor`, the
checker) only when you want to inspect or hand-build a plan — see [docs](./docs).

## Does it actually save tokens?

The [`benchmarks/`](./benchmarks) measure it for real — same task (*"How's the
weather in NYC? Then generate a PDF and a web page."*), **identical** tool
implementations, all run against the real Anthropic API over N trials. One
3-trial run on `claude-haiku-4-5-20251001`:

```
  metric            Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  TOTAL tokens      2130 ± 201     4574 ± 285     1772 ± 81
  model round-trips 3              3              3 ± 1
  latency (ms)      6495 ± 2055    5193 ± 576     6307 ± 2130
```
oya: **~17% fewer tokens** than the leaner loop, **~2.6× fewer than Mastra**.

```bash
ANTHROPIC_API_KEY=sk-... bun run bench    # your numbers vary by model & task
```

Both the Vercel AI SDK and Mastra are **token loops** (Mastra runs the AI SDK loop
under the hood): they re-send every tool result on every step, and the model must
re-emit data as tool arguments — the corruption risk. In oya the generated PDF and
HTML **never reach the model**. The gap **scales with model and task** — modest
here (small task, small model); on Opus, or with larger intermediate payloads, we
measured ~2× vs the leaner loop. Full numbers + reliability metrics in
[`benchmarks/`](./benchmarks).

## Install

```bash
bun add oya zod
```

`oya` is a TypeScript port of the [`oya-planner`](https://github.com/oya-labs)
reference runtime and the *Plan, Don't React: Projection Types for LLM Agent
Runtimes* specs.

## Streaming

`agent.stream(prompt)` mirrors Mastra's `stream()` — but oya streams **structured
events**, not a token soup: the emitted plan, each node starting/finishing with the
handles it sealed (at their projection level), the answer's text deltas, then
finish. Every event is **wire-safe** — an `OPAQUE` value never appears, even
mid-stream.

```ts
const { fullStream, textStream } = agent.stream("How's the weather in NYC?");

for await (const e of fullStream) {
  if (e.type === "node-finish") console.log(e.nodeId, e.handles); // OPAQUE shows nothing
  if (e.type === "text-delta") process.stdout.write(e.delta);     // the answer, token by token
}

// or just the answer (Mastra/AI-SDK shape):
for await (const chunk of textStream) process.stdout.write(chunk);
```

Serve it over SSE from any Fetch-API server (Next.js route, Bun.serve, edge):

```ts
import { toSSEResponse } from "oya/server";

export const POST = async (req: Request) => {
  const { prompt } = await req.json();
  return toSSEResponse(agent.stream(prompt).fullStream);
};
```

## Deployment

oya is a **library, not a platform**. `bun add oya`, write your agent, and run it
anywhere JavaScript runs — a script, a Next.js route, a Bun server, the edge. No
account, no deploy step, nothing to host.

Managed hosting — deploy your agents to **Oya Cloud** with the trace viewer, run
logs, and scaling built in — is on the way (Phase 2).

## Packages

`oya` ships as one package with subpath entry points:

| import | what |
|---|---|
| `oya` | core — `Agent`, `createTool` / `skill`, the Plan IR, static checker, executor, streaming |
| `oya/anthropic` · `oya/openai` · `oya/google` | model providers (`complete` + token streaming) |
| `oya/server` | `toSSEResponse` for any Fetch server, and `createDevServer` (a live trace viewer) |
| `oya/react` | `usePlan` / `useChat` hooks — render the DAG and watch handles seal (React peer dep) |

## Development

Built and tested with [Bun](https://bun.sh).

```bash
bun install
bun test            # bun:test — checked against the Python reference suite
bun run typecheck
bun run build
bun run example     # run an agent end-to-end, no network
bun run bench       # token/round-trip comparison vs the Vercel AI SDK + Mastra
```

## License

[MIT](./LICENSE) © Oya Labs, Inc.
