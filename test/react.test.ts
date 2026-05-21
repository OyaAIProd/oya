/**
 * The `usePlan` reducer is pure and testable without a renderer: it folds the
 * streamed events into plan state (node statuses, sealed handles, answer text).
 */

import { describe, expect, it } from "bun:test";

import { applyEvent, initialPlanState, type PlanState } from "../src/react/index.js";
import type { OyaEvent } from "../src/index.js";

const ev = (e: OyaEvent) => e; // type helper

describe("usePlan reducer", () => {
  it("folds a full run into plan state", () => {
    let s: PlanState = initialPlanState;

    s = applyEvent(
      s,
      ev({
        type: "plan",
        // a plan as it arrives over the wire (plain data)
        plan: { nodes: [{ id: "n0", kind: "skill", skill: "lookup@1" }, { id: "n1", kind: "summarise" }] } as never,
      }),
    );
    expect(s.status).toBe("streaming");
    expect(s.nodes.map((n) => n.status)).toEqual(["pending", "pending"]);
    expect(s.nodes[0].skill).toBe("lookup@1");

    s = applyEvent(s, ev({ type: "node-start", nodeId: "n0", kind: "skill" }));
    expect(s.nodes.find((n) => n.nodeId === "n0")!.status).toBe("running");

    s = applyEvent(s, ev({ type: "node-finish", nodeId: "n0", kind: "skill", handles: { rec: { projection: "OPAQUE" } } }));
    const n0 = s.nodes.find((n) => n.nodeId === "n0")!;
    expect(n0.status).toBe("done");
    expect(n0.handles).toEqual({ rec: { projection: "OPAQUE" } });

    s = applyEvent(s, ev({ type: "text-delta", delta: "It's " }));
    s = applyEvent(s, ev({ type: "text-delta", delta: "sunny." }));
    expect(s.text).toBe("It's sunny.");

    s = applyEvent(s, ev({ type: "finish", ok: true, output: "It's sunny.", usage: { inputTokens: 1, outputTokens: 1, modelCalls: 2 }, error: null }));
    expect(s.status).toBe("done");
  });

  it("captures errors", () => {
    const s = applyEvent(initialPlanState, ev({ type: "error", error: "boom" }));
    expect(s.status).toBe("error");
    expect(s.error).toBe("boom");
  });
});
