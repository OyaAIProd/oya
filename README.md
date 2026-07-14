<div align="center">

# Oya

### Your agent re-feeds every tool result back through the model. **That's the bug.**

Every framework — ReAct, LangGraph, Mastra, the Vercel AI SDK — loops the model on
each step: it reads a tool's output, re-types it as the next tool's arguments, and
pays for the round trip. Oya compiles a **typed plan once** and executes the DAG.
Values flow by reference, never back through the model.

Same code. Same tools. **10× fewer tokens · 3.5× faster · deterministic · injection-safe by construction.**

[![npm](https://img.shields.io/npm/v/oyadotai?color=black&label=oyadotai)](https://www.npmjs.com/package/oyadotai)
&nbsp;·&nbsp; TypeScript · Bun · MIT ·&nbsp; **Drop-in for Mastra**

[Quickstart](#quickstart) · [The numbers](#the-numbers) · [Why](#why) · [Migrate in 2 lines](#migrate-from-mastra-in-2-lines) · [Studio](#studio) · [Docs](#documentation) · [White paper](#white-paper)

**The open-source core behind [oya.ai](https://oya.ai) — the hosted platform for plan-don't-react agents.**

</div>

<!-- Terminal demo (deterministic, no API key). Regenerate with `vhs demo.tape`; see DEMO.md. -->
<p align="center">
  <img src="./demo.gif" width="860" alt="oya executing a plan: get_weather and summarise are TRANSPARENT, while generate_pdf and generate_webpage stay OPAQUE — hidden from the model, which never reads them.">
</p>

<div align="center"><sub>Run it yourself in ~5s, no API key: <code>make install && make demo</code></sub></div>

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

A token loop re-sends every tool result back through the model on the following
step, spending tokens, latency, and determinism to move state it never needed to
read. oya compiles the plan once and wires each value by reference. The
`reconcile` task — get a transaction → fetch its record → normalize → validate →
post — measures the difference on the real Anthropic API (`claude-haiku-4-5`,
identical tools, 8 trials):

| | Vercel AI SDK | Mastra | **oya** |
|---|--:|--:|--:|
| total tokens | 5,754 | 24,387 | **2,536** |
| model round-trips | 6 | 6 | **2** |
| latency | 17.6s | 15.3s | **4.7s** |
| execution order | model-chosen | model-chosen | **one fixed DAG** |
| state fidelity | unguaranteed | unguaranteed | **guaranteed** |

**oya delivers the same result with 2.3× fewer tokens than the leanest loop, nearly
10× fewer than Mastra, in a third of the wall-clock time — and it does so
identically on every run.** The record's bulky payload re-enters a loop's context
at every step; under oya it remains an `OPAQUE` handle the model never sees.

State fidelity is a **guarantee, not an average.** Every value flows by reference
as an `OPAQUE` handle that the model never re-reads or re-emits, so a URL, id, or
amount is delivered to the next tool byte-for-byte and the execution order is the
statically-checked DAG — outcomes a token loop can only approximate, one sampled
run at a time. Reproduce it yourself: `bun run bench`.

### Verify it yourself

Don't take the table on faith — run it. The benchmark hits the **real Anthropic
API** with identical tasks and identical tool implementations for all three
frameworks ([`benchmarks/tasks.ts`](./benchmarks/tasks.ts)); the only thing that
varies is how much state flows through the model.

```bash
# 1. clone and install (needs Bun ≥ 1.1 — https://bun.sh)
git clone https://github.com/OyaAIProd/oya && cd oya
bun install

# 2. build the library — the benchmark imports the built `oyadotai` from dist/
bun run build

# 3. give it your Anthropic key (env var, or drop it in a .env at the repo root)
export ANTHROPIC_API_KEY=sk-ant-...

# 4. run the comparison
bun run bench                                  # default: reconcile, claude-haiku-4-5, 3 trials
bun run bench claude-sonnet-5                  # any model id as the first arg
bun run bench --task research                  # the heavy multi-doc case
```

Args go in any order: a **model id** (defaults to `claude-haiku-4-5-20251001`), a
**trial count** (integer, defaults to `3`), and `--task reconcile` / `--task payments`
/ `--task research` / `--task weather` (defaults to `reconcile`). Prefer
`make bench` — it runs the build for you and auto-loads a `.env` at the repo root,
so steps 2–4 collapse into one command.

The default `reconcile` task threads a critical token through a multi-hop pipeline
whose fetched record is a bulky payload carrying a look-alike distractor. It
measures **token waste** (that payload re-enters a loop's context at every step,
while oya keeps it `OPAQUE`), **state fidelity** (a provenance ledger confirms the
token reaches the final tool byte-for-byte), and **ordering** (a statically-checked
DAG). oya returns `0` corruption and one fixed order on every run, by construction.
`--task research` extends the comparison to a heavy multi-document workload.

Each framework runs the task N times against the same model, and prints tokens,
latency, and correctness side by side. The methodology is in
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

Chat with your agents and watch each plan execute live — the DAG (React Flow, nodes
colored by kind and lit as they run), the trace, and every value at its projection
level (`OPAQUE` shows nothing, `TRANSPARENT` shows the value). Studio opens at
http://localhost:4000.

**In this repo** — two ways, both zero-setup and both the same UI (a sample
[`oya.config.ts`](./oya.config.ts) is included):

```bash
make dev                              # the playground (builds libs, then runs it)
bun run build && bunx oyadotai dev    # the CLI, serving oya.config.ts — same Studio, shipped in the package
```

**In your own project** — add an `oya.config.ts` that exports your agents, then `bunx oyadotai dev`:

```ts
// oya.config.ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";

export default {
  agents: {
    support: new Agent({ model: anthropic("claude-haiku-4-5-20251001"), tools: { /* ...createTool(...) */ } }),
  },
};
```
```bash
bunx oyadotai dev      # → oya Studio at http://localhost:4000
```

## Use it anywhere

oya is a **library, not a platform**. Run an agent in a script, a Next.js route, a
Bun server, a worker, the edge — `await agent.generate(prompt)`. Stream it with
`agent.stream(prompt)` (structured events, not a token soup) and render it with
`oya/react`'s `usePlan` / `useChat`, or serve SSE with `oyadotai-server`.

## Built on this: [oya.ai](https://oya.ai)

This repo is the **open-source core** that [**oya.ai**](https://oya.ai) runs on — the
same plan-once runtime, projection types, and Studio, now hosted. If you want the
managed platform (deploy agents, schedules, skills, and the Studio without running
anything yourself) instead of wiring it up on your own infrastructure, start at
**[oya.ai](https://oya.ai)**. Everything you build against this library is the same
engine that powers it.

## Documentation

Full docs live in [`docs/`](./docs) (served locally with `make docs`):

**Guide**
- [Getting Started](./docs/guide/getting-started.md) — install and write your first agent
- [Creating an Agent](./docs/guide/creating-agents.md) — tools, instructions, and the plan-once model
- [Configuring the Sandbox](./docs/guide/sandbox.md) — where and how each tool's `execute` runs
- [Studio](./docs/guide/studio.md) — chat with your agents and watch the plan execute live

**Concepts**
- [Projection Types](./docs/concepts/projection-types.md) — the `OPAQUE` / `SUMMARY` / `TRANSPARENT` lattice, and why it closes prompt injection at the root
- [The Plan IR](./docs/concepts/plan-ir.md) — the typed dataflow graph the planner emits and the runtime executes

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

Everything runs through the [`Makefile`](./Makefile) — no need to remember package
paths. Run `make help` to list every target.

```bash
make install    # install all workspace dependencies
make demo       # ▶  the paced terminal demo — no API key, ~5s (the GIF above)
make dev        # oya Studio (the playground) at http://localhost:4000
make example    # run the weather example end-to-end (no network)
make bench      # live benchmark vs Vercel AI SDK + Mastra (needs ANTHROPIC_API_KEY)
make test       # bun:test — checked against the Python reference runtime
make check      # typecheck + test, every package (exactly what CI runs)
```

New here? `make install && make demo` shows the whole idea in five seconds.

## Community & contributing

oya is a **community project** built in the open, and the same core that powers
[oya.ai](https://oya.ai). Contributions of every size are welcome — bug reports,
docs, examples, providers, and features.

- **[Contributing guide](./CONTRIBUTING.md)** — setup, the correctness oracle, and the PR workflow
- **[Good first issues](https://github.com/OyaAIProd/oya/labels/good%20first%20issue)** · **[Help wanted](https://github.com/OyaAIProd/oya/labels/help%20wanted)**
- **[Discussions](https://github.com/OyaAIProd/oya/discussions)** — questions, ideas, and show-and-tell
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** · **[Governance](./GOVERNANCE.md)** · **[Security policy](./SECURITY.md)**

Found a security issue? Please report it privately — see [SECURITY.md](./SECURITY.md).
Anything else: **mk@oya.ai**.

## White paper

oya is the TypeScript implementation of *Plan, Don't React: Projection Types for LLM
Agent Runtimes*. Read the white paper:

- [Plan, Don't React — the white paper](https://drive.google.com/file/d/1JLzaIU0DmOOomoumReSGRnMXdtAgySpv/view?usp=sharing)
- [Companion paper](https://drive.google.com/file/d/1uYflhyJhQuZ5nU0rAfePpjYLcSS65uYU/view?usp=sharing)

## License

[MIT](./LICENSE) © Oya Labs, Inc.
