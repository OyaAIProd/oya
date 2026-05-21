/**
 * The Anthropic provider — `oya/anthropic`.
 *
 *     import { anthropic } from "oya/anthropic";
 *     const agent = new Agent({ model: anthropic("claude-haiku-4-5-20251001"), skills });
 *
 * No SDK dependency: it talks to the Messages API over `fetch` (Node 18+). Reads
 * `ANTHROPIC_API_KEY` from the environment unless an `apiKey` is passed.
 */

import { sseJSON } from "../_sse.js";
import type { LanguageModel, ModelResponse, ModelStreamChunk } from "../model.js";

export interface AnthropicOptions {
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
}

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function anthropic(modelId: string, opts: AnthropicOptions = {}): LanguageModel {
  return {
    provider: "anthropic",
    modelId,
    async complete({ system, user }): Promise<ModelResponse> {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "oya: missing Anthropic API key — set ANTHROPIC_API_KEY or pass anthropic(model, { apiKey }).",
        );
      }
      const res = await fetch(`${opts.baseURL ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: opts.maxTokens ?? 4096,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!res.ok) {
        throw new Error(`oya: anthropic request failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as MessagesResponse;
      return {
        text: (data.content ?? []).map((b) => b.text ?? "").join(""),
        usage: {
          inputTokens: data.usage?.input_tokens ?? 0,
          outputTokens: data.usage?.output_tokens ?? 0,
        },
      };
    },

    async *stream({ system, user }): AsyncIterable<ModelStreamChunk> {
      const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "oya: missing Anthropic API key — set ANTHROPIC_API_KEY or pass anthropic(model, { apiKey }).",
        );
      }
      const res = await fetch(`${opts.baseURL ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: opts.maxTokens ?? 4096,
          system,
          messages: [{ role: "user", content: user }],
          stream: true,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`oya: anthropic stream failed (${res.status}): ${await res.text()}`);
      }
      for await (const evt of sseJSON(res.body) as AsyncIterable<{
        type?: string;
        delta?: { type?: string; text?: string };
      }>) {
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
          yield { textDelta: evt.delta.text ?? "" };
        }
      }
    },
  };
}
