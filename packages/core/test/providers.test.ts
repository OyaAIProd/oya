/**
 * Provider tests - parsing of `complete` (text + usage) and `stream` (deltas),
 * with a mocked `fetch` (no network). Anthropic is exercised live by the
 * benchmark; these pin OpenAI and Google.
 */

import { afterEach, describe, expect, it } from "bun:test";

import { google } from "../src/google/index.js";
import type { ModelResponse } from "../src/index.js";
import { openai } from "../src/openai/index.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "content-type": "application/json" } });
}

function sseResponse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const l of lines) c.enqueue(enc.encode(l));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

async function collect(stream: AsyncIterable<{ textDelta: string }>): Promise<string> {
  let s = "";
  for await (const c of stream) s += c.textDelta;
  return s;
}

describe("openai provider", () => {
  it("completes with text + usage", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        choices: [{ message: { content: "hi there" } }],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
      })) as unknown as typeof fetch;
    const r = (await openai("gpt-4o", { apiKey: "x" }).complete({ system: "s", user: "u" })) as ModelResponse;
    expect(r.text).toBe("hi there");
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
  });

  it("streams text deltas", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
        "data: [DONE]\n\n",
      ])) as unknown as typeof fetch;
    expect(await collect(openai("gpt-4o", { apiKey: "x" }).stream!({ system: "s", user: "u" }))).toBe("Hello");
  });
});

describe("google provider", () => {
  it("completes with text + usage", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        candidates: [{ content: { parts: [{ text: "hi" }, { text: " there" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
      })) as unknown as typeof fetch;
    const r = (await google("gemini-2.5-pro", { apiKey: "x" }).complete({ system: "s", user: "u" })) as ModelResponse;
    expect(r.text).toBe("hi there");
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it("streams text deltas", async () => {
    globalThis.fetch = (async () =>
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"He"}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"llo"}]}}]}\n\n',
      ])) as unknown as typeof fetch;
    expect(await collect(google("gemini-2.5-pro", { apiKey: "x" }).stream!({ system: "s", user: "u" }))).toBe("Hello");
  });
});
