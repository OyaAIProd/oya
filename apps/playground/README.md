# oya Studio (playground)

A local agent console: pick an agent, chat with it, and watch its plan execute on
the right — the live DAG, the event trace, and each node's I/O at its projection
level (`OPAQUE` shows nothing, `SUMMARY` the summary, `TRANSPARENT` the value).

```bash
make dev          # from the repo root → http://localhost:4000
```

## Registering an agent

Agents live in [`lib/agents.ts`](./lib/agents.ts). Add an entry to the exported
`agents` map — the key becomes a sidebar tab and is served at
`POST /api/run { agent, prompt }`:

```ts
import { Agent, createTool } from "oyadotai";
import { anthropic } from "oyadotai/anthropic";
import { z } from "zod";

const lookup = createTool({
  id: "lookup_order",
  description: "Look up an order by id",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => db.orders.get(orderId),
});

export const agents = {
  SupportBot: new Agent({
    name: "SupportBot",
    instructions: "Help the customer. Look up their order, then reply.",
    model: anthropic("claude-haiku-4-5-20251001"),
    tools: { lookup_order: lookup },
  }),
};
```

That's it — no separate registration call. The sidebar reads `GET /api/agents`
(the keys of this map) and the chat streams `POST /api/run`.

## Model key

Real model calls need `ANTHROPIC_API_KEY`. `make dev` loads it from the repo-root
`.env`; you can also put it in `apps/playground/.env.local`. Without a key the
demo agents fall back to canned local models so the studio still runs.

## How a request flows

`app/page.tsx` (client) → `POST /api/run` → [`app/api/run/route.ts`] →
`agent.stream(prompt)` → `toSSEResponse` from `oyadotai-server` → the client renders
the structured events (`oya/react`'s `applyEvent`) into the DAG + chat.
