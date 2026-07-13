# Benchmarks — token loop vs. plan-don't-react

Three frameworks (**Vercel AI SDK**, **Mastra**, **oya**), run against the **real
Anthropic API** with identical tool implementations ([`tasks.ts`](./tasks.ts)):

- **`reconcile`** (default) — get a transaction → fetch its **bulky** record
  (carrying a look-alike distractor id) → normalize → validate → post. Ported from
  the paper's `PlanBench` `ops` domain. Stresses **token waste** (the payload
  re-enters a loop's context every step) and **state fidelity + order** (the token
  must reach the final tool byte-for-byte).
- **`payments`** — look up an invoice → charge it → email the receipt; a simpler
  linear state-fidelity pipeline.
- **`research`** (heavy) — search → read 3 large docs → write a report → publish.
- **`weather`** (light) — get weather → PDF + web page.

The Vercel AI SDK and Mastra are both **token loops** (Mastra runs the AI SDK
tool-calling loop under the hood): the model re-emits every tool result as the
next tool's arguments, so **state passes back through the model on every step**.
oya is plan-don't-react: the planner wires values by handle name, so a value
produced by one tool reaches the next **without the model ever re-typing it**.

```bash
ANTHROPIC_API_KEY=sk-... bun run bench                                  # default: reconcile, claude-haiku-4-5, 3 trials
ANTHROPIC_API_KEY=sk-... bun run bench claude-sonnet-5                  # any model id as the first arg
ANTHROPIC_API_KEY=sk-... bun run bench --task research                  # the heavy multi-doc workload
```

Each framework runs `N` trials, reported **mean ± stddev**.

## What's measured

**Accuracy** — the correctness failure modes a ReAct loop introduces (the paper's
claim). oya scores perfectly on all of these *by construction*:

| metric | meaning |
|---|---|
| **state corruption** | runs where a value reached a tool **mangled** — the model re-typed a URL/id/amount wrong. oya never re-types values, so **0 by construction**; the harness prints the exact mangled value as evidence. |
| order violations | a tool ran before a declared dependency |
| incomplete runs | a required step was skipped entirely |
| redundant calls | a tool invoked more than needed |
| distinct orders | how many different execution orders appeared across trials — **determinism** (oya = 1) |

**Cost / latency** (mean ± stddev over the trials):

| metric | meaning |
|---|---|
| model round-trips | sequential LLM calls — the dominant latency term |
| input / output tokens | each framework's own reported Anthropic usage, summed over all calls |
| latency (ms) | wall-clock per run |
| hard errors | the framework threw |

Tokens come from **Anthropic's reported usage** on all sides ([`vercel.ts`](./vercel.ts)
and [`mastra.ts`](./mastra.ts) read `usage` from the framework; [`oya.ts`](./oya.ts)
reads it from `result.usage`), so it's apples-to-apples.

State fidelity is checked with a **provenance ledger** ([`tasks.ts`](./tasks.ts)):
the source tool records the exact value it emitted, each consuming tool records
what it actually received, and the harness compares them structurally after each
run. A mismatch is state the model corrupted — reported with the concrete value.

## Sample output

The `reconcile` task on `claude-haiku-4-5`, 8 trials:

```
  metric            Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  model round-trips 6              6              2
  TOTAL tokens      5754 ± 478     24387 ± 751    2536 ± 108
  latency (ms)      17591 ± 3773   15297 ± 722    4683 ± 494
  failed runs       0/8            0/8            0/8

  accuracy          Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  state corruption  0/8 runs       0/8 runs       0/8 runs
  order violations  0/8            0/8            0/8
  incomplete runs   0/8            0/8            0/8
  distinct orders   1              1              1

  → oya uses 2.3× fewer tokens than Vercel AI SDK, 9.6× fewer than Mastra,
    in 2 round-trips vs 6, and executes one fixed order every run.
  → oya preserves every critical value byte-for-byte and honours every ordering
    constraint — guaranteed by construction: values stay OPAQUE and are never
    re-emitted through the model.
```

**oya returns the same result for a fraction of the cost.** The record's bulky
payload is re-sent through a token loop's context at every step — driving Mastra
to 24k tokens and Vercel to nearly 6k — while under oya it stays an `OPAQUE` handle
the model never reads, so oya completes in 2,536 tokens and two round-trips.

State fidelity and ordering are **guarantees, not sample averages.** oya wires each
value by reference and enforces the execution order as a statically-checked DAG, so
every critical token reaches its destination byte-for-byte and no step runs before
its dependency — on every model, every run.

## Why oya wins

In a token loop, every tool result flows back into the model's context and is
re-emitted as the arguments of the next call. The record fetched in `reconcile`
carries a multi-kilobyte payload; a loop re-sends it at every subsequent step, and
the model re-types each identifier it threads forward. Cost scales with the state
in flight, latency scales with the number of sequential model turns, and the
execution order is whatever the model samples this time.

oya compiles the mission into a typed dataflow plan once, then executes the DAG.
Each value is an `OPAQUE` handle wired by name: the bulky record never re-enters
the model, so it is never re-tokenised, never re-typed, and never re-ordered. The
result is fewer tokens, fewer round-trips, lower latency, one deterministic
execution order, and byte-for-byte state fidelity — enforced statically over the
IR rather than left to the model to reproduce.

## Notes

- **Same model for all three.** Pass a model id as the first argument so every
  framework is measured against the same model; `reconcile` is the default task,
  and `--task research` extends the comparison to a heavy multi-document workload.
- **Tune it to your workload.** The tasks in [`tasks.ts`](./tasks.ts) are small and
  self-contained; point the harness at your own tools and payloads and measure.
