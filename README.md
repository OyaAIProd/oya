<div align="center">

# oya

### Agents that **plan, don't react.**

The model writes a typed plan **once**. The runtime runs it. Tool outputs never go
back through the model — so your agent **can't be prompt-injected through its tools,
costs a fraction, and runs the same every time.**

**Drop-in for Mastra.** TypeScript · Bun · MIT

[Quickstart](#quickstart) · [The numbers](#the-numbers) · [Why](#why) · [Migrate from Mastra](#migrate-from-mastra-in-2-lines) · [Studio](#studio)

</div>

<!-- LAUNCH: drop the studio GIF here before publishing — capture it with DEMO.md -->
<p align="center"><img src="./studio.gif" width="820" alt="oya Studio — a plan executing live: the DAG, the trace, and each value at its projection level"></p>

---

## Quickstart

```ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

const getWeather = createTool({
  id: "get_weather",
  description: "Look up the weather for a city",
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => fetchWeather(city),
});

const agent = new Agent({
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: { get_weather: getWeather },
});

const { text } = await agent.generate("How's the weather in NYC?");
```

That's the whole API — the **same shape as Mastra**. Types are inferred from your
zod schema, and every value is `OPAQUE` to the model by default. You did less work
and it's injection-safe.

## The numbers

Same task, same tools, real Anthropic API, 3 trials on `claude-opus-4-7`:

| | Vercel AI SDK | Mastra | **oya** |
|---|--:|--:|--:|
| total tokens | 3,653 | 9,143 | **1,783** |
| model round-trips | 4 | 4 | **2** |
| latency | 20.0s | 20.2s | **6.3s** |
| same plan every run? | no | no | **yes** |

**½ the tokens of the leanest loop, 5× fewer than Mastra, ~3× faster — and
deterministic.** (The gap narrows on smaller/cheaper models and widens with bigger
payloads — full methodology and numbers in [`benchmarks/`](./benchmarks).)

### Verify it yourself

Don't take the table on faith — run it. The benchmark hits the **real Anthropic
API** with identical tasks and identical tool implementations for all three
frameworks ([`benchmarks/tasks.ts`](./benchmarks/tasks.ts)); the only thing that
varies is how much state flows through the model.

```bash
# 1. clone and install (needs Bun ≥ 1.1 — https://bun.sh)
git clone https://github.com/OyaAIProd/oya && cd oya
bun install

# 2. give it your Anthropic key (env var, or drop it in a .env at the repo root)
export ANTHROPIC_API_KEY=sk-ant-...

# 3. run the comparison
bun run bench                                  # default: research task, Haiku, 3 trials
bun run bench --task weather claude-opus-4-7   # the headline run from the table above
```

Args go in any order: a **model id** (defaults to Haiku), a **trial count**
(integer, defaults to `3`), and `--task weather` or `--task research` (defaults to
`research`). `make bench` does the same and auto-loads `.env`.

Each framework runs the task N times against the same model and prints
**mean ± stddev** — the stddev is the point: oya's token cost and tool order barely
move, while the token loops swing (Mastra's total swung ±4797 in our run). Token
loops are stochastic, so **run it a few times**; your absolute numbers will differ
by model and payload. Full methodology, caveats, and where the gap narrows are in
[`benchmarks/README.md`](./benchmarks/README.md).

## Why

Every other agent framework is a **token loop** (ReAct, LangGraph, AutoGen, Mastra,
the Vercel AI SDK): the model picks a tool, sees the **raw** result, picks the next.
Every URL, ID, and document flows back through the model. Three bugs follow — every
time:

```
fetched:    https://example.io/q3-report.pdf
downloaded: https://example.com/q3-report.pdf     ← the model "fixed" the URL
```
```
expected:  fetch → validate → download
observed:  fetch → download → validate (skipped)  ← the model reordered the steps
```
```
$432 in tokens   ← re-reading every result through the model
 $51 in tokens   ← reading only what it needs to decide
```

Same root cause: **the model read state it never needed to.** oya makes that
impossible. The model emits a typed dataflow plan; the runtime executes the DAG;
each value is shown to the model only at the level the plan declares:

| level | the model sees | for |
|---|---|---|
| `OPAQUE` *(default)* | type + provenance — **never the bytes** | URLs, IDs, docs, payloads, secrets |
| `SUMMARY` | a bounded projection (`{count}`) | facts to branch on |
| `TRANSPARENT` | the full value | the user's message, the final answer |

An attacker can stuff a payload into any fetched page. The model **never reads that
handle**, so indirect prompt injection through tool output has nowhere to land. You
annotate none of this — it's `OPAQUE` by default.

## Migrate from Mastra in 2 lines

`createTool` and `Agent` mirror `@mastra/core`. Change the imports; the code stays:

```diff
- import { Agent } from "@mastra/core/agent";
- import { createTool } from "@mastra/core/tools";
- import { anthropic } from "@ai-sdk/anthropic";
+ import { Agent, createTool } from "oyadotai";
+ import { anthropic } from "oyadotai/anthropic";
```

Same `createTool({ id, inputSchema, execute })` and
`new Agent({ name, instructions, model, tools }).generate(prompt)` (returns
`{ text }`). The difference is underneath: oya emits a checked plan and executes it
instead of looping — so a migrated app gets the numbers above for free.

## Studio

Chat with your agents and watch each plan execute live — the DAG, the trace, and
every value at its projection level (`OPAQUE` shows nothing, `TRANSPARENT` shows
the value). In your project:

```ts
// oya.config.ts
export default { agents: { support } };
```
```bash
bunx oyadotai dev      # → oya Studio at localhost:4000
```

## Use it anywhere

oya is a **library, not a platform**. Run an agent in a script, a Next.js route, a
Bun server, a worker, the edge — `await agent.generate(prompt)`. Stream it with
`agent.stream(prompt)` (structured events, not a token soup) and render it with
`oya/react`'s `usePlan` / `useChat`, or serve SSE with `oyadotai-server`. Managed
hosting (Oya Cloud) is coming.

## Install

```bash
bun add oyadotai zod
```

## Packages

| package | what |
|---|---|
| `oyadotai` | the runtime + `Agent` + `createTool`; `oyadotai/anthropic` · `oyadotai/openai` · `oyadotai/google` providers; `oyadotai/react` hooks; the `oya dev` studio |
| `oyadotai-server` | `toSSEResponse` / `toTextResponse` for any Fetch server |
| `@oya/playground` | the Next.js studio (`make dev`) |
| `@oya/benchmarks` | the live comparison above |

## Develop

```bash
make dev        # oya Studio
make test       # bun:test — checked against the Python reference runtime
make bench      # the comparison
make check      # typecheck + test, every package
```

oya is the TypeScript implementation of *Plan, Don't React: Projection Types for LLM
Agent Runtimes*.

## License

[MIT](./LICENSE) © Oya Labs, Inc.
