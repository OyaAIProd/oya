# Benchmarks — token loop vs. plan-don't-react

Same task, three frameworks: the **Vercel AI SDK**, **Mastra**, and **oya**, all
run against the **real Anthropic API**. The task is *"How's the weather in NYC?
Then generate a PDF and a web page."* with three operations: `get_weather`,
`generate_pdf`, `generate_webpage`.

The Vercel AI SDK and Mastra are both **token loops** — Mastra's `Agent` runs the
AI SDK tool-calling loop under the hood — so they share the same architectural
cost. oya is plan-don't-react. The three operations have **identical
implementations** across all three ([`task.ts`](./task.ts)); the only thing that
varies is *how much state flows through the model*.

```bash
ANTHROPIC_API_KEY=sk-... bun run bench                       # default: claude-haiku-4-5-20251001, 3 trials
ANTHROPIC_API_KEY=sk-... bun run bench claude-sonnet-4-6 5   # model + trial count
```

Each framework is run `N` trials (token loops are stochastic), reported as
**mean ± stddev**.

## What's measured

**Cost / latency** (mean ± stddev over the trials):

| metric | meaning |
|---|---|
| model round-trips | sequential LLM calls — the dominant latency term |
| input / output tokens | each framework's own reported Anthropic usage, summed over all calls |
| latency (ms) | wall-clock per run |

**Reliability** (the token-loop failure modes the paper names):

| metric | meaning |
|---|---|
| redundant calls | tool invocations beyond the minimum (e.g. calling `generate_webpage` twice) |
| order violations | a tool called before its dependency (`generate_*` before `get_weather`) |
| incomplete runs | a required step was skipped entirely |
| distinct sequences | how many different execution orders appeared across trials — **determinism** |
| hard errors | the framework threw |

Tokens come from **Anthropic's reported usage** on all sides ([`weather-vercel.ts`](./weather-vercel.ts),
[`weather-mastra.ts`](./weather-mastra.ts) read `usage` from the framework;
[`weather-oya.ts`](./weather-oya.ts) reads it from `result.usage`), so it's
apples-to-apples.

## Sample output

One 3-trial run on `claude-haiku-4-5-20251001` (your numbers will vary — that's the point):

```
  cost / latency    Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  model round-trips 3              3              3 ± 1
  input tokens      1888 ± 211     3807 ± 289     1140 ± 42
  output tokens     242 ± 21       767 ± 93       632 ± 40
  TOTAL tokens      2130 ± 201     4574 ± 285     1772 ± 81
  latency (ms)      6495 ± 2055    5193 ± 576     6307 ± 2130

  reliability (/3)  Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  redundant calls   0              0              0
  order violations  0/3            0/3            0/3
  incomplete runs   0/3            0/3            0/3
  distinct sequences1/3            1/3            2/3
  hard errors       0/3            0/3            0/3

  → oya uses 17% fewer tokens than the leaner token loop (1.20×).
```

This is a deliberately small task on a small model, so the gap is modest — oya
still uses ~2.6× fewer tokens than Mastra. The advantage grows with intermediate
payload size, step count, and model verbosity (on Opus we measured ~2× vs the
leaner loop, and far fewer round-trips). One honest note: oya showed 2/3 distinct
sequences here — its **execution is deterministic given a plan**, but the plan
itself is model-generated and can vary between runs (Haiku sometimes added an
`extract` step). Run it on your own workload and report what you measure.

## Why the loop costs more

In the token loop, every tool result flows back into the context and is **re-sent
on every subsequent step**. To call `generate_pdf` with the weather it just
fetched, the model must **re-emit that data as the tool's arguments** — the
re-tokenisation that corrupts URLs and IDs. The HTML page lands in the context on
the final step. In oya, the planner wires the handles by name; the PDF and HTML
**never reach the model**.

## Honest caveats

- **The advantage scales with the task.** Savings grow with (a) intermediate
  payload size and (b) step count — the loop re-sends everything each step
  (≈ quadratic in state), oya is linear and never sends artifacts. A task with
  tiny payloads and one step shows little difference; a document-heavy task shows
  a lot. Tune [`task.ts`](./task.ts) to your paper's workload and report what you
  measure.
- **Run it several times.** Wall-clock latency is noisy, and the token loop's
  step count and tool order are model-chosen and can vary between runs. oya's
  sequence is a fixed, statically-checked DAG — that determinism is itself a
  result worth reporting.
- **Same model for all three.** Pass a model id as the first argument so every
  framework is measured against the same model.
