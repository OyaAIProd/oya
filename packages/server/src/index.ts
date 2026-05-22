/**
 * `@oya/server` — turn an agent's event stream into a Fetch `Response` you can
 * return from any server: a Next.js route handler, Bun.serve, or the edge.
 *
 *     import { toSSEResponse } from "@oya/server";
 *
 *     export const POST = async (req: Request) => {
 *       const { prompt } = await req.json();
 *       return toSSEResponse(agent.stream(prompt).fullStream);
 *     };
 *
 * The visual playground (sidebar / chat / live DAG) lives in `apps/playground`.
 */

import type { OyaEvent } from "oya";

/** Server-Sent-Events `Response` carrying every structured event as JSON. */
export function toSSEResponse(stream: AsyncIterable<OyaEvent>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(e) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** A plain `text/plain` streaming `Response` of just the answer deltas. */
export function toTextResponse(textStream: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const delta of textStream) controller.enqueue(encoder.encode(delta));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
