# Benchmarks — token loop vs. plan-don't-react

Two tasks, three frameworks (**Vercel AI SDK**, **Mastra**, **oya**), all run
against the **real Anthropic API**, identical tool implementations
([`tasks.ts`](./tasks.ts)):

- **`weather`** (light) — get weather → PDF + web page.
- **`research`** (heavy) — search → read 3 large docs → write a report → publish.

The Vercel AI SDK and Mastra are both **token loops** (Mastra runs the AI SDK
tool-calling loop under the hood); oya is plan-don't-react. The only thing that
varies is *how much state flows through the model*.

```bash
ANTHROPIC_API_KEY=sk-... bun run bench --task weather claude-opus-4-7   # the clean headline
ANTHROPIC_API_KEY=sk-... bun run bench                                  # default: research, haiku, 3 trials
```

Each framework runs `N` trials (token loops are stochastic), reported **mean ± stddev**.

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

One 3-trial run on `claude-opus-4-7` (the default model is Haiku — pass
`claude-opus-4-7` to reproduce; your numbers will vary):

```
  cost / latency    Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  model round-trips 4 ± 1          4 ± 1          2
  input tokens      3292 ± 910     7765 ± 4229    1359
  output tokens     361 ± 91       1378 ± 575     424 ± 4
  TOTAL tokens      3653 ± 825     9143 ± 4797    1783 ± 4
  latency (ms)      20013 ± 5672   20173 ± 5123   6320 ± 441

  reliability (/3)  Vercel AI SDK  Mastra         oya
  ---------------------------------------------------------------
  redundant calls   2              2              0
  order violations  0/3            0/3            0/3
  incomplete runs   0/3            0/3            0/3
  distinct sequences2/3            2/3            1/3
  hard errors       0/3            0/3            0/3

  → oya uses 51% fewer tokens than the leaner token loop (2.05×), 2 round-trips vs 4.
```

oya is `1783 ± 4` tokens with one execution order every trial; the token loops
swing widely (Mastra `± 4797`) and each made redundant calls. That **determinism**
— fixed token cost, fixed order — is as much the result as the raw count. The gap
**narrows on smaller/cheaper models** (on Haiku it's ~17% vs the leaner loop, with
round-trips tied) and **widens** with bigger intermediate payloads and more steps.
Run it on your own workload and report what you measure.

## Why the loop costs more

In the token loop, every tool result flows back into the context and is **re-sent
on every subsequent step**. To call `generate_pdf` with the weather it just
fetched, the model must **re-emit that data as the tool's arguments** — the
re-tokenisation that corrupts URLs and IDs. The HTML page lands in the context on
the final step. In oya, the planner wires the handles by name; the PDF and HTML
**never reach the model**.

## Honest caveats

- **The clean win is a well-structured task on a capable model.** On `weather` +
  Opus, oya is ~2× under the leanest loop, 5× under Mastra, and deterministic.
- **vs Mastra the gap is consistent (~4–5×) on every task** — its agent
  scaffolding is heavy (the `research` task pushed it past 29k tokens).
- **vs the leanest loop, open-ended tasks narrow the gap.** On `research`, oya
  came out ~1.3× under the Vercel SDK rather than 2×+: the planner's plan quality
  varies on ambiguous missions (weaker models add `extract`/`summarise` nodes;
  stronger ones sometimes do *less* work), so the OPAQUE-payload advantage isn't
  fully realized. The architectural win is real but plan-quality-dependent — we
  report it honestly rather than cherry-pick. Tune [`tasks.ts`](./tasks.ts) to
  your workload and measure.
- **Run it several times.** Wall-clock latency is noisy, and the token loop's
  step count and tool order are model-chosen and can vary between runs. oya's
  sequence is a fixed, statically-checked DAG — that determinism is itself a
  result worth reporting.
- **Same model for all three.** Pass a model id as the first argument so every
  framework is measured against the same model.
