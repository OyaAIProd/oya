/**
 * The OpenAI provider — `oya/openai`.
 *
 *     import { openai } from "oya/openai";
 *     const agent = new Agent({ model: openai("gpt-4o"), tools });
 *
 * No SDK dependency: talks to the Chat Completions API over `fetch`. Reads
 * `OPENAI_API_KEY` from the environment unless an `apiKey` is passed.
 */

import { sseJSON } from "../_sse.js";
import type { LanguageModel, ModelResponse, ModelStreamChunk } from "../model.js";

export interface OpenAIOptions {
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function openai(modelId: string, opts: OpenAIOptions = {}): LanguageModel {
  const url = `${opts.baseURL ?? "https://api.openai.com/v1"}/chat/completions`;
  const key = () => {
    const k = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (!k) throw new Error("oya: missing OpenAI API key — set OPENAI_API_KEY or pass openai(model, { apiKey }).");
    return k;
  };
  const body = (system: string, user: string, stream: boolean) =>
    JSON.stringify({
      model: modelId,
      max_tokens: opts.maxTokens ?? 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    });

  return {
    provider: "openai",
    modelId,
    async complete({ system, user }): Promise<ModelResponse> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
        body: body(system, user, false),
      });
      if (!res.ok) throw new Error(`oya: openai request failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as ChatResponse;
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    },
    async *stream({ system, user }): AsyncIterable<ModelStreamChunk> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
        body: body(system, user, true),
      });
      if (!res.ok || !res.body) throw new Error(`oya: openai stream failed (${res.status}): ${await res.text()}`);
      for await (const evt of sseJSON(res.body) as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
        const delta = evt.choices?.[0]?.delta?.content;
        if (delta) yield { textDelta: delta };
      }
    },
  };
}
