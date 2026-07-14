/**
 * Streaming primitives.
 *
 * oya streams *structured events*, not a token soup: the emitted plan, each node
 * starting and finishing (with the handles it sealed, at their projection level),
 * the final answer's text deltas, and a terminal finish/error. A consumer can
 * render the DAG and watch it execute - and an `OPAQUE` handle still discloses
 * nothing, even mid-stream.
 */

import type { AgentResult } from "./agent.js";
import type { Plan } from "./ir.js";
import type { PlannerUsage } from "./planner.js";

/**
 * A streamed event. Every variant is **wire-safe** - it carries only what the
 * planner is entitled to see, so an event stream can be sent to an untrusted
 * client without leaking an `OPAQUE` value. The `finish` event therefore exposes
 * the TRANSPARENT output only, never the raw exit values or the handle table
 * (those stay server-side on the in-process `StreamResult.result`).
 */
export type OyaEvent =
  | { type: "plan"; plan: Plan }
  | { type: "node-start"; nodeId: string; kind: string; skill?: string }
  | { type: "node-finish"; nodeId: string; kind: string; handles: Record<string, unknown> }
  | { type: "text-delta"; delta: string }
  | { type: "finish"; ok: boolean; output: unknown; usage: PlannerUsage; error: string | null }
  | { type: "error"; error: string };

/**
 * An append-only event buffer that supports multiple independent async iterators
 * (so `fullStream` and `textStream` can both consume the same run).
 */
export class EventStream implements AsyncIterable<OyaEvent> {
  private readonly events: OyaEvent[] = [];
  private done = false;
  private waiters: (() => void)[] = [];

  push(e: OyaEvent): void {
    this.events.push(e);
    this.wake();
  }

  end(): void {
    this.done = true;
    this.wake();
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<OyaEvent> {
    let i = 0;
    while (true) {
      while (i < this.events.length) yield this.events[i++];
      if (this.done) return;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

/** The Mastra/AI-SDK-shaped result of `agent.stream()`. */
export interface StreamResult {
  /** Every structured event in order. */
  fullStream: AsyncIterable<OyaEvent>;
  /** Just the final answer's text deltas (Mastra/AI-SDK parity). */
  textStream: AsyncIterable<string>;
  /** Resolves to the full answer text when the run finishes. */
  text: Promise<string>;
  /** Resolves to the full agent result when the run finishes. */
  result: Promise<AgentResult>;
}
