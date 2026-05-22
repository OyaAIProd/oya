# Launch kit

Copy-paste material for launching oya. Numbers are from a 3-trial `claude-opus-4-7`
run (see `benchmarks/`); keep the "drop-in for Mastra" and "plan, don't react"
phrasing — they're the hooks.

---

## Tweet (single)

> Every AI-agent framework is a token loop: the model re-reads every tool result,
> "fixes" your URLs, reorders your steps, and bills you for all of it.
>
> oya doesn't. The model writes a typed plan **once** — tool outputs never go back
> through it.
>
> 5× fewer tokens than Mastra. Drop-in. 👇
> github.com/oya-labs/oya

---

## Thread

**1/**
> Your agent rewrites URLs, skips steps, and re-reads entire documents on every
> turn. That's not a bug in your prompt — it's the architecture.
>
> Every framework (ReAct, LangGraph, Mastra, the Vercel AI SDK) is a *token loop*.
> oya isn't. 🧵

**2/**
> A token loop feeds every tool result back into the model to pick the next step.
> So:
> • it "normalises" URLs and UUIDs (state corruption)
> • it reorders/skips dependent steps (ordering drift)
> • it re-bills every byte at token prices (cost)
>
> Same root cause: the model reads state it never needed.

**3/**
> oya is **plan, don't react**. The model emits ONE typed dataflow plan; a runtime
> executes the DAG. Each value is shown to the model only at the level the plan
> declares — `OPAQUE` by default (type + provenance, never the bytes).

**4/**
> Because tool outputs are OPAQUE, an attacker who injects a payload into a fetched
> page accomplishes nothing — the model never reads that handle. A whole class of
> indirect prompt injection becomes *inexpressible*.

**5/**
> Same task, same tools, real API, 3 trials (claude-opus-4-7):
>
> total tokens — Vercel 3,653 · Mastra 9,143 · **oya 1,783**
> round-trips — 4 · 4 · **2**     latency — 20s · 20s · **6.3s**
>
> ½ the tokens, 5× fewer than Mastra, ~3× faster — and deterministic.

**6/**
> It's a **drop-in for Mastra** — change two imports:
>
> `@mastra/core` → `oya`
>
> Same createTool / Agent / generate(). It just plans instead of looping.

**7/**
> Try it on your own agents:
>
> bun add oya
> bunx oya dev   # live studio: chat + the DAG executing, with per-node I/O
>
> MIT, TypeScript. github.com/oya-labs/oya ⭐

---

## Show HN

**Title:**
> Show HN: oya – plan-don't-react agents (5× fewer tokens, injection-proof tools)

**First comment:**
> Every agent framework I've used is a token loop: the model picks a tool, sees the
> raw result, picks the next — so every URL, ID, and document flows back through the
> model on each turn. That causes three things I kept hitting: the model rewrites
> low-frequency strings (URLs/UUIDs), it reorders or skips dependent steps, and it
> re-bills every intermediate byte.
>
> oya takes the database-optimizer approach instead: the model emits a typed
> dataflow plan once, a runtime runs the DAG, and each value carries a *projection
> level* deciding what the model may see — OPAQUE by default, so tool outputs never
> re-enter the context. A nice side effect: indirect prompt injection through tool
> output has nowhere to land (the model never reads those handles).
>
> It's a drop-in for Mastra (same createTool/Agent/generate), Bun-built, MIT. In a
> 3-trial benchmark on Opus it used ~½ the tokens of the leanest token loop, 5×
> fewer than Mastra, and ran ~3× faster with a fixed execution order. The gap
> narrows on cheaper models and widens with bigger payloads — methodology and the
> harness (vs the real Vercel AI SDK and Mastra) are in the repo so you can check.
>
> `bunx oya dev` opens a local studio that shows the plan executing live with
> per-node I/O at each projection level. Would love feedback on the projection-type
> model.

---

## One-liner descriptions

- GitHub "About": *Plan-don't-react agents for TypeScript. The model plans once; the runtime runs it; tool outputs never go back through the model. Drop-in for Mastra.*
- npm: *A plan-don't-react framework for LLM agents — fewer tokens, deterministic, injection-safe by construction.*
