/**
 * The language-model interface the framework talks to.
 *
 * A `LanguageModel` is structurally an `LLMClient` (see `./planner`), so a
 * provider value can be handed straight to a `Planner` or an `Agent`. Provider
 * packages (`oya/anthropic`, …) return one of these.
 *
 * `complete` may return either the raw text or `{ text, usage }`. Returning usage
 * lets the runtime report token totals on the result (Mastra parity); providers
 * that don't report usage just return a string.
 */

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelResponse {
  text: string;
  usage?: ModelUsage;
}

export interface ModelStreamChunk {
  textDelta: string;
}

export interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  complete(req: { system: string; user: string }): Promise<string | ModelResponse>;
  /** Optional token streaming, used to stream the final answer node. */
  stream?(req: { system: string; user: string }): AsyncIterable<ModelStreamChunk>;
}
