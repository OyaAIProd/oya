# Configuring the Sandbox

A **sandbox** decides how and where each tool's `execute` runs. The executor takes
one by injection, so isolation is a deployment choice — not baked into the runtime.
oya ships two, and you can implement your own.

```ts
import { Agent } from "oyadotai";
import { WorkerSandbox } from "oyadotai";

const agent = new Agent({
  model: anthropic("claude-haiku-4-5-20251001"),
  tools: { /* … */ },
  sandbox: new WorkerSandbox(5_000), // run each tool in a worker, 5s cap
});
```

If you pass no `sandbox`, the agent uses `InProcessSandbox`.

## `InProcessSandbox` (default)

Runs the tool in the same process and measures its wall-clock cost. This is the
right choice for **trusted, first-party tools** — the ones you wrote. In oya the
security claim is carried by the [projection lattice](/concepts/projection-types)
(the model never sees `OPAQUE` values), not by process isolation, so first-party
tools don't need a heavier sandbox.

```ts
import { InProcessSandbox } from "oyadotai";

const agent = new Agent({ /* … */, sandbox: new InProcessSandbox() });
```

Your `execute` can close over anything in scope — clients, config, secrets — and
call the network freely.

## `WorkerSandbox`

Runs the tool's function in a **worker thread** with a timeout. This is the seam
where resource caps and (in a later phase) egress policy attach — reach for it
with **untrusted or synthesised skills**.

```ts
import { WorkerSandbox } from "oyadotai";

new WorkerSandbox();        // default 30s timeout
new WorkerSandbox(5_000);   // 5s timeout — the tool is terminated if it overruns
```

One constraint: because the function is shipped to the worker **by source**, it
must be **self-contained** — it cannot close over outer variables.

```ts
// ✗ won't work in a WorkerSandbox — closes over `apiKey`
const apiKey = process.env.KEY;
execute: async ({ id }) => fetch(url, { headers: { authorization: apiKey } });

// ✓ self-contained — reads what it needs from inside the function
execute: async ({ id }) => {
  const key = process.env.KEY;
  return fetch(url, { headers: { authorization: key } });
};
```

A tool that overruns its timeout is terminated and surfaces as a typed skill error,
which the planner can [replan](/concepts/plan-ir) around.

## Writing your own

A sandbox is one method — `run(skill, kwargs)` returning the value and its
wall-clock seconds. Implement the `Sandbox` interface to add logging, metrics,
caching, remote execution, or a stricter isolation boundary.

```ts
import type { Sandbox, SandboxOutcome, Skill } from "oyadotai";

class LoggingSandbox implements Sandbox {
  constructor(private readonly inner: Sandbox) {}
  async run(skill: Skill, kwargs: Record<string, unknown>): Promise<SandboxOutcome> {
    const t0 = performance.now();
    try {
      return await this.inner.run(skill, kwargs);
    } finally {
      console.log(`${skill.ref} took ${(performance.now() - t0).toFixed(0)}ms`);
    }
  }
}

const agent = new Agent({ /* … */, sandbox: new LoggingSandbox(new InProcessSandbox()) });
```

## Which one?

| Situation | Sandbox |
|---|---|
| Tools you wrote, in your own app | `InProcessSandbox` (default) |
| Tools that must not exceed a time budget | `WorkerSandbox(ms)` |
| Untrusted / model-synthesised skills | `WorkerSandbox` (caps + isolation seam) |
| Metrics, tracing, remote execution | your own `Sandbox` wrapper |
