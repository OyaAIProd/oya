/**
 * The Google (Gemini) provider — `oya/google`.
 *
 *     import { google } from "oyadotai/google";
 *     const agent = new Agent({ model: google("gemini-2.5-pro"), tools });
 *
 * No SDK dependency: talks to the Generative Language API over `fetch`. Reads
 * `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) unless an `apiKey` is passed.
 */

import { sseJSON } from "../_sse.js";
import type { LanguageModel, ModelResponse, ModelStreamChunk } from "../model.js";

export interface GoogleOptions {
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
}

interface Candidate {
  content?: { parts?: { text?: string }[] };
}
interface GenerateResponse {
  candidates?: Candidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const textOf = (c?: Candidate) => (c?.content?.parts ?? []).map((p) => p.text ?? "").join("");

export function google(modelId: string, opts: GoogleOptions = {}): LanguageModel {
  const base = opts.baseURL ?? "https://generativelanguage.googleapis.com/v1beta";
  const key = () => {
    const k = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!k) throw new Error("oya: missing Google API key — set GEMINI_API_KEY or pass google(model, { apiKey }).");
    return k;
  };
  const body = (system: string, user: string) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 4096 },
    });
  const headers = () => ({ "content-type": "application/json", "x-goog-api-key": key() });

  return {
    provider: "google",
    modelId,
    async complete({ system, user }): Promise<ModelResponse> {
      const res = await fetch(`${base}/models/${modelId}:generateContent`, {
        method: "POST",
        headers: headers(),
        body: body(system, user),
      });
      if (!res.ok) throw new Error(`oya: google request failed (${res.status}): ${await res.text()}`);
      const data = (await res.json()) as GenerateResponse;
      return {
        text: textOf(data.candidates?.[0]),
        usage: {
          inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    },
    async *stream({ system, user }): AsyncIterable<ModelStreamChunk> {
      const res = await fetch(`${base}/models/${modelId}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: headers(),
        body: body(system, user),
      });
      if (!res.ok || !res.body) throw new Error(`oya: google stream failed (${res.status}): ${await res.text()}`);
      for await (const evt of sseJSON(res.body) as AsyncIterable<GenerateResponse>) {
        const delta = textOf(evt.candidates?.[0]);
        if (delta) yield { textDelta: delta };
      }
    },
  };
}
