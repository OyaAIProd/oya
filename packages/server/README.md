# oyadotai-server

Fetch-API server helpers for [`oyadotai`](https://www.npmjs.com/package/oyadotai) agents - turn an agent's stream into a `Response` on any Fetch-based runtime (Bun, Next.js route handlers, Cloudflare Workers, the edge).

```bash
bun add oyadotai oyadotai-server
```

```ts
import { toSSEResponse, toTextResponse } from "oyadotai-server";

// In any Fetch handler (Next.js route, Bun.serve, a Worker):
export async function POST(req: Request) {
  const { prompt } = await req.json();
  return toSSEResponse(agent.stream(prompt)); // structured plan events over SSE
  // or: return toTextResponse(agent.stream(prompt)); // plain text stream
}
```

`toSSEResponse` emits the structured plan events (`usePlan` / `useChat` in `oyadotai/react` consume them); `toTextResponse` emits the final answer as a text stream.

See the [main README](https://github.com/OyaAIProd/oya#readme) for the full picture.

## License

[MIT](https://github.com/OyaAIProd/oya/blob/main/LICENSE) © Oya Labs, Inc.
