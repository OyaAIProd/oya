# Studio

oya Studio lets you chat with your agents and **watch each plan execute live** -
the DAG, the trace, and every value at its projection level (`OPAQUE` shows
nothing, `SUMMARY` a bounded projection, `TRANSPARENT` the full value). It opens at
`http://localhost:4000`.

## In your own project

Add an `oya.config.ts` that exports your agents, then run the CLI:

```ts
// oya.config.ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";

export default {
  agents: {
    support: new Agent({ model: anthropic("claude-haiku-4-5-20251001"), tools: { /* ... */ } }),
  },
};
```

```bash
ANTHROPIC_API_KEY=sk-... bunx oyadotai dev
```

The CLI Studio ships inside the `oyadotai` package - no extra dependency, no build
step. It serves every agent your config exports.

## What you see

- **Graph** - the plan as a DAG. Nodes are colored by kind (skill, extract,
  summarise, branch, …) and light up as they run; edges animate as state flows.
- **Trace** - the raw event stream (`plan`, `node-start`, `node-finish`,
  `text-delta`, `finish`).
- **I/O** - click any node to inspect its inputs and outputs, each tagged with its
  projection level. An `OPAQUE` output shows *"hidden - the model never saw this."*

Studio consumes the same structured events as `agent.stream(prompt)`, so what you
see in the UI is exactly what your app receives programmatically - see
[Creating an Agent](./creating-agents.md#generate-vs-stream).
